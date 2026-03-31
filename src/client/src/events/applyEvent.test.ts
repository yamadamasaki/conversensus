import { describe, expect, it } from 'bun:test';
import type {
  EdgeId,
  GraphEdge,
  GraphNode,
  NodeId,
  NodeLayout,
} from '@conversensus/shared';
import { type Edge, MarkerType, type Node } from '@xyflow/react';
import { applyEvent } from './applyEvent';
import type { GraphEvent } from './GraphEvent';
import { invertEvent } from './invertEvent';

// テスト用イベントベース (id/timestamp は固定値)
const base = { id: 'evt', timestamp: 0, userId: 'local' } as const;

// --- フィクスチャ ---

const n1: Node = {
  id: 'n1',
  position: { x: 10, y: 20 },
  data: { label: 'ノード1' },
  type: 'editableNode',
};
const n2: Node = {
  id: 'n2',
  position: { x: 100, y: 200 },
  data: { label: 'ノード2' },
  type: 'editableNode',
};
const e1: Edge = {
  id: 'e1',
  source: 'n1',
  target: 'n2',
  type: 'editableLabel',
  data: { pathType: 'bezier', labelOffsetX: 5, labelOffsetY: 10 },
};

const graphNode: GraphNode = {
  id: 'n3' as NodeId,
  content: 'ノード3',
};
const graphNodeLayout: NodeLayout = {
  nodeId: 'n3' as NodeId,
  x: 50,
  y: 60,
};
const graphEdge: GraphEdge = {
  id: 'e2' as EdgeId,
  source: 'n1' as NodeId,
  target: 'n2' as NodeId,
  label: 'ラベル',
  pathType: 'straight',
};

// --- structure イベント ---

describe('NODE_ADDED', () => {
  it('ノードを末尾に追加する', () => {
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'NODE_ADDED',
      nodeId: graphNode.id,
      data: graphNode,
      layout: graphNodeLayout,
    };
    const { nodes, edges } = applyEvent(event, [n1, n2], [e1]);
    expect(nodes).toHaveLength(3);
    expect(nodes[2]).toMatchObject({
      id: 'n3',
      position: { x: 50, y: 60 },
      data: { label: 'ノード3' },
    });
    expect(edges).toHaveLength(1);
  });
});

describe('NODE_DELETED', () => {
  it('ノードと接続するエッジを削除する', () => {
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'NODE_DELETED',
      nodeId: 'n1' as NodeId,
      data: graphNode,
    };
    const { nodes, edges } = applyEvent(event, [n1, n2], [e1]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('n2');
    // n1 に接続する e1 も削除される
    expect(edges).toHaveLength(0);
  });

  it('接続のないノードを削除してもエッジは残る', () => {
    const e2: Edge = {
      id: 'e2',
      source: 'n2',
      target: 'n2',
      type: 'editableLabel',
      data: {},
    };
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'NODE_DELETED',
      nodeId: 'n1' as NodeId,
      data: graphNode,
    };
    const { edges } = applyEvent(event, [n1, n2], [e2]);
    expect(edges).toHaveLength(1);
  });
});

describe('EDGE_ADDED', () => {
  it('エッジを末尾に追加する', () => {
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'EDGE_ADDED',
      edgeId: graphEdge.id,
      data: graphEdge,
    };
    const { nodes, edges } = applyEvent(event, [n1, n2], [e1]);
    expect(edges).toHaveLength(2);
    expect(edges[1]).toMatchObject({
      id: 'e2',
      source: 'n1',
      target: 'n2',
      label: 'ラベル',
      markerEnd: { type: MarkerType.ArrowClosed },
    });
    expect(nodes).toHaveLength(2);
  });
});

describe('EDGE_DELETED', () => {
  it('指定エッジを削除する', () => {
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'EDGE_DELETED',
      edgeId: 'e1' as EdgeId,
      data: graphEdge,
    };
    const { nodes, edges } = applyEvent(event, [n1, n2], [e1]);
    expect(edges).toHaveLength(0);
    expect(nodes).toHaveLength(2);
  });
});

describe('EDGE_RECONNECTED', () => {
  it('接続先を更新し labelOffset をリセットする', () => {
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'EDGE_RECONNECTED',
      edgeId: 'e1' as EdgeId,
      from: { source: 'n1' as NodeId, target: 'n2' as NodeId },
      to: {
        source: 'n2' as NodeId,
        target: 'n1' as NodeId,
        sourceHandle: 'source-top',
      },
    };
    const { edges } = applyEvent(event, [n1, n2], [e1]);
    expect(edges[0]).toMatchObject({
      source: 'n2',
      target: 'n1',
      sourceHandle: 'source-top',
      data: { labelOffsetX: 0, labelOffsetY: 0 },
    });
  });
});

