import { describe, expect, it } from 'bun:test';
import type { Node } from '@xyflow/react';
import { RF_GROUP_NODE_TYPE } from '../graphTransform';
import type { Position } from './coords';
import {
  buildDragStopEvents,
  draggedNodesOf,
  resolveDropTargets,
  withDraggedPositions,
} from './dragStop';

function node(
  id: string,
  position: Position,
  parentId?: string,
  extra: Partial<Node> = {},
): Node {
  return {
    id,
    position,
    data: {},
    measured: { width: 100, height: 50 },
    ...(parentId ? { parentId } : {}),
    ...extra,
  } as Node;
}

function groupNode(
  id: string,
  position: Position,
  size: { width: number; height: number },
  parentId?: string,
): Node {
  return node(id, position, parentId, {
    type: RF_GROUP_NODE_TYPE,
    style: size,
    measured: size,
  });
}

/** ドラッグ後の位置を持つ同じ id のノード (React Flow が第 3 引数で渡してくる形) */
function dragged(original: Node, position: Position): Node {
  return { ...original, position };
}

function positionsOf(nodes: Node[]): Map<string, Position> {
  return new Map(nodes.map((n) => [n.id, { ...n.position }]));
}

describe('draggedNodesOf', () => {
  const grabbed = node('n1', { x: 0, y: 0 });
  const other = node('n2', { x: 0, y: 0 });

  it('第 3 引数があればそれをそのまま使う', () => {
    expect(draggedNodesOf(grabbed, [grabbed, other])).toEqual([grabbed, other]);
  });

  it('第 3 引数が空のときだけ掴んだノードで補う', () => {
    expect(draggedNodesOf(grabbed, [])).toEqual([grabbed]);
  });
});

describe('withDraggedPositions', () => {
  const n1 = node('n1', { x: 0, y: 0 });
  const n2 = node('n2', { x: 100, y: 0 });

  it('ドラッグ対象の position だけを最新に差し替える', () => {
    const result = withDraggedPositions(
      [dragged(n1, { x: 50, y: 60 })],
      [n1, n2],
    );

    expect(result[0].position).toEqual({ x: 50, y: 60 });
    expect(result[1].position).toEqual({ x: 100, y: 0 });
  });

  it('position 以外は元のノードのものを保つ (measured は引数側に無いことがある)', () => {
    const stale = { ...dragged(n1, { x: 50, y: 60 }) };
    stale.measured = undefined;

    const result = withDraggedPositions([stale], [n1, n2]);

    expect(result[0].measured).toEqual({ width: 100, height: 50 });
  });
});

