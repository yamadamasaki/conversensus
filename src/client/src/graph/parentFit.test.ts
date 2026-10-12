import { describe, expect, test } from 'bun:test';
import type { NodeId } from '@conversensus/shared';
import type { Node } from '@xyflow/react';
import fc from 'fast-check';
import { applyEvent } from '../events/applyEvent';
import {
  makeEventBase,
  type NodeMovedEvent,
  type NodeReparentedEvent,
  type NodeResizedEvent,
} from '../events/GraphEvent';
import { invertEvent } from '../events/invertEvent';
import { graphEventToOps } from '../events/toUnified';
import { GROUP_PADDING, GROUP_TITLE_HEIGHT } from '../graphTransform';
import { withParentFit } from './parentFit';

const CHILD_W = 160;
const CHILD_H = 80;

function group(id: string, x: number, y: number, w: number, h: number): Node {
  return {
    id,
    type: 'groupNode',
    position: { x, y },
    data: {},
    style: { width: w, height: h },
  };
}

function child(
  id: string,
  parentId: string | undefined,
  x: number,
  y: number,
): Node {
  return {
    id,
    ...(parentId && { parentId }),
    position: { x, y },
    data: {},
    style: { width: CHILD_W, height: CHILD_H },
  };
}

function moved(
  nodeId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
): NodeMovedEvent {
  return {
    ...makeEventBase('layout'),
    type: 'NODE_MOVED',
    nodeId: nodeId as NodeId,
    from,
    to,
  };
}

/** 比べるのは置き場所と、指定の大きさだけ (選択などは見ない) */
function boxes(nodes: Node[]) {
  return nodes.map((n) => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    width: n.style?.width,
    height: n.style?.height,
  }));
}

/** group g の子がすべて枠の中 (余白・題名の帯を含む) に収まっているか */
function childrenInside(nodes: Node[], groupId: string): boolean {
  const g = nodes.find((n) => n.id === groupId);
  if (!g) return false;
  const w = Number(g.style?.width);
  const h = Number(g.style?.height);
  return nodes
    .filter((n) => n.parentId === groupId)
    .every(
      (c) =>
        c.position.x >= GROUP_PADDING &&
        c.position.y >= GROUP_TITLE_HEIGHT + GROUP_PADDING &&
        c.position.x + CHILD_W + GROUP_PADDING <= w &&
        c.position.y + CHILD_H + GROUP_PADDING <= h,
    );
}

const NO_EDGES: never[] = [];

/**
 * op-log の側の姿: 元の姿に、event から作った `node.setLayout` を当てる。projection と同じく、
 * op に載っている項目だけを書き換える
 */
function projectLayoutOps(
  nodes: Node[],
  ops: ReturnType<typeof graphEventToOps>,
): ReturnType<typeof boxes> {
  const out = new Map(boxes(nodes).map((b) => [b.id, { ...b }]));
  for (const op of ops) {
    if (op.kind !== 'node.setLayout') continue;
    const box = out.get(op.target);
    if (!box) continue;
    const { x, y, width, height } = op as {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    };
    if (x !== undefined) box.x = x;
    if (y !== undefined) box.y = y;
    if (width !== undefined) box.width = width;
    if (height !== undefined) box.height = height;
  }
  return [...out.values()];
}

