import { describe, expect, it } from 'bun:test';
import type { Node } from '@xyflow/react';
import {
  absoluteBoundingBoxOf,
  absoluteCenterOf,
  absolutePositionOf,
  depthOf,
  groupBoundsOf,
  isAncestorOf,
  nodeSizeOf,
  pointInGroup,
  toParentRelative,
} from './coords';

function node(
  id: string,
  position: { x: number; y: number },
  parentId?: string,
  extra: Partial<Node> = {},
): Node {
  return {
    id,
    position,
    data: {},
    ...(parentId ? { parentId } : {}),
    ...extra,
  } as Node;
}

// outer(100,100) > middle(50,50) > inner(10,10) の 3 段の入れ子
const outer = node('outer', { x: 100, y: 100 });
const middle = node('middle', { x: 50, y: 50 }, 'outer');
const inner = node('inner', { x: 10, y: 10 }, 'middle');
const topLevel = node('top', { x: 7, y: 9 });
const nested = [outer, middle, inner, topLevel];

describe('absolutePositionOf', () => {
  it('トップレベルのノードは自身の position をそのまま返す', () => {
    expect(absolutePositionOf(topLevel, nested)).toEqual({ x: 7, y: 9 });
  });

  it('親を 1 段辿って絶対座標を求める', () => {
    expect(absolutePositionOf(middle, nested)).toEqual({ x: 150, y: 150 });
  });

  it('3 段の入れ子でも祖先を全て畳んで絶対座標を求める', () => {
    expect(absolutePositionOf(inner, nested)).toEqual({ x: 160, y: 160 });
  });

  // positionAbsolute はドラッグ中に stale になりうるので信頼してはならない
  it('positionAbsolute が古い値でも結果は変わらない', () => {
    const staleInner = node('inner', { x: 10, y: 10 }, 'middle', {
      positionAbsolute: { x: -999, y: -999 },
    } as Partial<Node>);

    expect(absolutePositionOf(staleInner, [outer, middle, staleInner])).toEqual(
      {
        x: 160,
        y: 160,
      },
    );
  });

  it('親が存在しない孤児ノードは相対座標をそのまま返す', () => {
    const orphan = node('orphan', { x: 30, y: 40 }, 'missing');

    expect(absolutePositionOf(orphan, [orphan])).toEqual({ x: 30, y: 40 });
  });

  it('親子関係が循環していても停止する', () => {
    const a = node('a', { x: 1, y: 1 }, 'b');
    const b = node('b', { x: 2, y: 2 }, 'a');

    expect(() => absolutePositionOf(a, [a, b])).not.toThrow();
  });
});

describe('toParentRelative', () => {
  it('親を指定しなければ絶対座標のまま返す', () => {
    expect(toParentRelative({ x: 5, y: 6 }, undefined, nested)).toEqual({
      x: 5,
      y: 6,
    });
  });

  it('入れ子の親から見た相対座標へ変換する', () => {
    // middle の絶対座標は (150, 150)
    expect(toParentRelative({ x: 200, y: 180 }, 'middle', nested)).toEqual({
      x: 50,
      y: 30,
    });
  });

  it('存在しない親を指定した場合は絶対座標のまま返す', () => {
    expect(toParentRelative({ x: 5, y: 6 }, 'missing', nested)).toEqual({
      x: 5,
      y: 6,
    });
  });

  it('absolutePositionOf の逆変換になっている', () => {
    const absolute = absolutePositionOf(inner, nested);

    expect(toParentRelative(absolute, 'middle', nested)).toEqual(
      inner.position,
    );
  });
});

describe('depthOf', () => {
  it('トップレベルは 0', () => {
    expect(depthOf(topLevel, nested)).toBe(0);
  });

  it('入れ子の段数を返す', () => {
    expect(depthOf(middle, nested)).toBe(1);
    expect(depthOf(inner, nested)).toBe(2);
  });

  it('親が存在しない孤児ノードは 0', () => {
    const orphan = node('orphan', { x: 0, y: 0 }, 'missing');

    expect(depthOf(orphan, [orphan])).toBe(0);
  });
});

describe('isAncestorOf', () => {
  it('直接の親は祖先である', () => {
    expect(isAncestorOf('middle', 'inner', nested)).toBe(true);
  });

  it('祖父も祖先である', () => {
    expect(isAncestorOf('outer', 'inner', nested)).toBe(true);
  });

  it('子孫は祖先ではない', () => {
    expect(isAncestorOf('inner', 'outer', nested)).toBe(false);
  });

  it('自分自身は祖先ではない', () => {
    expect(isAncestorOf('inner', 'inner', nested)).toBe(false);
  });

  it('無関係なノードは祖先ではない', () => {
    expect(isAncestorOf('top', 'inner', nested)).toBe(false);
  });

  it('親子関係が循環していても停止する', () => {
    const a = node('a', { x: 0, y: 0 }, 'b');
    const b = node('b', { x: 0, y: 0 }, 'a');

    expect(() => isAncestorOf('c', 'a', [a, b])).not.toThrow();
  });
});

