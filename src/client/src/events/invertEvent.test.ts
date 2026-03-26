import { describe, expect, it } from 'bun:test';
import type {
  EdgeId,
  GraphEdge,
  GraphNode,
  NodeId,
} from '@conversensus/shared';
import type { GraphEvent } from './GraphEvent';
import { invertEvent } from './invertEvent';

const base = { id: 'evt', timestamp: 0, userId: 'local' } as const;

const graphNode: GraphNode = {
  id: 'n1' as NodeId,
  content: 'ノード1',
  style: { x: 10, y: 20 },
};
const graphEdge: GraphEdge = {
  id: 'e1' as EdgeId,
  source: 'n1' as NodeId,
  target: 'n2' as NodeId,
};

// --- structure ---

describe('NODE_ADDED ↔ NODE_DELETED', () => {
  it('NODE_ADDED の逆は NODE_DELETED', () => {
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'NODE_ADDED',
      nodeId: 'n1' as NodeId,
      data: graphNode,
    };
    const inv = invertEvent(event);
    expect(inv.type).toBe('NODE_DELETED');
    expect((inv as Extract<GraphEvent, { type: 'NODE_DELETED' }>).nodeId).toBe(
      'n1',
    );
    expect((inv as Extract<GraphEvent, { type: 'NODE_DELETED' }>).data).toEqual(
      graphNode,
    );
  });

  it('NODE_DELETED の逆は NODE_ADDED', () => {
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'NODE_DELETED',
      nodeId: 'n1' as NodeId,
      data: graphNode,
    };
    const inv = invertEvent(event);
    expect(inv.type).toBe('NODE_ADDED');
  });

  it('二重反転で元の type に戻る', () => {
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'NODE_ADDED',
      nodeId: 'n1' as NodeId,
      data: graphNode,
    };
    expect(invertEvent(invertEvent(event)).type).toBe('NODE_ADDED');
  });
});

describe('EDGE_ADDED ↔ EDGE_DELETED', () => {
  it('EDGE_ADDED の逆は EDGE_DELETED', () => {
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'EDGE_ADDED',
      edgeId: 'e1' as EdgeId,
      data: graphEdge,
    };
    const inv = invertEvent(event);
    expect(inv.type).toBe('EDGE_DELETED');
    expect((inv as Extract<GraphEvent, { type: 'EDGE_DELETED' }>).edgeId).toBe(
      'e1',
    );
  });

  it('EDGE_DELETED の逆は EDGE_ADDED', () => {
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'EDGE_DELETED',
      edgeId: 'e1' as EdgeId,
      data: graphEdge,
    };
    expect(invertEvent(event).type).toBe('EDGE_ADDED');
  });
});

describe('EDGE_RECONNECTED', () => {
  it('from/to を入れ替える', () => {
    const from = { source: 'n1' as NodeId, target: 'n2' as NodeId };
    const to = {
      source: 'n2' as NodeId,
      target: 'n3' as NodeId,
      sourceHandle: 'top',
    };
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'EDGE_RECONNECTED',
      edgeId: 'e1' as EdgeId,
      from,
      to,
    };
    const inv = invertEvent(event) as Extract<
      GraphEvent,
      { type: 'EDGE_RECONNECTED' }
    >;
    expect(inv.type).toBe('EDGE_RECONNECTED');
    expect(inv.from).toEqual(to);
    expect(inv.to).toEqual(from);
  });
});

describe('NODES_GROUPED ↔ NODES_UNGROUPED', () => {
  const children = [
    {
      nodeId: 'n1' as NodeId,
      originalParentId: undefined,
      originalPosition: { x: 10, y: 20 },
      newPosition: { x: 30, y: 40 },
    },
  ];
  const parentData: GraphNode = {
    id: 'parent' as NodeId,
    content: 'グループ',
    style: { x: 0, y: 0, nodeType: 'group' },
  };

  it('NODES_GROUPED の逆は NODES_UNGROUPED (同じ children を保持)', () => {
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'NODES_GROUPED',
      parentId: 'parent' as NodeId,
      parentData,
      children,
    };
    const inv = invertEvent(event) as Extract<
      GraphEvent,
      { type: 'NODES_UNGROUPED' }
    >;
    expect(inv.type).toBe('NODES_UNGROUPED');
    expect(inv.parentId).toBe('parent');
    expect(inv.children).toEqual(children);
  });

  it('NODES_UNGROUPED の逆は NODES_GROUPED', () => {
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'NODES_UNGROUPED',
      parentId: 'parent' as NodeId,
      parentData,
      children,
    };
    expect(invertEvent(event).type).toBe('NODES_GROUPED');
  });
});

