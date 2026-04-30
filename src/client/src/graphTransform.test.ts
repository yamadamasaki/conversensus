import { describe, expect, it } from 'bun:test';
import type {
  EdgeId,
  EdgeLayout,
  GraphEdge,
  GraphNode,
  NodeId,
  NodeLayout,
} from '@conversensus/shared';
import { type Edge, MarkerType, type Node } from '@xyflow/react';
import {
  buildPastedData,
  collectCopyData,
  fromFlowEdges,
  fromFlowNodes,
  recalculateParentBounds,
  toFlowEdges,
  toFlowNodes,
} from './graphTransform';

const graphNodes: GraphNode[] = [
  { id: 'n1' as NodeId, content: 'ノード1' },
  { id: 'n2' as NodeId, content: 'ノード2' },
];

const graphLayouts: NodeLayout[] = [
  { nodeId: 'n1' as NodeId, x: 10, y: 20 },
  { nodeId: 'n2' as NodeId, x: 100, y: 200 },
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
    const result = toFlowNodes(graphNodes, graphLayouts);
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

  it('レイアウトがない場合は位置が (0, 0) になる', () => {
    const result = toFlowNodes(graphNodes);
    expect(result[0].position).toEqual({ x: 0, y: 0 });
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

  it('edgeLayouts の pathType が data.pathType に変換される', () => {
    const edges: GraphEdge[] = [
      { id: 'e1' as EdgeId, source: 'n1' as NodeId, target: 'n2' as NodeId },
    ];
    const edgeLayouts: EdgeLayout[] = [
      { edgeId: 'e1' as EdgeId, pathType: 'straight' },
    ];
    expect(toFlowEdges(edges, edgeLayouts)[0].data?.pathType).toBe('straight');
  });

  it('edgeLayouts がない場合は data.pathType が "bezier" になる', () => {
    const edges: GraphEdge[] = [
      { id: 'e1' as EdgeId, source: 'n1' as NodeId, target: 'n2' as NodeId },
    ];
    expect(toFlowEdges(edges)[0].data?.pathType).toBe('bezier');
  });

  it('edgeLayouts の labelOffsetX/Y が data.labelOffsetX/Y に変換される', () => {
    const edges: GraphEdge[] = [
      { id: 'e1' as EdgeId, source: 'n1' as NodeId, target: 'n2' as NodeId },
    ];
    const edgeLayouts: EdgeLayout[] = [
      { edgeId: 'e1' as EdgeId, labelOffsetX: 30, labelOffsetY: -15 },
    ];
    expect(toFlowEdges(edges, edgeLayouts)[0].data?.labelOffsetX).toBe(30);
    expect(toFlowEdges(edges, edgeLayouts)[0].data?.labelOffsetY).toBe(-15);
  });

  it('edgeLayouts が未指定の場合は data.labelOffsetX/Y が 0 になる', () => {
    const edges: GraphEdge[] = [
      { id: 'e1' as EdgeId, source: 'n1' as NodeId, target: 'n2' as NodeId },
    ];
    expect(toFlowEdges(edges)[0].data?.labelOffsetX).toBe(0);
    expect(toFlowEdges(edges)[0].data?.labelOffsetY).toBe(0);
  });
});

describe('fromFlowNodes', () => {
  it('React Flow の Node を GraphNode と NodeLayout に変換する', () => {
    const flowNodes: Node[] = [
      {
        id: 'n1',
        position: { x: 10, y: 20 },
        data: { label: 'ノード1' },
        type: 'default',
      },
    ];
    const { nodes, layouts } = fromFlowNodes(flowNodes);
    expect(nodes[0]).toMatchObject({
      id: 'n1',
      content: 'ノード1',
    });
    expect(layouts[0]).toMatchObject({
      nodeId: 'n1',
      x: 10,
      y: 20,
    });
  });

  it('label が undefined のとき content は空文字になる', () => {
    const flowNodes: Node[] = [
      { id: 'n1', position: { x: 0, y: 0 }, data: {}, type: 'default' },
    ];
    const { nodes } = fromFlowNodes(flowNodes);
    expect(nodes[0].content).toBe('');
  });

  it('空配列は空の nodes と layouts を返す', () => {
    const { nodes, layouts } = fromFlowNodes([]);
    expect(nodes).toEqual([]);
    expect(layouts).toEqual([]);
  });
});

describe('fromFlowEdges', () => {
  it('React Flow の Edge を GraphEdge と EdgeLayout に変換する', () => {
    const flowEdges: Edge[] = [
      { id: 'e1', source: 'n1', target: 'n2', label: 'ラベル' },
    ];
    const { edges, edgeLayouts } = fromFlowEdges(flowEdges);
    expect(edges[0]).toMatchObject({
      id: 'e1',
      source: 'n1',
      target: 'n2',
      label: 'ラベル',
    });
    expect(edgeLayouts[0].edgeId).toBe('e1');
  });

  it('label が string でない場合は undefined になる', () => {
    const flowEdges: Edge[] = [
      { id: 'e1', source: 'n1', target: 'n2', label: 42 as unknown as string },
    ];
    const { edges } = fromFlowEdges(flowEdges);
    expect(edges[0].label).toBeUndefined();
  });

  it('label がない Edge は label が undefined になる', () => {
    const flowEdges: Edge[] = [{ id: 'e2', source: 'n2', target: 'n1' }];
    const { edges } = fromFlowEdges(flowEdges);
    expect(edges[0].label).toBeUndefined();
  });

  it('空配列は edges と edgeLayouts の空配列を返す', () => {
    const { edges, edgeLayouts } = fromFlowEdges([]);
    expect(edges).toEqual([]);
    expect(edgeLayouts).toEqual([]);
  });

  it('data.pathType が EdgeLayout.pathType に復元される', () => {
    const flowEdges: Edge[] = [
      { id: 'e1', source: 'n1', target: 'n2', data: { pathType: 'step' } },
    ];
    const { edgeLayouts } = fromFlowEdges(flowEdges);
    expect(edgeLayouts[0].pathType).toBe('step');
  });

  it('data.pathType がない場合は pathType が undefined になる', () => {
    const flowEdges: Edge[] = [{ id: 'e1', source: 'n1', target: 'n2' }];
    const { edgeLayouts } = fromFlowEdges(flowEdges);
    expect(edgeLayouts[0].pathType).toBeUndefined();
  });

  it('data.labelOffsetX/Y が EdgeLayout.labelOffsetX/Y に復元される', () => {
    const flowEdges: Edge[] = [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        data: { labelOffsetX: 30, labelOffsetY: -15 },
      },
    ];
    const { edgeLayouts } = fromFlowEdges(flowEdges);
    expect(edgeLayouts[0].labelOffsetX).toBe(30);
    expect(edgeLayouts[0].labelOffsetY).toBe(-15);
  });

  it('data.labelOffsetX/Y が 0 の場合は labelOffsetX/Y が undefined になる', () => {
    const flowEdges: Edge[] = [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        data: { labelOffsetX: 0, labelOffsetY: 0 },
      },
    ];
    const { edgeLayouts } = fromFlowEdges(flowEdges);
    expect(edgeLayouts[0].labelOffsetX).toBeUndefined();
    expect(edgeLayouts[0].labelOffsetY).toBeUndefined();
  });

  it('data.labelOffsetX/Y がない場合は labelOffsetX/Y が undefined になる', () => {
    const flowEdges: Edge[] = [{ id: 'e1', source: 'n1', target: 'n2' }];
    const { edgeLayouts } = fromFlowEdges(flowEdges);
    expect(edgeLayouts[0].labelOffsetX).toBeUndefined();
    expect(edgeLayouts[0].labelOffsetY).toBeUndefined();
  });
});

