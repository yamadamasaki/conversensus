/**
 * 端の位置を決めていない edge の、端の置き方 (visual language §8.2, #256・#410)
 *
 * node の接続点は 4 辺にあり、edge が端の接続点を持たない (`sourceHandle` が無い) と React Flow は
 * **最初の接続点 (上辺) を両端に使う**。すると横に並んだ node どうしの edge が上辺の外を回り、
 * label が node の上で重なる (Toulmin model の template graph で起きた、#256)。
 *
 * 持たない edge は、**2 つの node の中心を結ぶ線が、それぞれの node の枠と交わる所**を端にする (#410)。
 * 以前は向かい合う辺の中点にしていたので、同じ辺を向く edge の端がすべて 1 点に集まって重なり、
 * 一番上の edge しか選べなかった。中心線の交点なら、相手の node の方向ごとに端がずれ、人が見ても自然である。
 * **端はすべて自動** (利用者判断、#410)。人が繋いだ edge も、繋いだ接続点を保存しない。以前に保存された
 * 接続点も表示には使わない — 手で同じ接続点に繋いだ edge が重なったままになるため。
 *
 * **端は接続点として React Flow に渡す** (`withFacingHandles`、template-update 段 2 の実機の確認 W7)。
 * 付け替えのつかみ所は React Flow が接続点の位置に描くので、線の端だけをずらすとつかみ所とずれて
 * 付け替えられない。そこで各辺に**接続点を `SLOTS` か所並べ** (`SlotHandles`)、交点にいちばん近いものを
 * 使う。交点そのものではないが、つかみ所と線の端が一致する。**渡すのは表示だけ**で、保存はしない
 */

import { Position } from '@xyflow/react';

export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

/**
 * 1 辺に並べる接続点の数。辺を `SLOTS + 1` 等分した点に置く。真ん中は今までの接続点
 * (`source-top` など) なので、保存済みの端は変わらない
 */
export const SLOTS = 5;
/** 真ん中の接続点の番号 (1 始まり) */
const MIDDLE_SLOT = (SLOTS + 1) / 2;

/** 辺の位置から真ん中の接続点の id (`EditableNode`・`ImageNode` の 4 辺の接続点) */
const HANDLE_OF: Record<Position, string> = {
  [Position.Top]: 'source-top',
  [Position.Bottom]: 'source-bottom',
  [Position.Left]: 'source-left',
  [Position.Right]: 'source-right',
};

/**
 * 辺の `slot` 番目 (1〜SLOTS、上・下の辺は左から、左・右の辺は上から) の接続点の id。
 * 真ん中は今までの id
 */
export function slotHandleId(position: Position, slot: number): string {
  return slot === MIDDLE_SLOT
    ? HANDLE_OF[position]
    : `${HANDLE_OF[position]}-${slot}`;
}

/** 真ん中を除いた接続点の番号 (`SlotHandles` が足す分) */
export const EXTRA_SLOTS: readonly number[] = Array.from(
  { length: SLOTS },
  (_, i) => i + 1,
).filter((slot) => slot !== MIDDLE_SLOT);

/** `slot` 番目の接続点の、辺の上での位置 (0〜1) */
export function slotFraction(slot: number): number {
  return slot / (SLOTS + 1);
}

/** 枠の上の端。`along` は辺の上の位置 (0〜1。上・下の辺は左から、左・右の辺は上から) */
export type Anchor = Point & { position: Position; along: number };

const centerOf = (r: Rect): Point => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

/**
 * `rect` の中心から `toward` へ向かう線が、`rect` の枠と交わる所。
 * 中心が同じ (向きが決まらない) ときは右辺の真ん中にする
 */
export function borderAnchor(rect: Rect, toward: Point): Anchor {
  const c = centerOf(rect);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  if (dx === 0 && dy === 0) {
    return {
      x: rect.x + rect.width,
      y: c.y,
      position: Position.Right,
      along: 0.5,
    };
  }
  // 左右の辺に先に当たるか、上下の辺に先に当たるか (枠の縦横比で比べる)
  if (Math.abs(dx) * halfH >= Math.abs(dy) * halfW) {
    const y = c.y + (dy * halfW) / Math.abs(dx);
    return {
      x: dx >= 0 ? rect.x + rect.width : rect.x,
      y,
      position: dx >= 0 ? Position.Right : Position.Left,
      along: (y - rect.y) / rect.height,
    };
  }
  const x = c.x + (dx * halfH) / Math.abs(dy);
  return {
    x,
    y: dy >= 0 ? rect.y + rect.height : rect.y,
    position: dy >= 0 ? Position.Bottom : Position.Top,
    along: (x - rect.x) / rect.width,
  };
}

/** 2 つの node の中心を結ぶ線が、それぞれの枠と交わる所 */
export function facingAnchors(
  source: Rect,
  target: Rect,
): { source: Anchor; target: Anchor } {
  return {
    source: borderAnchor(source, centerOf(target)),
    target: borderAnchor(target, centerOf(source)),
  };
}

/** 辺の上の位置にいちばん近い接続点の番号 */
export function nearestSlot(along: number): number {
  return Math.min(SLOTS, Math.max(1, Math.round(along * (SLOTS + 1))));
}

/** edge の両端の node の、位置と大きさと持っている接続点の id */
export type NodeShape = { rect: Rect; handleIds: ReadonlySet<string> };

/** 端の接続点を決められる edge の形 (React Flow の `Edge` の一部) */
type HandledEdge = {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

/**
 * 端に使う接続点。交点にいちばん近い接続点を持っていればそれ、持たなければ (並べた接続点の無い node)
 * その辺の真ん中、それも無ければ (group) 無し
 */
function handleFor(anchor: Anchor, shape: NodeShape): string | undefined {
  const nearest = slotHandleId(anchor.position, nearestSlot(anchor.along));
  if (shape.handleIds.has(nearest)) return nearest;
  const middle = HANDLE_OF[anchor.position];
  return shape.handleIds.has(middle) ? middle : undefined;
}

/**
 * edge の端に、中心線と枠の交点にいちばん近い接続点を当てる (表示だけ)。
 *
 * - **保存された接続点があっても上書きする** (端はすべて自動、#410)
 * - 両端の node の形が分からない (まだ測られていない) ・その辺に接続点を持たない (group) なら当てない
 * - 当てても変わらない edge は同じオブジェクトのまま返す (React Flow に要らない描き直しをさせない)
 */
export function withFacingHandles<E extends HandledEdge>(
  edges: readonly E[],
  shapeOf: (nodeId: string) => NodeShape | undefined,
): E[] {
  return edges.map((e) => {
    const source = shapeOf(e.source);
    const target = shapeOf(e.target);
    if (!source || !target) return e;
    const anchors = facingAnchors(source.rect, target.rect);
    const sourceHandle = handleFor(anchors.source, source);
    const targetHandle = handleFor(anchors.target, target);
    if (!sourceHandle || !targetHandle) return e;
    if (e.sourceHandle === sourceHandle && e.targetHandle === targetHandle)
      return e;
    return { ...e, sourceHandle, targetHandle };
  });
}