describe('groupBoundsOf', () => {
  it('measured と style の大きい方を幅・高さに採る', () => {
    const group = node('g', { x: 0, y: 0 }, undefined, {
      style: { width: 300, height: 100 },
      measured: { width: 200, height: 250 },
    });

    expect(groupBoundsOf(group, [group])).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 250,
    });
  });

  it('幅・高さが未測定かつ未指定なら既定値にフォールバックする', () => {
    const group = node('g', { x: 0, y: 0 });

    expect(groupBoundsOf(group, [group])).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    });
  });

  it('入れ子のグループでは絶対座標を返す', () => {
    const group = node('g', { x: 20, y: 30 }, 'middle', {
      style: { width: 100, height: 100 },
    });
    const nodes = [outer, middle, group];

    // middle の絶対座標 (150, 150) + (20, 30)
    expect(groupBoundsOf(group, nodes)).toMatchObject({ x: 170, y: 180 });
  });
});

describe('pointInGroup', () => {
  const group = node('g', { x: 100, y: 100 }, undefined, {
    style: { width: 200, height: 200 },
  });
  const nodes = [group];

  it('内側の点は true', () => {
    expect(pointInGroup({ x: 150, y: 150 }, group, nodes)).toBe(true);
  });

  it('境界上の点は true', () => {
    expect(pointInGroup({ x: 100, y: 100 }, group, nodes)).toBe(true);
    expect(pointInGroup({ x: 300, y: 300 }, group, nodes)).toBe(true);
  });

  it('外側の点は false', () => {
    expect(pointInGroup({ x: 99, y: 150 }, group, nodes)).toBe(false);
    expect(pointInGroup({ x: 150, y: 301 }, group, nodes)).toBe(false);
  });

  it('buffer は境界を外側に広げる', () => {
    expect(pointInGroup({ x: 80, y: 150 }, group, nodes)).toBe(false);
    expect(
      pointInGroup({ x: 80, y: 150 }, group, nodes, { x: 30, y: 30 }),
    ).toBe(true);
  });

  it('入れ子のグループは絶対座標で判定する', () => {
    const child = node('child', { x: 0, y: 0 }, 'middle', {
      style: { width: 100, height: 100 },
    });
    const withNested = [outer, middle, child];

    // child の絶対座標は (150, 150) — 相対座標 (0,0) で判定すると誤る
    expect(pointInGroup({ x: 200, y: 200 }, child, withNested)).toBe(true);
    expect(pointInGroup({ x: 50, y: 50 }, child, withNested)).toBe(false);
  });
});

describe('nodeSizeOf', () => {
  it('measured を最優先する', () => {
    const n = node('n', { x: 0, y: 0 }, undefined, {
      measured: { width: 111, height: 222 },
      style: { width: 10, height: 20 },
    });

    expect(nodeSizeOf(n)).toEqual({ width: 111, height: 222 });
  });

  it('measured が無ければ style を使う', () => {
    const n = node('n', { x: 0, y: 0 }, undefined, {
      style: { width: 10, height: 20 },
    });

    expect(nodeSizeOf(n)).toEqual({ width: 10, height: 20 });
  });

  it('どちらも無ければ既定のノードサイズを使う', () => {
    expect(nodeSizeOf(node('n', { x: 0, y: 0 }))).toEqual({
      width: 160,
      height: 80,
    });
  });
});

describe('absoluteBoundingBoxOf', () => {
  it('対象が空なら undefined を返す', () => {
    expect(absoluteBoundingBoxOf([], nested)).toBeUndefined();
  });

  it('単一ノードでは自身のサイズがそのまま矩形になる', () => {
    const n = node('n', { x: 10, y: 20 }, undefined, {
      measured: { width: 100, height: 50 },
    });

    expect(absoluteBoundingBoxOf([n], [n])).toEqual({
      minX: 10,
      minY: 20,
      maxX: 110,
      maxY: 70,
    });
  });

  // 旧実装は node.position をそのまま比較しており、親が異なるノードを
  // まとめて選択すると座標系が混ざって矩形が破綻していた
  it('親が異なるノード同士でも絶対座標で矩形を求める', () => {
    // group の絶対座標は (100, 100)
    const group = node('group', { x: 100, y: 100 }, undefined, {
      style: { width: 200, height: 200 },
    });
    // group の子。絶対座標は (140, 140)
    const child = node('child', { x: 40, y: 40 }, 'group', {
      measured: { width: 60, height: 60 },
    });
    // トップレベル。絶対座標は (10, 10)
    const outside = node('outside', { x: 10, y: 10 }, undefined, {
      measured: { width: 20, height: 20 },
    });
    const nodes = [group, child, outside];

    expect(absoluteBoundingBoxOf([child, outside], nodes)).toEqual({
      minX: 10,
      minY: 10,
      maxX: 200,
      maxY: 200,
    });
  });

  it('サイズ未測定のノードは既定のノードサイズで矩形に寄与する', () => {
    const n = node('n', { x: 0, y: 0 });

    expect(absoluteBoundingBoxOf([n], [n])).toEqual({
      minX: 0,
      minY: 0,
      maxX: 160,
      maxY: 80,
    });
  });
});

describe('absoluteCenterOf', () => {
  it('入れ子のノードの中心を絶対座標で返す', () => {
    const child = node('child', { x: 10, y: 10 }, 'middle', {
      measured: { width: 100, height: 40 },
    });
    const nodes = [outer, middle, child];

    // 絶対座標 (160, 160) + サイズの半分 (50, 20)
    expect(absoluteCenterOf(child, nodes)).toEqual({ x: 210, y: 180 });
  });
});
