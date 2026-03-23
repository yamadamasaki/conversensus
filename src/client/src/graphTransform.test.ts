import { describe, expect, it } from 'bun:test';
import type {
  EdgeId,
  GraphEdge,
  GraphNode,
  NodeId,
} from '@conversensus/shared';
import { type Edge, MarkerType, type Node } from '@xyflow/react';
import {
  fromFlowEdges,
  fromFlowNodes,
  recalculateParentBounds,
  toFlowEdges,
  toFlowNodes,
} from './graphTransform';

const graphNodes: GraphNode[] = [
  { id: 'n1' as NodeId, content: 'ノード1', style: { x: 10, y: 20 } },
  {
    id: 'n2' as NodeId,
    content: 'ノード2',
    style: { x: 100, y: 200, color: 'red' },
  },
];

const graphEdges: GraphEdge[] = [
  {
    id: 'e1' as EdgeId,
    source: 'n1' as NodeId,
    target: 'n2' as NodeId,
    label: 'ラベル',
  },
  { id: 'e2' as EdgeId, source: 'n2' as NodeId, target: 'n1' as NodeId },
];

describe('toFlowNodes', () => {
  it('GraphNode を React Flow の Node に変換する', () => {
    const result = toFlowNodes(graphNodes);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: 'n1',
      position: { x: 10, y: 20 },
      data: { label: 'ノード1' },
      type: 'editableNode',
    });
    expect(result[1]).toMatchObject({
      id: 'n2',
      position: { x: 100, y: 200 },
      data: { label: 'ノード2' },
      type: 'editableNode',
    });
  });

  it('空配列は空配列を返す', () => {
    expect(toFlowNodes([])).toEqual([]);
  });
});

describe('toFlowEdges', () => {
  it('GraphEdge を React Flow の Edge に変換する', () => {
    const result = toFlowEdges(graphEdges);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: 'e1',
      source: 'n1',
      target: 'n2',
      label: 'ラベル',
      type: 'editableLabel',
      markerEnd: { type: MarkerType.ArrowClosed },
    });
    expect(result[1]).toMatchObject({
      id: 'e2',
      source: 'n2',
      target: 'n1',
      type: 'editableLabel',
      markerEnd: { type: MarkerType.ArrowClosed },
    });
  });

  it('空配列は空配列を返す', () => {
    expect(toFlowEdges([])).toEqual([]);
  });
});

describe('fromFlowNodes', () => {
  it('React Flow の Node を GraphNode に変換する', () => {
    const flowNodes: Node[] = [
      {
        id: 'n1',
        position: { x: 10, y: 20 },
        data: { label: 'ノード1' },
        type: 'default',
      },
    ];
    const result = fromFlowNodes(flowNodes);
    expect(result[0]).toMatchObject({
      id: 'n1',
      content: 'ノード1',
      style: { x: 10, y: 20 },
    });
  });

  it('label が undefined のとき content は空文字になる', () => {
    const flowNodes: Node[] = [
      { id: 'n1', position: { x: 0, y: 0 }, data: {}, type: 'default' },
    ];
    const result = fromFlowNodes(flowNodes);
    expect(result[0].content).toBe('');
  });

  it('空配列は空配列を返す', () => {
    expect(fromFlowNodes([])).toEqual([]);
  });
});

describe('fromFlowEdges', () => {
  it('React Flow の Edge を GraphEdge に変換する', () => {
    const flowEdges: Edge[] = [
      { id: 'e1', source: 'n1', target: 'n2', label: 'ラベル' },
    ];
    const result = fromFlowEdges(flowEdges);
    expect(result[0]).toMatchObject({
      id: 'e1',
      source: 'n1',
      target: 'n2',
      label: 'ラベル',
    });
  });

  it('label が string でない場合は undefined になる', () => {
    const flowEdges: Edge[] = [
      { id: 'e1', source: 'n1', target: 'n2', label: 42 as unknown as string },
    ];
    const result = fromFlowEdges(flowEdges);
    expect(result[0].label).toBeUndefined();
  });

  it('label がない Edge は label が undefined になる', () => {
    const flowEdges: Edge[] = [{ id: 'e2', source: 'n2', target: 'n1' }];
    const result = fromFlowEdges(flowEdges);
    expect(result[0].label).toBeUndefined();
  });

  it('空配列は空配列を返す', () => {
    expect(fromFlowEdges([])).toEqual([]);
  });
});

describe('toFlowNodes → fromFlowNodes の対称性', () => {
  it('変換して戻すと元のデータが復元される', () => {
    const result = fromFlowNodes(toFlowNodes(graphNodes));
    expect(result[0]).toMatchObject({
      id: 'n1',
      content: 'ノード1',
      style: { x: 10, y: 20 },
    });
    expect(result[1]).toMatchObject({
      id: 'n2',
      content: 'ノード2',
      style: { x: 100, y: 200 },
    });
  });
});