describe('NODES_GROUPED', () => {
  it('親ノードを挿入し子ノードの parentId と位置を更新する', () => {
    const parentData: GraphNode = {
      id: 'parent' as NodeId,
      content: 'グループ',
    };
    const parentLayout: NodeLayout = {
      nodeId: 'parent' as NodeId,
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      nodeType: 'group',
    };
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'NODES_GROUPED',
      parentId: 'parent' as NodeId,
      parentData,
      parentLayout,
      children: [
        {
          nodeId: 'n1' as NodeId,
          originalParentId: undefined,
          originalPosition: { x: 10, y: 20 },
          newPosition: { x: 30, y: 40 },
        },
      ],
    };
    const { nodes } = applyEvent(event, [n1, n2], []);
    // 親が n1 の前に挿入される
    expect(nodes[0].id).toBe('parent');
    const child = nodes.find((n) => n.id === 'n1');
    expect(child?.parentId).toBe('parent');
    expect(child?.position).toEqual({ x: 30, y: 40 });
    expect(child?.selected).toBe(false);
  });
});

describe('NODES_UNGROUPED', () => {
  it('親ノードを削除し子ノードの位置と parentId を元に戻す', () => {
    const parentNode: Node = {
      id: 'parent',
      position: { x: 0, y: 0 },
      data: { label: 'グループ' },
      type: 'groupNode',
    };
    const childNode: Node = {
      ...n1,
      parentId: 'parent',
      position: { x: 30, y: 40 },
    };
    const parentData: GraphNode = {
      id: 'parent' as NodeId,
      content: 'グループ',
    };
    const parentLayout: NodeLayout = {
      nodeId: 'parent' as NodeId,
      x: 0,
      y: 0,
      nodeType: 'group',
    };
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'NODES_UNGROUPED',
      parentId: 'parent' as NodeId,
      parentData,
      parentLayout,
      children: [
        {
          nodeId: 'n1' as NodeId,
          originalParentId: undefined,
          originalPosition: { x: 10, y: 20 },
          newPosition: { x: 30, y: 40 },
        },
      ],
    };
    const { nodes } = applyEvent(event, [parentNode, childNode, n2], []);
    expect(nodes.find((n) => n.id === 'parent')).toBeUndefined();
    const restored = nodes.find((n) => n.id === 'n1');
    expect(restored?.parentId).toBeUndefined();
    expect(restored?.position).toEqual({ x: 10, y: 20 });
  });
});

describe('NODES_PASTED', () => {
  it('既存ノードを非選択にして新規ノード/エッジを追加する', () => {
    const selectedN1: Node = { ...n1, selected: true };
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'NODES_PASTED',
      nodes: [graphNode],
      layouts: [graphNodeLayout],
      edges: [graphEdge],
    };
    const { nodes, edges } = applyEvent(event, [selectedN1, n2], [e1]);
    expect(nodes).toHaveLength(3);
    expect(nodes[0].selected).toBe(false);
    expect(nodes[1].selected).toBe(false);
    expect(nodes[2].id).toBe('n3');
    expect(edges).toHaveLength(2);
  });
});

describe('NODES_PASTED_UNDO', () => {
  it('指定 ID のノード/エッジを削除する', () => {
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'NODES_PASTED_UNDO',
      nodeIds: ['n2' as NodeId],
      edgeIds: ['e1' as EdgeId],
      nodes: [],
      layouts: [],
      edges: [],
    };
    const { nodes, edges } = applyEvent(event, [n1, n2], [e1]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('n1');
    expect(edges).toHaveLength(0);
  });
});

// --- content イベント ---

describe('NODE_RELABELED', () => {
  it('ノードの data.label を更新する', () => {
    const event: GraphEvent = {
      ...base,
      category: 'content',
      type: 'NODE_RELABELED',
      nodeId: 'n1' as NodeId,
      from: 'ノード1',
      to: '新しいラベル',
    };
    const { nodes } = applyEvent(event, [n1, n2], []);
    expect(nodes[0].data.label).toBe('新しいラベル');
    expect(nodes[1].data.label).toBe('ノード2');
  });
});

describe('EDGE_RELABELED', () => {
  it('エッジの label を更新する', () => {
    const event: GraphEvent = {
      ...base,
      category: 'content',
      type: 'EDGE_RELABELED',
      edgeId: 'e1' as EdgeId,
      from: '',
      to: 'エッジラベル',
    };
    const { edges } = applyEvent(event, [], [e1]);
    expect(edges[0].label).toBe('エッジラベル');
  });
});

describe('NODE_PROPERTIES_CHANGED', () => {
  it('ノード状態を変更しない (将来実装)', () => {
    const event: GraphEvent = {
      ...base,
      category: 'content',
      type: 'NODE_PROPERTIES_CHANGED',
      nodeId: 'n1' as NodeId,
      from: {},
      to: { key: 'value' },
    };
    const { nodes } = applyEvent(event, [n1], []);
    expect(nodes).toEqual([n1]);
  });
});

// --- layout イベント ---

