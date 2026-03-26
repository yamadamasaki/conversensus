import { describe, expect, it } from 'bun:test';
import type {
  EdgeId,
  GraphEdge,
  GraphNode,
  NodeId,
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

  it('pathType が指定されている場合は data.pathType に変換される', () => {
    const edges: GraphEdge[] = [
      {
        id: 'e1' as EdgeId,
        source: 'n1' as NodeId,
        target: 'n2' as NodeId,
        pathType: 'straight',
      },
    ];
    expect(toFlowEdges(edges)[0].data?.pathType).toBe('straight');
  });

  it('pathType が未指定の場合は data.pathType が "bezier" になる', () => {
    const edges: GraphEdge[] = [
      { id: 'e1' as EdgeId, source: 'n1' as NodeId, target: 'n2' as NodeId },
    ];
    expect(toFlowEdges(edges)[0].data?.pathType).toBe('bezier');
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

  it('data.pathType が GraphEdge.pathType に復元される', () => {
    const flowEdges: Edge[] = [
      { id: 'e1', source: 'n1', target: 'n2', data: { pathType: 'step' } },
    ];
    expect(fromFlowEdges(flowEdges)[0].pathType).toBe('step');
  });

  it('data.pathType がない場合は pathType が undefined になる', () => {
    const flowEdges: Edge[] = [{ id: 'e1', source: 'n1', target: 'n2' }];
    expect(fromFlowEdges(flowEdges)[0].pathType).toBeUndefined();
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

  it('pathType が変換して戻すと復元される', () => {
    const edges: GraphEdge[] = [
      {
        id: 'e1' as EdgeId,
        source: 'n1' as NodeId,
        target: 'n2' as NodeId,
        pathType: 'smoothstep',
      },
    ];
    expect(fromFlowEdges(toFlowEdges(edges))[0].pathType).toBe('smoothstep');
  });
});

describe('toFlowEdges: sourceHandle / targetHandle', () => {
  it('sourceHandle と targetHandle が React Flow の Edge に渡される', () => {
    const edges: GraphEdge[] = [
      {
        id: 'e1' as EdgeId,
        source: 'n1' as NodeId,
        target: 'n2' as NodeId,
        sourceHandle: 'source-bottom',
        targetHandle: 'source-top',
      },
    ];
    const result = toFlowEdges(edges);
    expect(result[0].sourceHandle).toBe('source-bottom');
    expect(result[0].targetHandle).toBe('source-top');
  });

  it('sourceHandle / targetHandle が undefined の場合は undefined になる', () => {
    const result = toFlowEdges(graphEdges);
    expect(result[0].sourceHandle).toBeUndefined();
    expect(result[0].targetHandle).toBeUndefined();
  });
});

describe('fromFlowEdges: sourceHandle / targetHandle', () => {
  it('sourceHandle と targetHandle が GraphEdge に保持される', () => {
    const flowEdges: Edge[] = [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        sourceHandle: 'source-bottom',
        targetHandle: 'source-top',
      },
    ];
    const result = fromFlowEdges(flowEdges);
    expect(result[0].sourceHandle).toBe('source-bottom');
    expect(result[0].targetHandle).toBe('source-top');
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
    const result = fromFlowEdges(flowEdges);
    expect(result[0].sourceHandle).toBeUndefined();
    expect(result[0].targetHandle).toBeUndefined();
  });

  it('sourceHandle がない Edge は undefined になる', () => {
    const flowEdges: Edge[] = [{ id: 'e1', source: 'n1', target: 'n2' }];
    const result = fromFlowEdges(flowEdges);
    expect(result[0].sourceHandle).toBeUndefined();
    expect(result[0].targetHandle).toBeUndefined();
  });
});

describe('toFlowEdges → fromFlowEdges: sourceHandle / targetHandle の対称性', () => {
  it('handle 情報が変換して戻すと復元される', () => {
    const edges: GraphEdge[] = [
      {
        id: 'e1' as EdgeId,
        source: 'n1' as NodeId,
        target: 'n2' as NodeId,
        sourceHandle: 'source-right',
        targetHandle: 'source-left',
      },
    ];
    const result = fromFlowEdges(toFlowEdges(edges));
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
