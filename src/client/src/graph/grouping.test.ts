import { describe, expect, it } from 'bun:test';
import type { NodeId } from '@conversensus/shared';
import type { Node } from '@xyflow/react';
import { applyEvent } from '../events/applyEvent';
import { RF_GROUP_NODE_TYPE } from '../graphTransform';
import { absolutePositionOf } from './coords';
import { buildNodesGroupedEvent, buildNodesUngroupedEvent } from './grouping';

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
    measured: { width: 100, height: 50 },
    ...(parentId ? { parentId } : {}),
    ...extra,
  } as Node;
}

function groupNode(
  id: string,
  position: { x: number; y: number },
  size: { width: number; height: number },
  parentId?: string,
): Node {
  return node(id, position, parentId, {
    type: RF_GROUP_NODE_TYPE,
    style: size,
    measured: size,
  });
}

describe('buildNodesGroupedEvent', () => {
  const n1 = node('n1', { x: 100, y: 100 });
  const n2 = node('n2', { x: 300, y: 200 });
  const nodes = [n1, n2];

  it('選択が空なら undefined を返す', () => {
    expect(buildNodesGroupedEvent([], nodes)).toBeUndefined();
  });

  it('選択ノードを余白ごと囲む矩形をグループの layout にする', () => {
    const event = buildNodesGroupedEvent(nodes, nodes);

    // 外接矩形 (100,100)-(400,250) に GROUP_PADDING=20 と GROUP_TITLE_HEIGHT=30
    expect(event?.parentLayout).toMatchObject({
      x: 80,
      y: 50,
      width: 340,
      height: 220,
    });
  });

  it('子の outerPosition は現在の位置、innerPosition はグループから見た相対座標', () => {
    const event = buildNodesGroupedEvent(nodes, nodes);

    expect(event?.children).toEqual([
      {
        nodeId: 'n1' as NodeId,
        outerParentId: undefined,
        outerPosition: { x: 100, y: 100 },
        innerPosition: { x: 20, y: 50 },
      },
      {
        nodeId: 'n2' as NodeId,
        outerParentId: undefined,
        outerPosition: { x: 300, y: 200 },
        innerPosition: { x: 220, y: 150 },
      },
    ]);
  });

  it('選択ノードの親が揃っていればグループ自身もその親の子になる', () => {
    const og = groupNode('og', { x: 10, y: 10 }, { width: 500, height: 500 });
    const c1 = node('c1', { x: 100, y: 100 }, 'og');
    const c2 = node('c2', { x: 300, y: 200 }, 'og');
    const withParent = [og, c1, c2];

    const event = buildNodesGroupedEvent([c1, c2], withParent);

    expect(event?.parentData.parentId).toBe('og' as NodeId);
    // グループの position は og から見た相対座標 (絶対 (90,60) − og (10,10))
    expect(event?.parentLayout).toMatchObject({ x: 80, y: 50 });
    expect(event?.children[0].outerParentId).toBe('og' as NodeId);
  });

  it('選択ノードの親が揃っていなければグループはトップレベルに作る', () => {
    const og = groupNode('og', { x: 10, y: 10 }, { width: 500, height: 500 });
    const c1 = node('c1', { x: 100, y: 100 }, 'og');
    const mixed = [og, c1, n2];

    const event = buildNodesGroupedEvent([c1, n2], mixed);

    expect(event?.parentData.parentId).toBeUndefined();
  });
});

describe('buildNodesUngroupedEvent', () => {
  it('グループ以外のノードでは undefined を返す', () => {
    const n1 = node('n1', { x: 0, y: 0 });

    expect(buildNodesUngroupedEvent(n1, [n1])).toBeUndefined();
  });

  it('トップレベルのグループでは子が絶対座標でトップレベルへ出る', () => {
    const g = groupNode('g', { x: 80, y: 50 }, { width: 340, height: 220 });
    const c = node('c', { x: 20, y: 50 }, 'g');
    const nodes = [g, c];

    const event = buildNodesUngroupedEvent(g, nodes);

    expect(event?.children).toEqual([
      {
        nodeId: 'c' as NodeId,
        outerParentId: undefined,
        outerPosition: { x: 100, y: 100 },
        innerPosition: { x: 20, y: 50 },
      },
    ]);
  });

  // 設計の受入基準: グループ化した後にグループを動かしてから解除しても子は動かない。
  // ペイロードをグループ化時点の値ではなく解除時点の実状態から作ることで満たす
  it('グループを動かした後でも子は画面上の同じ位置に留まる', () => {
    const moved = groupNode(
      'g',
      { x: 500, y: 500 },
      { width: 340, height: 220 },
    );
    const c = node('c', { x: 20, y: 50 }, 'g');
    const nodes = [moved, c];

    const event = buildNodesUngroupedEvent(moved, nodes);

    expect(event?.children[0].outerPosition).toEqual(
      absolutePositionOf(c, nodes),
    );
  });

  it('入れ子のグループでは子が一段上のグループへ移る', () => {
    const og = groupNode('og', { x: 10, y: 10 }, { width: 500, height: 500 });
    const g = groupNode(
      'g',
      { x: 40, y: 40 },
      { width: 200, height: 200 },
      'og',
    );
    const c = node('c', { x: 5, y: 5 }, 'g');
    const nodes = [og, g, c];

    const event = buildNodesUngroupedEvent(g, nodes);

    expect(event?.children[0]).toMatchObject({
      outerParentId: 'og' as NodeId,
      // 子の絶対座標 (55,55) − og の絶対座標 (10,10)
      outerPosition: { x: 45, y: 45 },
    });
  });

  it('同時に解除されるグループは親候補から外し、生き残る祖先まで遡る', () => {
    const og = groupNode('og', { x: 10, y: 10 }, { width: 500, height: 500 });
    const g = groupNode(
      'g',
      { x: 40, y: 40 },
      { width: 200, height: 200 },
      'og',
    );
    const c = node('c', { x: 5, y: 5 }, 'g');
    const nodes = [og, g, c];

    const event = buildNodesUngroupedEvent(g, nodes, new Set(['og', 'g']));

    expect(event?.children[0]).toMatchObject({
      outerParentId: undefined,
      outerPosition: { x: 55, y: 55 },
    });
  });

  it('子を持たないグループでも解除できる (グループだけが消える)', () => {
    const g = groupNode('g', { x: 0, y: 0 }, { width: 100, height: 100 });

    expect(buildNodesUngroupedEvent(g, [g])?.children).toEqual([]);
  });
});

describe('グループ化 → 解除の往復', () => {
  it('解除すると元の親と位置に戻る', () => {
    const n1 = node('n1', { x: 100, y: 100 });
    const n2 = node('n2', { x: 300, y: 200 });
    const before = [n1, n2];

    const grouped = buildNodesGroupedEvent(before, before);
    if (!grouped) throw new Error('グループ化イベントが作られなかった');
    const afterGroup = applyEvent(grouped, before, []).nodes;

    const group = afterGroup.find((n) => n.id === grouped.parentId);
    if (!group) throw new Error('グループノードが見つからない');
    const ungrouped = buildNodesUngroupedEvent(group, afterGroup);
    if (!ungrouped) throw new Error('解除イベントが作られなかった');
    const afterUngroup = applyEvent(ungrouped, afterGroup, []).nodes;

    expect(afterUngroup.map((n) => n.id)).toEqual(['n1', 'n2']);
    for (const original of before) {
      const restored = afterUngroup.find((n) => n.id === original.id);
      expect(restored?.parentId).toBeUndefined();
      expect(restored?.position).toEqual(original.position);
    }
  });
});
