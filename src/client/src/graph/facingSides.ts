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
