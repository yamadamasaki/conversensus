/**
 * 端の位置を決めていない edge の、向かい合う辺 (visual language §8.2, #256)
 *
 * node の接続点は 4 辺にあり、edge が端の接続点を持たない (`sourceHandle` が無い) と React Flow は
 * **最初の接続点 (上辺) を両端に使う**。すると横に並んだ node どうしの edge が上辺の外を回り、
 * label が node の上で重なる (Toulmin model の template graph で起きた)。
 *
 * 持たない edge は、**2 つの node の中心を結ぶ向きで、向かい合う辺の中点**を端にする。
 * 横に離れていれば左右の辺、縦に離れていれば上下の辺。人が繋いだ edge は接続点を持つので
 * ここを通らない (人が選んだ辺を勝手に変えない)。
 *
 * **端は接続点として React Flow に渡す** (`withFacingHandles`、template-update 段 2 の実機の確認 W7)。
 * 以前は edge の部品の中で線の端だけをずらしていたが、付け替えのつかみ所は React Flow が最初の接続点
 * (上辺) に描くので、線の端とつかみ所がずれて**付け替えられなかった** (種から作った Toulmin の edge)。
 * 接続点として渡せば、線もつかみ所も同じ所に描かれる。**渡すのは表示だけ**で、保存はしない
 */

import { Position } from '@xyflow/react';

export type Rect = { x: number; y: number; width: number; height: number };
export type Anchor = { x: number; y: number; position: Position };

function sideOf(rect: Rect, position: Position): Anchor {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  switch (position) {
    case Position.Left:
      return { x: rect.x, y: cy, position };
    case Position.Right:
      return { x: rect.x + rect.width, y: cy, position };
    case Position.Top:
      return { x: cx, y: rect.y, position };
    default:
      return { x: cx, y: rect.y + rect.height, position };
  }
}

export function facingAnchors(
  source: Rect,
  target: Rect,
): { source: Anchor; target: Anchor } {
  const dx = target.x + target.width / 2 - (source.x + source.width / 2);
  const dy = target.y + target.height / 2 - (source.y + source.height / 2);
  // 大きさの違う node でも向きを素直に取れるよう、中心の差の大きい方の軸で選ぶ
  if (Math.abs(dx) >= Math.abs(dy)) {
    const toRight = dx >= 0;
    return {
      source: sideOf(source, toRight ? Position.Right : Position.Left),
      target: sideOf(target, toRight ? Position.Left : Position.Right),
    };
  }
  const down = dy >= 0;
  return {
    source: sideOf(source, down ? Position.Bottom : Position.Top),
    target: sideOf(target, down ? Position.Top : Position.Bottom),
  };
}

/** 辺の位置から node の接続点の id (`EditableNode`・`ImageNode` の 4 辺の接続点) */
const HANDLE_OF: Record<Position, string> = {
  [Position.Top]: 'source-top',
  [Position.Bottom]: 'source-bottom',
  [Position.Left]: 'source-left',
  [Position.Right]: 'source-right',
};

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
 * 端の接続点を持たない edge に、向かい合う辺の接続点を当てる (表示だけ)。
 *
 * - 当てるのは**両端とも**接続点を持たない edge だけ (片方だけ持つ edge は、人が選んだ端を残す)
 * - 両端の node の形が分からない (まだ測られていない) ・その辺の接続点を持たない (group) なら当てない
 * - 当てる必要の無い edge は同じオブジェクトのまま返す (React Flow に要らない描き直しをさせない)
 */
export function withFacingHandles<E extends HandledEdge>(
  edges: readonly E[],
  shapeOf: (nodeId: string) => NodeShape | undefined,
): E[] {
  return edges.map((e) => {
    if (e.sourceHandle != null || e.targetHandle != null) return e;
    const source = shapeOf(e.source);
    const target = shapeOf(e.target);
    if (!source || !target) return e;
    const anchors = facingAnchors(source.rect, target.rect);
    const sourceHandle = HANDLE_OF[anchors.source.position];
    const targetHandle = HANDLE_OF[anchors.target.position];
    if (
      !source.handleIds.has(sourceHandle) ||
      !target.handleIds.has(targetHandle)
    )
      return e;
    return { ...e, sourceHandle, targetHandle };
  });
}