describe('NODES_PASTED ↔ NODES_PASTED_UNDO', () => {
  it('NODES_PASTED の逆は NODES_PASTED_UNDO (nodeIds/edgeIds を収集)', () => {
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'NODES_PASTED',
      nodes: [graphNode],
      edges: [graphEdge],
    };
    const inv = invertEvent(event) as Extract<
      GraphEvent,
      { type: 'NODES_PASTED_UNDO' }
    >;
    expect(inv.type).toBe('NODES_PASTED_UNDO');
    expect(inv.nodeIds).toEqual(['n1']);
    expect(inv.edgeIds).toEqual(['e1']);
    // redo のために元データを保持
    expect(inv.nodes).toEqual([graphNode]);
    expect(inv.edges).toEqual([graphEdge]);
  });

  it('NODES_PASTED_UNDO の逆は NODES_PASTED', () => {
    const event: GraphEvent = {
      ...base,
      category: 'structure',
      type: 'NODES_PASTED_UNDO',
      nodeIds: ['n1' as NodeId],
      edgeIds: ['e1' as EdgeId],
      nodes: [graphNode],
      edges: [graphEdge],
    };
    const inv = invertEvent(event) as Extract<
      GraphEvent,
      { type: 'NODES_PASTED' }
    >;
    expect(inv.type).toBe('NODES_PASTED');
    expect(inv.nodes).toEqual([graphNode]);
    expect(inv.edges).toEqual([graphEdge]);
  });
});

// --- content ---

describe('NODE_RELABELED', () => {
  it('from/to を入れ替える', () => {
    const event: GraphEvent = {
      ...base,
      category: 'content',
      type: 'NODE_RELABELED',
      nodeId: 'n1' as NodeId,
      from: '旧ラベル',
      to: '新ラベル',
    };
    const inv = invertEvent(event) as Extract<
      GraphEvent,
      { type: 'NODE_RELABELED' }
    >;
    expect(inv.type).toBe('NODE_RELABELED');
    expect(inv.from).toBe('新ラベル');
    expect(inv.to).toBe('旧ラベル');
  });
});

describe('EDGE_RELABELED', () => {
  it('from/to を入れ替える', () => {
    const event: GraphEvent = {
      ...base,
      category: 'content',
      type: 'EDGE_RELABELED',
      edgeId: 'e1' as EdgeId,
      from: '旧',
      to: '新',
    };
    const inv = invertEvent(event) as Extract<
      GraphEvent,
      { type: 'EDGE_RELABELED' }
    >;
    expect(inv.from).toBe('新');
    expect(inv.to).toBe('旧');
  });
});

// --- layout ---

describe('NODE_MOVED', () => {
  it('from/to を入れ替える', () => {
    const event: GraphEvent = {
      ...base,
      category: 'layout',
      type: 'NODE_MOVED',
      nodeId: 'n1' as NodeId,
      from: { x: 10, y: 20 },
      to: { x: 50, y: 60 },
    };
    const inv = invertEvent(event) as Extract<
      GraphEvent,
      { type: 'NODE_MOVED' }
    >;
    expect(inv.from).toEqual({ x: 50, y: 60 });
    expect(inv.to).toEqual({ x: 10, y: 20 });
  });
});

describe('NODE_RESIZED', () => {
  it('from/to を入れ替える', () => {
    const event: GraphEvent = {
      ...base,
      category: 'layout',
      type: 'NODE_RESIZED',
      nodeId: 'n1' as NodeId,
      from: { width: 160, height: 80 },
      to: { width: 240, height: 120 },
    };
    const inv = invertEvent(event) as Extract<
      GraphEvent,
      { type: 'NODE_RESIZED' }
    >;
    expect(inv.from).toEqual({ width: 240, height: 120 });
    expect(inv.to).toEqual({ width: 160, height: 80 });
  });
});

// --- presentation ---