describe('buildDragStopEvents', () => {
  it('動いたノードすべてに NODE_MOVED を出す (複数選択ドラッグ)', () => {
    const n1 = node('n1', { x: 0, y: 0 });
    const n2 = node('n2', { x: 200, y: 0 });
    const n3 = node('n3', { x: 400, y: 0 });
    const nodes = [n1, n2, n3];
    const before = positionsOf(nodes);

    // n1 と n2 を選択して (+30, +40) だけまとめて動かした
    const events = buildDragStopEvents(
      [dragged(n1, { x: 30, y: 40 }), dragged(n2, { x: 230, y: 40 })],
      nodes,
      before,
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'NODE_MOVED',
      nodeId: 'n1',
      from: { x: 0, y: 0 },
      to: { x: 30, y: 40 },
    });
    expect(events[1]).toMatchObject({
      type: 'NODE_MOVED',
      nodeId: 'n2',
      from: { x: 200, y: 0 },
      to: { x: 230, y: 40 },
    });
  });

  it('掴んだ 1 個だけを渡せば 1 件だけ出る (単独ドラッグは今まで通り)', () => {
    const n1 = node('n1', { x: 0, y: 0 });
    const n2 = node('n2', { x: 200, y: 0 });
    const nodes = [n1, n2];

    const events = buildDragStopEvents(
      [dragged(n1, { x: 30, y: 40 })],
      nodes,
      positionsOf(nodes),
    );

    expect(events).toHaveLength(1);
    expect(events[0].nodeId).toBe('n1');
  });

  it('位置が変わっていないノードは何も出さない', () => {
    const n1 = node('n1', { x: 0, y: 0 });
    const nodes = [n1];

    expect(buildDragStopEvents([n1], nodes, positionsOf(nodes))).toEqual([]);
  });

  it('ドラッグ開始位置が控えられていないノードは NODE_MOVED を出さない', () => {
    const n1 = node('n1', { x: 0, y: 0 });

    const events = buildDragStopEvents(
      [dragged(n1, { x: 30, y: 40 })],
      [n1],
      new Map(),
    );

    expect(events).toEqual([]);
  });

  it('グループへ入ったノードには NODE_REPARENTED を出す', () => {
    const group = groupNode(
      'g1',
      { x: 400, y: 0 },
      { width: 300, height: 200 },
    );
    const n1 = node('n1', { x: 0, y: 0 });
    const nodes = [group, n1];

    // n1 の中心 (50,25 のオフセット) がグループの内側へ入る位置まで動かす
    const events = buildDragStopEvents(
      [dragged(n1, { x: 500, y: 60 })],
      nodes,
      positionsOf(nodes),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'NODE_REPARENTED',
      nodeId: 'n1',
      oldParentId: undefined,
      newParentId: 'g1',
      // 絶対座標 (500,60) をグループ (400,0) から見た相対座標へ直す
      newPosition: { x: 100, y: 60 },
    });
  });

  it('複数ノードをまとめてグループへ落とすと全員分の NODE_REPARENTED が出る', () => {
    const group = groupNode(
      'g1',
      { x: 400, y: 0 },
      { width: 400, height: 300 },
    );
    const n1 = node('n1', { x: 0, y: 0 });
    const n2 = node('n2', { x: 0, y: 100 });
    const nodes = [group, n1, n2];

    const events = buildDragStopEvents(
      [dragged(n1, { x: 500, y: 60 }), dragged(n2, { x: 500, y: 160 })],
      nodes,
      positionsOf(nodes),
    );

    expect(events.map((e) => [e.type, e.nodeId])).toEqual([
      ['NODE_REPARENTED', 'n1'],
      ['NODE_REPARENTED', 'n2'],
    ]);
  });

  it('先のイベントでグループがずれても後のノードの相対座標が合う', () => {
    // グループの左上ぎりぎりへ 2 個落とす。1 個目で recalculateParentBounds が
    // グループを左上へ広げる (= グループの position が動く) ので、2 個目の相対座標を
    // 元のグループ位置から求めると合わなくなる
    const group = groupNode(
      'g1',
      { x: 400, y: 0 },
      { width: 400, height: 300 },
    );
    const n1 = node('n1', { x: 0, y: 0 });
    const n2 = node('n2', { x: 0, y: 100 });
    const nodes = [group, n1, n2];

    // n1 はグループ左上の余白 (GROUP_PADDING=20 / GROUP_TITLE_HEIGHT=30) より内側へ入れる
    const events = buildDragStopEvents(
      [dragged(n1, { x: 405, y: 5 }), dragged(n2, { x: 600, y: 200 })],
      nodes,
      positionsOf(nodes),
    );

    const [first, second] = events;
    expect(first).toMatchObject({ type: 'NODE_REPARENTED', nodeId: 'n1' });
    expect(second).toMatchObject({ type: 'NODE_REPARENTED', nodeId: 'n2' });

    if (first.type !== 'NODE_REPARENTED' || second.type !== 'NODE_REPARENTED') {
      throw new Error('NODE_REPARENTED を期待');
    }
    // n1 の相対座標 (5,5) は余白 (左 20 / 上 30+20) より内側なので、グループが
    // 左へ 15・上へ 45 広がり position は (385,-45) になる。
    // その基準で n2 の絶対座標 (600,200) は相対 (215,245)。
    // 元の (400,0) を基準にすると (200,200) となり 45 ずれる
    expect(second.newPosition).toEqual({ x: 215, y: 245 });
  });

  it('グループから出たノードは newParentId が undefined になり絶対座標へ戻る', () => {
    const group = groupNode(
      'g1',
      { x: 400, y: 0 },
      { width: 300, height: 200 },
    );
    const child = node('n1', { x: 40, y: 60 }, 'g1');
    const nodes = [group, child];

    // グループの外まで十分に離す (中心が親の外へ出るまで動かす)
    const events = buildDragStopEvents(
      [dragged(child, { x: -600, y: 60 })],
      nodes,
      positionsOf(nodes),
    );

    expect(events[0]).toMatchObject({
      type: 'NODE_REPARENTED',
      nodeId: 'n1',
      oldParentId: 'g1',
      newParentId: undefined,
      // 絶対座標 = グループ (400,0) + 相対 (-600,60)
      newPosition: { x: -200, y: 60 },
    });
  });

  it('親が変わらなければ NODE_MOVED のまま (グループ内で動かした場合)', () => {
    const group = groupNode(
      'g1',
      { x: 400, y: 0 },
      { width: 300, height: 200 },
    );
    const child = node('n1', { x: 40, y: 60 }, 'g1');
    const nodes = [group, child];

    const events = buildDragStopEvents(
      [dragged(child, { x: 80, y: 90 })],
      nodes,
      positionsOf(nodes),
    );

    expect(events[0]).toMatchObject({
      type: 'NODE_MOVED',
      nodeId: 'n1',
      from: { x: 40, y: 60 },
      to: { x: 80, y: 90 },
    });
  });
});

describe('resolveDropTargets', () => {
  const group = groupNode('g1', { x: 400, y: 0 }, { width: 400, height: 300 });
  const n1 = node('n1', { x: 0, y: 0 });
  const n2 = node('n2', { x: 0, y: 100 });
  const nodes = [group, n1, n2];

  it('ドロップ先はノードごとにそのノード自身の位置で決まる', () => {
    const targets = resolveDropTargets(
      [dragged(n1, { x: 500, y: 60 }), dragged(n2, { x: 0, y: 100 })],
      nodes,
    );

    expect(targets.get('n1')?.id).toBe('g1');
    expect(targets.get('n2')).toBeUndefined();
  });

  it('確定時 (buildDragStopEvents) と同じ結果を返す', () => {
    const draggedNodes = [
      dragged(n1, { x: 500, y: 60 }),
      dragged(n2, { x: 0, y: 100 }),
    ];
    const targets = resolveDropTargets(draggedNodes, nodes);
    const events = buildDragStopEvents(draggedNodes, nodes, positionsOf(nodes));

    const reparented = events.find((e) => e.type === 'NODE_REPARENTED');
    expect(reparented?.nodeId).toBe('n1');
    expect(
      reparented?.type === 'NODE_REPARENTED'
        ? reparented.newParentId
        : undefined,
    ).toBe(targets.get('n1')?.id);
  });
});