describe('toFlowNodes → fromFlowNodes の対称性', () => {
  it('変換して戻すと元のデータが復元される', () => {
    const { nodes, layouts } = fromFlowNodes(
      toFlowNodes(graphNodes, graphLayouts),
    );
    expect(nodes[0]).toMatchObject({
      id: 'n1',
      content: 'ノード1',
    });
    expect(layouts[0]).toMatchObject({
      nodeId: 'n1',
      x: 10,
      y: 20,
    });
    expect(nodes[1]).toMatchObject({
      id: 'n2',
      content: 'ノード2',
    });
    expect(layouts[1]).toMatchObject({
      nodeId: 'n2',
      x: 100,
      y: 200,
    });
  });
});

describe('toFlowNodes: グループノード (parentId / nodeType)', () => {
  it('nodeType=group の NodeLayout は groupNode 型に変換される', () => {
    const nodes: GraphNode[] = [{ id: 'g1' as NodeId, content: 'グループ' }];
    const layouts: NodeLayout[] = [
      {
        nodeId: 'g1' as NodeId,
        x: 0,
        y: 0,
        width: 200,
        height: 150,
        nodeType: 'group',
      },
    ];
    expect(toFlowNodes(nodes, layouts)[0].type).toBe('groupNode');
  });

  it('parentId を持つ NodeLayout は parentId が引き継がれる', () => {
    const nodes: GraphNode[] = [{ id: 'n1' as NodeId, content: 'child' }];
    const layouts: NodeLayout[] = [
      { nodeId: 'n1' as NodeId, x: 20, y: 50, parentId: 'g1' as NodeId },
    ];
    expect(toFlowNodes(nodes, layouts)[0].parentId).toBe('g1');
  });
});