describe('EDGE_STYLE_CHANGED', () => {
  it('from/to を入れ替える', () => {
    const event: GraphEvent = {
      ...base,
      category: 'presentation',
      type: 'EDGE_STYLE_CHANGED',
      edgeId: 'e1' as EdgeId,
      from: { pathType: 'bezier' },
      to: { pathType: 'step' },
    };
    const inv = invertEvent(event) as Extract<
      GraphEvent,
      { type: 'EDGE_STYLE_CHANGED' }
    >;
    expect(inv.from).toEqual({ pathType: 'step' });
    expect(inv.to).toEqual({ pathType: 'bezier' });
  });
});

describe('NODE_STYLE_CHANGED', () => {
  it('from/to を入れ替える', () => {
    const event: GraphEvent = {
      ...base,
      category: 'presentation',
      type: 'NODE_STYLE_CHANGED',
      nodeId: 'n1' as NodeId,
      from: { background: 'white' },
      to: { background: '#eee' },
    };
    const inv = invertEvent(event) as Extract<
      GraphEvent,
      { type: 'NODE_STYLE_CHANGED' }
    >;
    expect(inv.from).toEqual({ background: '#eee' });
    expect(inv.to).toEqual({ background: 'white' });
  });
});

describe('EDGE_LABEL_MOVED', () => {
  it('from/to を入れ替える', () => {
    const event: GraphEvent = {
      ...base,
      category: 'presentation',
      type: 'EDGE_LABEL_MOVED',
      edgeId: 'e1' as EdgeId,
      from: { offsetX: 0, offsetY: 0 },
      to: { offsetX: 30, offsetY: 40 },
    };
    const inv = invertEvent(event) as Extract<
      GraphEvent,
      { type: 'EDGE_LABEL_MOVED' }
    >;
    expect(inv.from).toEqual({ offsetX: 30, offsetY: 40 });
    expect(inv.to).toEqual({ offsetX: 0, offsetY: 0 });
  });
});

// --- 全イベント型の二重反転対称性 ---

describe('二重反転対称性: invertEvent(invertEvent(e)).type === e.type', () => {
  const cases: Array<{ label: string; event: GraphEvent }> = [
    {
      label: 'NODE_ADDED',
      event: {
        ...base,
        category: 'structure',
        type: 'NODE_ADDED',
        nodeId: 'n1' as NodeId,
        data: graphNode,
      },
    },
    {
      label: 'EDGE_ADDED',
      event: {
        ...base,
        category: 'structure',
        type: 'EDGE_ADDED',
        edgeId: 'e1' as EdgeId,
        data: graphEdge,
      },
    },
    {
      label: 'EDGE_RECONNECTED',
      event: {
        ...base,
        category: 'structure',
        type: 'EDGE_RECONNECTED',
        edgeId: 'e1' as EdgeId,
        from: { source: 'n1' as NodeId, target: 'n2' as NodeId },
        to: { source: 'n2' as NodeId, target: 'n1' as NodeId },
      },
    },
    {
      label: 'NODE_MOVED',
      event: {
        ...base,
        category: 'layout',
        type: 'NODE_MOVED',
        nodeId: 'n1' as NodeId,
        from: { x: 0, y: 0 },
        to: { x: 10, y: 10 },
      },
    },
    {
      label: 'NODE_RELABELED',
      event: {
        ...base,
        category: 'content',
        type: 'NODE_RELABELED',
        nodeId: 'n1' as NodeId,
        from: 'a',
        to: 'b',
      },
    },
    {
      label: 'EDGE_STYLE_CHANGED',
      event: {
        ...base,
        category: 'presentation',
        type: 'EDGE_STYLE_CHANGED',
        edgeId: 'e1' as EdgeId,
        from: { pathType: 'bezier' as const },
        to: { pathType: 'step' as const },
      },
    },
    {
      label: 'EDGE_LABEL_MOVED',
      event: {
        ...base,
        category: 'presentation',
        type: 'EDGE_LABEL_MOVED',
        edgeId: 'e1' as EdgeId,
        from: { offsetX: 0, offsetY: 0 },
        to: { offsetX: 10, offsetY: 10 },
      },
    },
  ];

  for (const { label, event } of cases) {
    it(label, () => {
      expect(invertEvent(invertEvent(event)).type).toBe(event.type);
    });
  }
});
