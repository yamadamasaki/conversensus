import { describe, expect, it } from 'bun:test';
import { Position } from '@xyflow/react';
import fc from 'fast-check';
import { facingAnchors, type Rect } from './facingSides';

const box = (x: number, y: number): Rect => ({ x, y, width: 160, height: 80 });

describe('facingAnchors: 例', () => {
  it('右にある node へは、右辺から左辺へ', () => {
    const { source, target } = facingAnchors(box(0, 0), box(480, 0));
    expect(source).toEqual({ x: 160, y: 40, position: Position.Right });
    expect(target).toEqual({ x: 480, y: 40, position: Position.Left });
  });

  it('上にある node へは、上辺から下辺へ', () => {
    const { source, target } = facingAnchors(box(0, 400), box(0, 0));
    expect(source).toEqual({ x: 80, y: 400, position: Position.Top });
    expect(target).toEqual({ x: 80, y: 80, position: Position.Bottom });
  });

  it('横並びの 2 本は上辺を回らない (#256 の Toulmin の上の段)', () => {
    // 以前は両端とも上辺 (最初の接続点) で、上の外を回って label が重なった
    const { source, target } = facingAnchors(box(240, 0), box(0, 0));
    expect(source.position).toBe(Position.Left);
    expect(target.position).toBe(Position.Right);
  });
});

const rect = fc.record({
  x: fc.integer({ min: -2000, max: 2000 }),
  y: fc.integer({ min: -2000, max: 2000 }),
  width: fc.integer({ min: 20, max: 400 }),
  height: fc.integer({ min: 20, max: 400 }),
});

const onBoundary = (r: Rect, p: { x: number; y: number }) =>
  ((p.x === r.x || p.x === r.x + r.width) &&
    p.y >= r.y &&
    p.y <= r.y + r.height) ||
  ((p.y === r.y || p.y === r.y + r.height) &&
    p.x >= r.x &&
    p.x <= r.x + r.width);

const OPPOSITE = {
  [Position.Left]: Position.Right,
  [Position.Right]: Position.Left,
  [Position.Top]: Position.Bottom,
  [Position.Bottom]: Position.Top,
};

describe('facingAnchors: 性質', () => {
  it('端はどちらも自分の node の辺の上にあり、両端の辺は向かい合う', () => {
    fc.assert(
      fc.property(rect, rect, (s, t) => {
        const a = facingAnchors(s, t);
        return (
          onBoundary(s, a.source) &&
          onBoundary(t, a.target) &&
          OPPOSITE[a.source.position] === a.target.position
        );
      }),
    );
  });

  it('向きを逆にすると、同じ 2 辺を入れ替えて使う', () => {
    fc.assert(
      fc.property(rect, rect, (s, t) => {
        const ab = facingAnchors(s, t);
        const ba = facingAnchors(t, s);
        // 中心が重なる・軸が同点のときは向きが決まらないので除く
        fc.pre(
          Math.abs(s.x + s.width / 2 - (t.x + t.width / 2)) !==
            Math.abs(s.y + s.height / 2 - (t.y + t.height / 2)),
        );
        return (
          ab.source.position === ba.target.position &&
          ab.target.position === ba.source.position
        );
      }),
    );
  });
});