describe('fromFlowNodes: parentId / groupNode', () => {
  it('parentId を持つ Node は layout.parentId として保存される', () => {
    const flowNodes: Node[] = [
      {
        id: 'n1',
        parentId: 'g1',
        position: { x: 20, y: 50 },
        data: { label: 'child' },
        type: 'editableNode',
      },
    ];
    const result = fromFlowNodes(flowNodes);
    expect(result.nodes[0]).not.toHaveProperty('parentId');
    expect(result.layouts[0].parentId).toBe('g1');
  });

  it('groupNode 型は layout.nodeType=group として保存される', () => {
    const flowNodes: Node[] = [
      {
        id: 'g1',
        position: { x: 0, y: 0 },
        data: { label: 'グループ' },
        type: 'groupNode',
      },
    ];
    expect(fromFlowNodes(flowNodes).layouts[0].nodeType).toBe('group');
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

  it('style.width より measured.width が大きい場合も正しく拡大される', () => {
    // 手動リサイズ後: style が固定値でも measured (実際のDOMサイズ) が大きければ反映される
    const parent: Node = {
      id: 'g1',
      position: { x: 0, y: 0 },
      data: {},
      type: 'groupNode',
      style: { width: 200, height: 200 }, // 手動リサイズ後の固定値
      measured: { width: 400, height: 300 }, // ReactFlow の実測値
    };
    const child: Node = {
      id: 'n1',
      parentId: 'g1',
      position: { x: 380, y: 50 }, // x=380 + width=160 = 540 > 400
      data: {},
      type: 'editableNode',
      style: { width: 160, height: 80 },
    };
    const result = recalculateParentBounds([parent, child]);
    const resultParent = result.find((n) => n.id === 'g1');
    // child right = 380 + 160 = 540, newWidth = max(200,400, 540+20) = 560
    expect(Number(resultParent?.style?.width)).toBe(560);
    // height: child bottom = 50 + 80 = 130 < max(200,300) = 300 → no change
    expect(Number(resultParent?.style?.height)).toBe(300);
  });
});

describe('toFlowEdges → fromFlowEdges の対称性', () => {
  it('label ありの Edge は変換して戻すと復元される', () => {
    const { edges } = fromFlowEdges(toFlowEdges(graphEdges));
    expect(edges[0]).toMatchObject({
      id: 'e1',
      source: 'n1',
      target: 'n2',
      label: 'ラベル',
    });
  });

  it('pathType が変換して戻すと復元される', () => {
    const edges: GraphEdge[] = [
      { id: 'e1' as EdgeId, source: 'n1' as NodeId, target: 'n2' as NodeId },
    ];
    const edgeLayouts: EdgeLayout[] = [
      { edgeId: 'e1' as EdgeId, pathType: 'smoothstep' },
    ];
    const { edgeLayouts: result } = fromFlowEdges(
      toFlowEdges(edges, edgeLayouts),
    );
    expect(result[0].pathType).toBe('smoothstep');
  });

  it('labelOffset が変換して戻すと復元される', () => {
    const edges: GraphEdge[] = [
      { id: 'e1' as EdgeId, source: 'n1' as NodeId, target: 'n2' as NodeId },
    ];
    const edgeLayouts: EdgeLayout[] = [
      { edgeId: 'e1' as EdgeId, labelOffsetX: 42, labelOffsetY: -8 },
    ];
    const { edgeLayouts: result } = fromFlowEdges(
      toFlowEdges(edges, edgeLayouts),
    );
    expect(result[0].labelOffsetX).toBe(42);
    expect(result[0].labelOffsetY).toBe(-8);
  });
});

describe('toFlowEdges: sourceHandle / targetHandle', () => {
  it('edgeLayouts の sourceHandle / targetHandle が React Flow の Edge に渡される', () => {
    const edges: GraphEdge[] = [
      { id: 'e1' as EdgeId, source: 'n1' as NodeId, target: 'n2' as NodeId },
    ];
    const edgeLayouts: EdgeLayout[] = [
      {
        edgeId: 'e1' as EdgeId,
        sourceHandle: 'source-bottom',
        targetHandle: 'source-top',
      },
    ];
    const result = toFlowEdges(edges, edgeLayouts);
    expect(result[0].sourceHandle).toBe('source-bottom');
    expect(result[0].targetHandle).toBe('source-top');
  });

  it('edgeLayouts がない場合は sourceHandle / targetHandle が undefined になる', () => {
    const result = toFlowEdges(graphEdges);
    expect(result[0].sourceHandle).toBeUndefined();
    expect(result[0].targetHandle).toBeUndefined();
  });
});

describe('fromFlowEdges: sourceHandle / targetHandle', () => {
  it('sourceHandle と targetHandle が EdgeLayout に保持される', () => {
    const flowEdges: Edge[] = [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        sourceHandle: 'source-bottom',
        targetHandle: 'source-top',
      },
    ];
    const { edgeLayouts } = fromFlowEdges(flowEdges);
    expect(edgeLayouts[0].sourceHandle).toBe('source-bottom');
    expect(edgeLayouts[0].targetHandle).toBe('source-top');
  });

  it('sourceHandle が null の場合は undefined になる', () => {
    const flowEdges: Edge[] = [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        sourceHandle: null,
        targetHandle: null,
      },
    ];
    const { edgeLayouts } = fromFlowEdges(flowEdges);
    expect(edgeLayouts[0].sourceHandle).toBeUndefined();
    expect(edgeLayouts[0].targetHandle).toBeUndefined();
  });

  it('sourceHandle がない Edge は undefined になる', () => {
    const flowEdges: Edge[] = [{ id: 'e1', source: 'n1', target: 'n2' }];
    const { edgeLayouts } = fromFlowEdges(flowEdges);
    expect(edgeLayouts[0].sourceHandle).toBeUndefined();
    expect(edgeLayouts[0].targetHandle).toBeUndefined();
  });
});