describe('withParentFit (#250)', () => {
  const nodes = [
    group('g', 100, 100, 400, 300),
    child('a', 'g', 40, 60),
    child('b', 'g', 200, 100),
  ];

  test('枠の中で動かしただけなら何も載せない', () => {
    const event = moved('a', { x: 40, y: 60 }, { x: 60, y: 80 });
    expect(withParentFit(event, nodes, NO_EDGES)).toBe(event);
  });

  test('右下へはみ出したら、group の大きさだけを広げる', () => {
    const event = withParentFit(
      moved('a', { x: 40, y: 60 }, { x: 400, y: 300 }),
      nodes,
      NO_EDGES,
    );
    expect(event.fitted).toEqual([
      {
        nodeId: 'g' as NodeId,
        from: { x: 100, y: 100, width: 400, height: 300 },
        to: {
          x: 100,
          y: 100,
          width: 400 + CHILD_W + GROUP_PADDING,
          height: 300 + CHILD_H + GROUP_PADDING,
        },
      },
    ]);
  });

  test('左へはみ出したら group が左へ動き、兄弟と動かした node 自身の相対座標がずれる', () => {
    const event = withParentFit(
      moved('a', { x: 40, y: 60 }, { x: -30, y: 60 }),
      nodes,
      NO_EDGES,
    );
    const shift = GROUP_PADDING + 30;
    expect(event.fitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: 'g',
          to: expect.objectContaining({ x: 100 - shift }),
        }),
        // 動かした node は「操作の前」から「ずれた後」へ。undo で操作の前に戻すため
        {
          nodeId: 'a' as NodeId,
          from: { x: 40, y: 60 },
          to: { x: -30 + shift, y: 60 },
        },
        {
          nodeId: 'b' as NodeId,
          from: { x: 200, y: 100 },
          to: { x: 200 + shift, y: 100 },
        },
      ]),
    );
    // ずれるだけの node に大きさは付けない (中身に合わせて伸びる node を固定しない)
    for (const fit of event.fitted ?? []) {
      if (fit.nodeId !== 'g') expect(fit.to.width).toBeUndefined();
    }
  });

  test('入れ子: 内側の group が広がって外側からはみ出せば、外側も広げる', () => {
    const nested = [
      group('outer', 0, 0, 500, 400),
      { ...group('inner', 40, 60, 300, 200), parentId: 'outer' },
      child('c', 'inner', 40, 60),
    ];
    const event = withParentFit(
      moved('c', { x: 40, y: 60 }, { x: 400, y: 60 }),
      nested,
      NO_EDGES,
    );
    const ids = (event.fitted ?? []).map((f) => f.nodeId);
    expect(ids).toContain('inner' as NodeId);
    expect(ids).toContain('outer' as NodeId);
    const after = applyEvent(event, nested, NO_EDGES).nodes;
    expect(childrenInside(after, 'inner')).toBe(true);
  });

  test('親を変えて入れたときも、大きさを変えたときも載せる', () => {
    const top = [...nodes, child('t', undefined, 900, 900)];
    const reparented: NodeReparentedEvent = {
      ...makeEventBase('structure'),
      type: 'NODE_REPARENTED',
      nodeId: 't' as NodeId,
      oldParentId: undefined,
      newParentId: 'g' as NodeId,
      oldPosition: { x: 900, y: 900 },
      newPosition: { x: 380, y: 250 },
    };
    expect(withParentFit(reparented, top, NO_EDGES).fitted).toBeDefined();

    const nestedGroups = [
      group('outer', 0, 0, 500, 400),
      { ...group('inner', 40, 60, 300, 200), parentId: 'outer' },
    ];
    const resized: NodeResizedEvent = {
      ...makeEventBase('layout'),
      type: 'NODE_RESIZED',
      nodeId: 'inner' as NodeId,
      from: { width: 300, height: 200 },
      to: { width: 600, height: 200 },
    };
    expect(
      withParentFit(resized, nestedGroups, NO_EDGES).fitted?.map(
        (f) => f.nodeId,
      ),
    ).toEqual(['outer' as NodeId]);
  });

  test('広げた分は同じ batch の layout op になる', () => {
    const event = withParentFit(
      moved('a', { x: 40, y: 60 }, { x: 400, y: 300 }),
      nodes,
      NO_EDGES,
    );
    expect(graphEventToOps(event)).toEqual([
      expect.objectContaining({ kind: 'node.setLayout', target: 'a' }),
      expect.objectContaining({
        kind: 'node.setLayout',
        target: 'g',
        width: 400 + CHILD_W + GROUP_PADDING,
      }),
    ]);
  });

  test('載っている event (undo / redo) には重ねて載せない', () => {
    const event = withParentFit(
      moved('a', { x: 40, y: 60 }, { x: 400, y: 300 }),
      nodes,
      NO_EDGES,
    );
    expect(withParentFit(event, nodes, NO_EDGES)).toBe(event);
  });

  /**
   * 子の位置は小さなプールから引く: 枠の中・左/上へはみ出す・右/下へはみ出す、のすべてに
   * 当たるように。広い生成器だと「左へも下へも」のような組を引きにくい
   */
  const coord = fc.constantFrom(-200, -30, 0, 40, 120, 250, 600);

  test('性質: どこへ動かしても、広げた後は子がすべて枠に収まり、op-log の姿は画面と同じで、undo で元の姿に戻る', () => {
    fc.assert(
      fc.property(fc.constantFrom('a', 'b'), coord, coord, (id, x, y) => {
        const target = nodes.find((n) => n.id === id) as Node;
        const event = withParentFit(
          moved(id, target.position, { x, y }),
          nodes,
          NO_EDGES,
        );
        const after = applyEvent(event, nodes, NO_EDGES).nodes;
        expect(childrenInside(after, 'g')).toBe(true);
        // 以前の不具合: 広げた分が op に載らず、再読み込みで元の枠に戻った
        expect(projectLayoutOps(nodes, graphEventToOps(event))).toEqual(
          boxes(after),
        );
        const undone = applyEvent(invertEvent(event), after, NO_EDGES).nodes;
        expect(boxes(undone)).toEqual(boxes(nodes));
      }),
    );
  });
});