describe('NODE_MOVED', () => {
  it('ノードの position を更新する', () => {
    const event: GraphEvent = {
      ...base,
      category: 'layout',
      type: 'NODE_MOVED',
      nodeId: 'n1' as NodeId,
      from: { x: 10, y: 20 },
      to: { x: 50, y: 60 },
    };
    const { nodes } = applyEvent(event, [n1, n2], []);
    expect(nodes[0].position).toEqual({ x: 50, y: 60 });
    expect(nodes[1].position).toEqual({ x: 100, y: 200 });
  });
});

describe('NODE_RESIZED', () => {
  it('ノードの style の width/height を更新する', () => {
    const event: GraphEvent = {
      ...base,
      category: 'layout',
      type: 'NODE_RESIZED',
      nodeId: 'n1' as NodeId,
      from: { width: 160, height: 80 },
      to: { width: 240, height: 120 },
    };
    const { nodes } = applyEvent(event, [n1, n2], []);
    expect(nodes[0].style).toMatchObject({ width: 240, height: 120 });
    expect(nodes[1].style).toBeUndefined();
  });
});

// --- presentation イベント ---

describe('EDGE_STYLE_CHANGED', () => {
  it('エッジの data に style プロパティをマージする', () => {
    const event: GraphEvent = {
      ...base,
      category: 'presentation',
      type: 'EDGE_STYLE_CHANGED',
      edgeId: 'e1' as EdgeId,
      from: { pathType: 'bezier' },
      to: { pathType: 'straight' },
    };
    const { edges } = applyEvent(event, [], [e1]);
    expect(edges[0].data?.pathType).toBe('straight');
    // 既存の data フィールドは保持される
    expect(edges[0].data?.labelOffsetX).toBe(5);
  });
});

describe('NODE_STYLE_CHANGED', () => {
  it('ノードの style にプロパティをマージする', () => {
    const styledNode: Node = { ...n1, style: { width: 160, height: 80 } };
    const event: GraphEvent = {
      ...base,
      category: 'presentation',
      type: 'NODE_STYLE_CHANGED',
      nodeId: 'n1' as NodeId,
      from: { nodeId: 'n1' as NodeId },
      to: { nodeId: 'n1' as NodeId, width: 200 },
    };
    const { nodes } = applyEvent(event, [styledNode], []);
    expect(nodes[0].style).toMatchObject({
      width: 200,
      height: 80,
    });
  });
});

describe('EDGE_LABEL_MOVED', () => {
  it('エッジの labelOffsetX/Y を更新する', () => {
    const event: GraphEvent = {
      ...base,
      category: 'presentation',
      type: 'EDGE_LABEL_MOVED',
      edgeId: 'e1' as EdgeId,
      from: { offsetX: 5, offsetY: 10 },
      to: { offsetX: 30, offsetY: 40 },
    };
    const { edges } = applyEvent(event, [], [e1]);
    expect(edges[0].data?.labelOffsetX).toBe(30);
    expect(edges[0].data?.labelOffsetY).toBe(40);
  });
});

// --- ラウンドトリップ ---

describe('round-trip: apply → invert → apply = 元の状態', () => {
  it('NODE_MOVED', () => {
    const event: GraphEvent = {
      ...base,
      category: 'layout',
      type: 'NODE_MOVED',
      nodeId: 'n1' as NodeId,
      from: { x: 10, y: 20 },
      to: { x: 50, y: 60 },
    };
    const { nodes: after } = applyEvent(event, [n1, n2], []);
    const { nodes: restored } = applyEvent(invertEvent(event), after, []);
    expect(restored[0].position).toEqual(n1.position);
  });

  it('NODE_RELABELED', () => {
    const event: GraphEvent = {
      ...base,
      category: 'content',
      type: 'NODE_RELABELED',
      nodeId: 'n1' as NodeId,
      from: 'ノード1',
      to: '変更後',
    };
    const { nodes: after } = applyEvent(event, [n1], []);
    const { nodes: restored } = applyEvent(invertEvent(event), after, []);
    expect(restored[0].data.label).toBe('ノード1');
  });

  it('NODE_ADDED → NODE_DELETED (undo) = 元の状態', () => {
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'NODE_ADDED',
      nodeId: graphNode.id,
      data: graphNode,
      layout: graphNodeLayout,
    };
    const { nodes: after } = applyEvent(event, [n1, n2], []);
    expect(after).toHaveLength(3);
    const { nodes: restored } = applyEvent(invertEvent(event), after, []);
    expect(restored).toHaveLength(2);
    expect(restored.map((n) => n.id)).toEqual(['n1', 'n2']);
  });

  it('EDGE_STYLE_CHANGED', () => {
    const event: GraphEvent = {
      ...base,
      category: 'presentation',
      type: 'EDGE_STYLE_CHANGED',
      edgeId: 'e1' as EdgeId,
      from: { pathType: 'bezier' },
      to: { pathType: 'step' },
    };
    const { edges: after } = applyEvent(event, [], [e1]);
    const { edges: restored } = applyEvent(invertEvent(event), [], after);
    expect(restored[0].data?.pathType).toBe('bezier');
  });
});