describe('toFlowEdges → fromFlowEdges: sourceHandle / targetHandle の対称性', () => {
  it('handle 情報が変換して戻すと復元される', () => {
    const edges: GraphEdge[] = [
      { id: 'e1' as EdgeId, source: 'n1' as NodeId, target: 'n2' as NodeId },
    ];
    const edgeLayouts: EdgeLayout[] = [
      {
        edgeId: 'e1' as EdgeId,
        sourceHandle: 'source-right',
        targetHandle: 'source-left',
      },
    ];
    const { edgeLayouts: result } = fromFlowEdges(
      toFlowEdges(edges, edgeLayouts),
    );
    expect(result[0].sourceHandle).toBe('source-right');
    expect(result[0].targetHandle).toBe('source-left');
  });
});

// ---- collectCopyData ----

const makeNode = (id: string, selected = false, parentId?: string): Node => ({
  id,
  position: { x: 10, y: 20 },
  data: { label: id },
  type: 'editableNode',
  selected,
  parentId,
});

const makeEdge = (id: string, source: string, target: string): Edge => ({
  id,
  source,
  target,
});

describe('collectCopyData', () => {
  it('選択ノードのみを返す', () => {
    const nodes = [makeNode('n1', true), makeNode('n2', false)];
    const { nodes: result } = collectCopyData(nodes, []);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('n1');
  });

  it('選択ノード間のエッジのみを返す', () => {
    const nodes = [
      makeNode('n1', true),
      makeNode('n2', true),
      makeNode('n3', false),
    ];
    const edges = [
      makeEdge('e1', 'n1', 'n2'), // 両端選択 → 含む
      makeEdge('e2', 'n1', 'n3'), // 片端未選択 → 除外
    ];
    const { edges: result } = collectCopyData(nodes, edges);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('e1');
  });

  it('選択ノードが0件の場合は空を返す', () => {
    const nodes = [makeNode('n1', false)];
    const { nodes: ns, edges: es } = collectCopyData(nodes, []);
    expect(ns).toHaveLength(0);
    expect(es).toHaveLength(0);
  });

  it('選択されたグループノードの子ノードも含まれる', () => {
    const group: Node = {
      id: 'g1',
      position: { x: 0, y: 0 },
      data: { label: 'group' },
      type: 'groupNode',
      selected: true,
    };
    const child = makeNode('n1', false, 'g1');
    const unrelated = makeNode('n2', false);
    const { nodes: result } = collectCopyData([group, child, unrelated], []);
    const ids = result.map((n) => n.id);
    expect(ids).toContain('g1');
    expect(ids).toContain('n1');
    expect(ids).not.toContain('n2');
  });

  it('ネストされたグループの孫ノードも再帰的に含まれる', () => {
    const outer: Node = {
      id: 'g1',
      position: { x: 0, y: 0 },
      data: { label: 'outer' },
      type: 'groupNode',
      selected: true,
    };
    const inner: Node = {
      id: 'g2',
      position: { x: 0, y: 0 },
      data: { label: 'inner' },
      type: 'groupNode',
      selected: false,
      parentId: 'g1',
    };
    const grandchild = makeNode('n1', false, 'g2');
    const { nodes: result } = collectCopyData([outer, inner, grandchild], []);
    expect(result.map((n) => n.id).sort()).toEqual(['g1', 'g2', 'n1']);
  });
});

