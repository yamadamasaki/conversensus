import { describe, expect, it } from 'bun:test';
import { Position } from '@xyflow/react';
import fc from 'fast-check';
import {
  EXTRA_SLOTS,
  facingAnchors,
  type NodeShape,
  nearestSlot,
  type Rect,
  SLOTS,
  slotHandleId,
  withFacingHandles,
} from './facingSides';

/** React Flow の `Edge` のうち、端の接続点に関わる部分 */
type TestEdge = {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};
const edge = (source: string, target: string): TestEdge => ({ source, target });

const box = (x: number, y: number): Rect => ({ x, y, width: 160, height: 80 });

describe('facingAnchors: 例', () => {
  it('真横にある node へは、右辺の真ん中から左辺の真ん中へ', () => {
    const { source, target } = facingAnchors(box(0, 0), box(480, 0));
    expect(source).toMatchObject({ x: 160, y: 40, position: Position.Right });
    expect(target).toMatchObject({ x: 480, y: 40, position: Position.Left });
  });

  it('真上にある node へは、上辺の真ん中から下辺の真ん中へ', () => {
    const { source, target } = facingAnchors(box(0, 400), box(0, 0));
    expect(source).toMatchObject({ x: 80, y: 400, position: Position.Top });
    expect(target).toMatchObject({ x: 80, y: 80, position: Position.Bottom });
  });

  it('横並びの 2 本は上辺を回らない (#256 の Toulmin の上の段)', () => {
    // 以前は両端とも上辺 (最初の接続点) で、上の外を回って label が重なった
    const { source, target } = facingAnchors(box(240, 0), box(0, 0));
    expect(source.position).toBe(Position.Left);
    expect(target.position).toBe(Position.Right);
  });

  it('斜めにある node へは、中心線の交点 = 辺の真ん中からずれた所 (#410)', () => {
    // 右下の node へ。右辺の、真ん中より下に出る
    const { source } = facingAnchors(box(0, 0), box(480, 120));
    expect(source.position).toBe(Position.Right);
    expect(source.y).toBeGreaterThan(40);
  });
});

const rect = fc.record({
  x: fc.integer({ min: -2000, max: 2000 }),
  y: fc.integer({ min: -2000, max: 2000 }),
  width: fc.integer({ min: 20, max: 400 }),
  height: fc.integer({ min: 20, max: 400 }),
});

const EPSILON = 1e-6;
const near = (a: number, b: number) => Math.abs(a - b) < EPSILON;

const onBoundary = (r: Rect, p: { x: number; y: number }) =>
  ((near(p.x, r.x) || near(p.x, r.x + r.width)) &&
    p.y >= r.y - EPSILON &&
    p.y <= r.y + r.height + EPSILON) ||
  ((near(p.y, r.y) || near(p.y, r.y + r.height)) &&
    p.x >= r.x - EPSILON &&
    p.x <= r.x + r.width + EPSILON);

const centerOf = (r: Rect) => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

/** p が a と b を通る直線の上にあるか (外積が 0) */
const collinear = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: { x: number; y: number },
) => {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  // 座標の大きさに比例する誤差を許す
  return (
    Math.abs(cross) <
    1e-6 * (1 + Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) * 4000
  );
};

describe('facingAnchors: 性質', () => {
  it('端はどちらも、自分の node の枠の上で、かつ 2 つの中心を結ぶ線の上にある (#410)', () => {
    fc.assert(
      fc.property(rect, rect, (s, t) => {
        const cs = centerOf(s);
        const ct = centerOf(t);
        // 中心が重なると線が決まらない
        fc.pre(cs.x !== ct.x || cs.y !== ct.y);
        const a = facingAnchors(s, t);
        return (
          onBoundary(s, a.source) &&
          onBoundary(t, a.target) &&
          collinear(cs, ct, a.source) &&
          collinear(cs, ct, a.target)
        );
      }),
    );
  });

  it('辺の上の位置 (along) は 0〜1 で、いちばん近い接続点の番号は 1〜SLOTS', () => {
    fc.assert(
      fc.property(rect, rect, (s, t) => {
        const { source } = facingAnchors(s, t);
        const slot = nearestSlot(source.along);
        return (
          source.along >= -EPSILON &&
          source.along <= 1 + EPSILON &&
          slot >= 1 &&
          slot <= SLOTS
        );
      }),
    );
  });
});