describe('toFlowNodes: グループノード (parentId / nodeType)', () => {
  it('nodeType=group の GraphNode は groupNode 型に変換される', () => {
    const nodes: GraphNode[] = [
      {
        id: 'g1' as NodeId,
        content: 'グループ',
        style: { x: 0, y: 0, width: 200, height: 150, nodeType: 'group' },
      },
    ];
    expect(toFlowNodes(nodes)[0].type).toBe('groupNode');
  });

  it('parentId を持つ GraphNode は parentId が引き継がれる', () => {
    const nodes: GraphNode[] = [
      {
        id: 'n1' as NodeId,
        content: 'child',
        parentId: 'g1' as NodeId,
        style: { x: 20, y: 50 },
      },
    ];
    expect(toFlowNodes(nodes)[0].parentId).toBe('g1');
  });
});

describe('fromFlowNodes: parentId / groupNode', () => {
  it('parentId を持つ Node は parentId が引き継がれる', () => {
    const flowNodes: Node[] = [
      {
        id: 'n1',
        parentId: 'g1',
        position: { x: 20, y: 50 },
        data: { label: 'child' },
        type: 'editableNode',
      },
    ];
    expect(fromFlowNodes(flowNodes)[0].parentId).toBe('g1');
  });

  it('groupNode 型は style.nodeType=group として保存される', () => {
    const flowNodes: Node[] = [
      {
        id: 'g1',
        position: { x: 0, y: 0 },
        data: { label: 'グループ' },
        type: 'groupNode',
      },
    ];
    expect(fromFlowNodes(flowNodes)[0].style?.nodeType).toBe('group');
  });
});

describe('recalculateParentBounds', () => {
  const makeParent = (
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): Node => ({
    id,
    position: { x, y },
    data: {},
    type: 'groupNode',
    style: { width: w, height: h },
  });

  const makeChild = (
    id: string,
    parentId: string,
    x: number,
    y: number,
    w = 160,
    h = 80,
  ): Node => ({
    id,
    parentId,
    position: { x, y },
    data: {},
    type: 'editableNode',
    style: { width: w, height: h },
  });

  it('子ノードがない場合は変化なし', () => {
    const nodes = [makeParent('g1', 0, 0, 300, 200)];
    expect(recalculateParentBounds(nodes)).toEqual(nodes);
  });

  it('子ノードが境界内に収まっている場合は変化なし', () => {
    // child at (20, 50) with 160x80: right=180 < 300-20, bottom=130 < 200-20
    const nodes = [
      makeParent('g1', 0, 0, 300, 200),
      makeChild('n1', 'g1', 20, 50),
    ];
    expect(recalculateParentBounds(nodes)).toEqual(nodes);
  });

  it('子ノードが右にはみ出した場合, 親の幅が拡大される', () => {
    // child at (200, 50): right=360 → newWidth = 360 + GROUP_PADDING = 380
    const nodes = [
      makeParent('g1', 0, 0, 300, 200),
      makeChild('n1', 'g1', 200, 50),
    ];
    const result = recalculateParentBounds(nodes);
    const parent = result.find((n) => n.id === 'g1');
    expect(Number(parent?.style?.width)).toBe(380);
    expect(Number(parent?.style?.height)).toBe(200);
    expect(parent?.position).toEqual({ x: 0, y: 0 });
  });

  it('子ノードが下にはみ出した場合, 親の高さが拡大される', () => {
    // child at (20, 150): bottom=230 → newHeight = 230 + GROUP_PADDING = 250
    const nodes = [
      makeParent('g1', 0, 0, 300, 200),
      makeChild('n1', 'g1', 20, 150),
    ];
    const result = recalculateParentBounds(nodes);
    expect(Number(result.find((n) => n.id === 'g1')?.style?.height)).toBe(250);
  });

  it('子ノードが左にはみ出した場合, 親が左にシフトし子の相対位置が調整される', () => {
    // child at (5, 50): leftOverflow = GROUP_PADDING - 5 = 15
    // parent.x = 100 - 15 = 85, child.x = 5 + 15 = 20
    const nodes = [
      makeParent('g1', 100, 100, 300, 200),
      makeChild('n1', 'g1', 5, 50),
    ];
    const result = recalculateParentBounds(nodes);
    expect(result.find((n) => n.id === 'g1')?.position.x).toBe(85);
    expect(result.find((n) => n.id === 'n1')?.position.x).toBe(20);
  });

  it('子ノードが上にはみ出した場合, 親が上にシフトし子の相対位置が調整される', () => {
    // child at (20, 10): topOverflow = GROUP_TITLE_HEIGHT + GROUP_PADDING - 10 = 40
    // parent.y = 100 - 40 = 60, child.y = 10 + 40 = 50
    const nodes = [
      makeParent('g1', 100, 100, 300, 200),
      makeChild('n1', 'g1', 20, 10),
    ];
    const result = recalculateParentBounds(nodes);
    expect(result.find((n) => n.id === 'g1')?.position.y).toBe(60);
    expect(result.find((n) => n.id === 'n1')?.position.y).toBe(50);
  });
});

describe('toFlowEdges → fromFlowEdges の対称性', () => {
  it('label ありの Edge は変換して戻すと復元される', () => {
    const result = fromFlowEdges(toFlowEdges(graphEdges));
    expect(result[0]).toMatchObject({
      id: 'e1',
      source: 'n1',
      target: 'n2',
      label: 'ラベル',
    });
  });
});