// ---- buildPastedData ----

describe('buildPastedData', () => {
  it('ペースト後のノードは新しい UUID を持つ', () => {
    const clipboard = { nodes: [makeNode('n1', true)], edges: [] };
    const { nodes } = buildPastedData(clipboard, 20);
    expect(nodes[0].id).not.toBe('n1');
    expect(nodes[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('ペースト後のノード位置は offset だけずれる', () => {
    const clipboard = { nodes: [makeNode('n1', true)], edges: [] };
    const { nodes } = buildPastedData(clipboard, 30);
    expect(nodes[0].position).toEqual({ x: 40, y: 50 }); // 10+30, 20+30
  });

  it('ペースト後のノードは selected=true になる', () => {
    const clipboard = { nodes: [makeNode('n1', false)], edges: [] };
    const { nodes } = buildPastedData(clipboard, 0);
    expect(nodes[0].selected).toBe(true);
  });

  it('エッジの source/target も新しい UUID に更新される', () => {
    const clipboard = {
      nodes: [makeNode('n1', true), makeNode('n2', true)],
      edges: [makeEdge('e1', 'n1', 'n2')],
    };
    const { nodes, edges } = buildPastedData(clipboard, 0);
    expect(edges[0].source).toBe(nodes[0].id);
    expect(edges[0].target).toBe(nodes[1].id);
    expect(edges[0].id).not.toBe('e1');
  });

  it('parentId がコピーセット内なら新 ID に付け替える', () => {
    const parent = makeNode('g1', true);
    const child = makeNode('n1', true, 'g1');
    const clipboard = { nodes: [parent, child], edges: [] };
    const { nodes } = buildPastedData(clipboard, 0);
    const newParent = nodes.find((n) => n.data.label === 'g1');
    const newChild = nodes.find((n) => n.data.label === 'n1');
    expect(newChild?.parentId).toBe(newParent?.id);
  });

  it('parentId がコピーセット外なら parentId を解除する (root 配置)', () => {
    const child = makeNode('n1', true, 'external-group');
    const clipboard = { nodes: [child], edges: [] };
    const { nodes } = buildPastedData(clipboard, 0);
    expect(nodes[0].parentId).toBeUndefined();
  });

  it('コピーセット内の親子ノードで子にはオフセットを適用しない', () => {
    const parent = makeNode('g1', true); // position { x:10, y:20 }
    const child = makeNode('n1', true, 'g1'); // position { x:10, y:20 } (relative)
    const clipboard = { nodes: [parent, child], edges: [] };
    const { nodes } = buildPastedData(clipboard, 30);
    const newParent = nodes.find((n) => n.data.label === 'g1');
    const newChild = nodes.find((n) => n.data.label === 'n1');
    // 親のみオフセット: 10+30=40, 20+30=50
    expect(newParent?.position).toEqual({ x: 40, y: 50 });
    // 子は相対座標のままオフセットなし
    expect(newChild?.position).toEqual({ x: 10, y: 20 });
  });

  it('ペースト後のノード配列で親は子より前に並ぶ', () => {
    const parent = makeNode('g1', true);
    const child = makeNode('n1', true, 'g1');
    // 意図的に子→親の順でクリップボードに入れる
    const clipboard = { nodes: [child, parent], edges: [] };
    const { nodes } = buildPastedData(clipboard, 0);
    const parentIdx = nodes.findIndex((n) => n.data.label === 'g1');
    const childIdx = nodes.findIndex((n) => n.data.label === 'n1');
    expect(parentIdx).toBeLessThan(childIdx);
  });
});