describe('並べた接続点の id', () => {
  it('真ん中は今までの id (保存済みの端は変わらない)、両側は番号付き', () => {
    expect(slotHandleId(Position.Top, 3)).toBe('source-top');
    expect(slotHandleId(Position.Left, 1)).toBe('source-left-1');
    expect(EXTRA_SLOTS).toEqual([1, 2, 4, 5]);
  });
});

/** 並べた接続点をすべて持つ node */
const ALL_SLOTS = new Set(
  [Position.Top, Position.Bottom, Position.Left, Position.Right].flatMap((p) =>
    Array.from({ length: SLOTS }, (_, i) => slotHandleId(p, i + 1)),
  ),
);
/** 真ん中の 4 つだけを持つ node (並べた接続点の無い部品) */
const MIDDLE_ONLY = new Set([
  'source-top',
  'source-bottom',
  'source-left',
  'source-right',
]);

describe('withFacingHandles (表示だけの接続点、段 2 の実機の確認 W7・#410)', () => {
  const shapes: Record<string, NodeShape> = {
    left: { rect: box(0, 0), handleIds: ALL_SLOTS },
    right: { rect: box(480, 0), handleIds: ALL_SLOTS },
    below: { rect: box(0, 400), handleIds: ALL_SLOTS },
    lowerRight: { rect: box(480, 100), handleIds: ALL_SLOTS },
    upperRight: { rect: box(480, -100), handleIds: ALL_SLOTS },
    plain: { rect: box(480, 100), handleIds: MIDDLE_ONLY },
    group: { rect: box(480, 400), handleIds: new Set() },
  };
  const shapeOf = (id: string) => shapes[id];

  it('真横・真下の node とは、辺の真ん中の接続点で繋ぐ', () => {
    const [sideways, vertical] = withFacingHandles(
      [edge('left', 'right'), edge('below', 'left')],
      shapeOf,
    );
    expect(sideways).toMatchObject({
      sourceHandle: 'source-right',
      targetHandle: 'source-left',
    });
    expect(vertical).toMatchObject({
      sourceHandle: 'source-top',
      targetHandle: 'source-bottom',
    });
  });

  it('同じ辺を向く edge でも、相手の方向が違えば別の接続点に散らばる (#410)', () => {
    // 以前は 3 本とも右辺の真ん中に集まり、重なって一番上しか選べなかった
    const out = withFacingHandles(
      [
        edge('left', 'right'),
        edge('left', 'lowerRight'),
        edge('left', 'upperRight'),
      ],
      shapeOf,
    );
    const handles = out.map((e) => e.sourceHandle);
    expect(handles.every((h) => h?.startsWith('source-right'))).toBe(true);
    expect(new Set(handles).size).toBe(3);
  });

  it('並べた接続点を持たない node は、辺の真ん中の接続点を使う', () => {
    const [out] = withFacingHandles([edge('left', 'plain')], shapeOf);
    expect(out?.targetHandle).toBe('source-left');
  });

  it('人が選んだ端・測られていない node・接続点の無い node (group) は、そのままのオブジェクトを返す', () => {
    const chosen = {
      source: 'left',
      target: 'right',
      sourceHandle: 'source-top',
    };
    const unmeasured = edge('left', 'nowhere');
    const toGroup = edge('left', 'group');
    const out = withFacingHandles([chosen, unmeasured, toGroup], shapeOf);
    expect(out[0]).toBe(chosen);
    expect(out[1]).toBe(unmeasured);
    expect(out[2]).toBe(toGroup);
  });
});
