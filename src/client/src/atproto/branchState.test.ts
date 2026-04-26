import { describe, expect, it } from 'bun:test';
import type {
  EdgeId,
  GraphEdge,
  GraphNode,
  NodeId,
  Sheet,
  SheetId,
} from '@conversensus/shared';
import { computeOperations } from './branchState';

const sid = '00000000-0000-0000-0000-000000000001' as SheetId;

function emptySheet(): Sheet {
  return { id: sid, name: 'test', nodes: [], edges: [] };
}

function n(id: string, content = 'content'): GraphNode {
  return { id: id as NodeId, content };
}

function nWithProps(
  id: string,
  content: string,
  props: Record<string, unknown>,
): GraphNode {
  return { id: id as NodeId, content, properties: props };
}

function e(
  id: string,
  source: string,
  target: string,
  label?: string,
): GraphEdge {
  return {
    id: id as EdgeId,
    source: source as NodeId,
    target: target as NodeId,
    ...(label && { label }),
  };
}

function eWithProps(
  id: string,
  source: string,
  target: string,
  props: Record<string, unknown>,
): GraphEdge {
  return {
    id: id as EdgeId,
    source: source as NodeId,
    target: target as NodeId,
    properties: props,
  };
}

// --- node.add ---

describe('computeOperations: node.add', () => {
  it('base になく current にあるノードは node.add', () => {
    const ops = computeOperations(emptySheet(), {
      id: sid,
      name: 'test',
      nodes: [n('n1')],
      edges: [],
    });
    expect(ops).toEqual([{ op: 'node.add', nodeId: 'n1', content: 'content' }]);
  });

  it('properties があるノードの追加', () => {
    const ops = computeOperations(emptySheet(), {
      id: sid,
      name: 'test',
      nodes: [nWithProps('n1', 'c', { key: 'v' })],
      edges: [],
    });
    expect(ops).toEqual([
      { op: 'node.add', nodeId: 'n1', content: 'c', properties: { key: 'v' } },
    ]);
  });
});

// --- node.update ---

describe('computeOperations: node.update', () => {
  it('content が変わると node.update', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1', 'old')],
      edges: [],
    };
    const ops = computeOperations(base, { ...base, nodes: [n('n1', 'new')] });
    expect(ops).toEqual([{ op: 'node.update', nodeId: 'n1', content: 'new' }]);
  });

  it('properties が変わると node.update', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [nWithProps('n1', 'c', { a: 1 })],
      edges: [],
    };
    const ops = computeOperations(base, {
      ...base,
      nodes: [nWithProps('n1', 'c', { a: 2 })],
    });
    expect(ops).toEqual([
      { op: 'node.update', nodeId: 'n1', content: 'c', properties: { a: 2 } },
    ]);
  });

  it('properties が追加された場合も node.update', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1', 'c')],
      edges: [],
    };
    const ops = computeOperations(base, {
      ...base,
      nodes: [nWithProps('n1', 'c', { new: true })],
    });
    expect(ops).toEqual([
      {
        op: 'node.update',
        nodeId: 'n1',
        content: 'c',
        properties: { new: true },
      },
    ]);
  });

  it('content も properties も同じなら ops は空', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [nWithProps('n1', 'c', { a: 1 })],
      edges: [],
    };
    const ops = computeOperations(base, {
      ...base,
      nodes: [nWithProps('n1', 'c', { a: 1 })],
    });
    expect(ops).toEqual([]);
  });
});

// --- node.remove ---

describe('computeOperations: node.remove', () => {
  it('current にないノードは node.remove', () => {
    const base: Sheet = { id: sid, name: 'test', nodes: [n('n1')], edges: [] };
    const ops = computeOperations(base, emptySheet());
    expect(ops).toEqual([{ op: 'node.remove', nodeId: 'n1' }]);
  });
});

// --- edge.add ---

describe('computeOperations: edge.add', () => {
  it('base になく current にあるエッジは edge.add', () => {
    const ops = computeOperations(emptySheet(), {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [e('e1', 'n1', 'n2', 'label')],
    });
    expect(ops).toEqual([
      {
        op: 'edge.add',
        edgeId: 'e1',
        sourceId: 'n1',
        targetId: 'n2',
        label: 'label',
      },
    ]);
  });

  it('label なしのエッジ追加', () => {
    const ops = computeOperations(emptySheet(), {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [e('e1', 'n1', 'n2')],
    });
    expect(ops).toEqual([
      { op: 'edge.add', edgeId: 'e1', sourceId: 'n1', targetId: 'n2' },
    ]);
  });
});

// --- edge.update ---

describe('computeOperations: edge.update', () => {
  it('label が変わると edge.update', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [e('e1', 'n1', 'n2', 'old')],
    };
    const ops = computeOperations(base, {
      ...base,
      edges: [e('e1', 'n1', 'n2', 'new')],
    });
    expect(ops).toEqual([{ op: 'edge.update', edgeId: 'e1', label: 'new' }]);
  });

  it('label が undefined に変わったとき edge.update の label が undefined', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [e('e1', 'n1', 'n2', 'old')],
    };
    const ops = computeOperations(base, {
      ...base,
      edges: [e('e1', 'n1', 'n2')],
    });
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe('edge.update');
  });

  it('properties が変わると edge.update', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [eWithProps('e1', 'n1', 'n2', { a: 1 })],
    };
    const ops = computeOperations(base, {
      ...base,
      edges: [eWithProps('e1', 'n1', 'n2', { a: 2 })],
    });
    expect(ops).toEqual([
      { op: 'edge.update', edgeId: 'e1', properties: { a: 2 } },
    ]);
  });
});

// --- edge.remove ---

describe('computeOperations: edge.remove', () => {
  it('current にないエッジは edge.remove', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [e('e1', 'n1', 'n2')],
    };
    const ops = computeOperations(base, emptySheet());
    expect(ops).toEqual([{ op: 'edge.remove', edgeId: 'e1' }]);
  });
});

// --- 同一シート ---

describe('computeOperations: 同一シート', () => {
  it('base と current が同一なら ops は空', () => {
    const sheet: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1'), n('n2')],
      edges: [e('e1', 'n1', 'n2', 'rel')],
    };
    expect(computeOperations(sheet, sheet)).toEqual([]);
  });
});

// --- layout のみの変更 ---

describe('computeOperations: layout 変更は無視', () => {
  it('layouts が変わっても ops は空', () => {
    const base: Sheet = { id: sid, name: 'test', nodes: [n('n1')], edges: [] };
    const current: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1')],
      edges: [],
      layouts: [{ nodeId: 'n1' as NodeId, x: 100, y: 200 }],
    };
    expect(computeOperations(base, current)).toEqual([]);
  });

  it('edgeLayouts が変わっても ops は空', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [e('e1', 'n1', 'n2')],
    };
    const current: Sheet = {
      id: sid,
      name: 'test',
      nodes: [],
      edges: [e('e1', 'n1', 'n2')],
      edgeLayouts: [{ edgeId: 'e1' as EdgeId, pathType: 'bezier' }],
    };
    expect(computeOperations(base, current)).toEqual([]);
  });
});

// --- 複合操作 ---

describe('computeOperations: 複合操作', () => {
  it('追加・更新・削除の混在', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1', 'old'), n('n2')], // n1 更新, n2 削除
      edges: [e('e1', 'n1', 'n2')], // e1 削除
    };
    const current: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1', 'new'), n('n3')], // n1 更新, n3 追加
      edges: [e('e2', 'n1', 'n3', 'new-edge')], // e2 追加
    };
    const ops = computeOperations(base, current);
    expect(ops).toHaveLength(5);
    expect(ops).toContainEqual({
      op: 'node.update',
      nodeId: 'n1',
      content: 'new',
    });
    expect(ops).toContainEqual({
      op: 'node.add',
      nodeId: 'n3',
      content: 'content',
    });
    expect(ops).toContainEqual({ op: 'node.remove', nodeId: 'n2' });
    expect(ops).toContainEqual({
      op: 'edge.add',
      edgeId: 'e2',
      sourceId: 'n1',
      targetId: 'n3',
      label: 'new-edge',
    });
    expect(ops).toContainEqual({ op: 'edge.remove', edgeId: 'e1' });
  });
});

// --- エッジケース ---

describe('computeOperations: エッジケース', () => {
  it('空シート同士 → ops は空', () => {
    expect(computeOperations(emptySheet(), emptySheet())).toEqual([]);
  });

  it('空シートからのノード追加', () => {
    const ops = computeOperations(emptySheet(), {
      id: sid,
      name: 'test',
      nodes: [n('n1'), n('n2')],
      edges: [],
    });
    expect(ops).toHaveLength(2);
    expect(ops).toContainEqual({
      op: 'node.add',
      nodeId: 'n1',
      content: 'content',
    });
    expect(ops).toContainEqual({
      op: 'node.add',
      nodeId: 'n2',
      content: 'content',
    });
  });

  it('全ノード・全エッジ削除', () => {
    const base: Sheet = {
      id: sid,
      name: 'test',
      nodes: [n('n1'), n('n2')],
      edges: [e('e1', 'n1', 'n2')],
    };
    const ops = computeOperations(base, emptySheet());
    expect(ops).toHaveLength(3);
    expect(ops).toContainEqual({ op: 'node.remove', nodeId: 'n1' });
    expect(ops).toContainEqual({ op: 'node.remove', nodeId: 'n2' });
    expect(ops).toContainEqual({ op: 'edge.remove', edgeId: 'e1' });
  });

  it('ノード追加・エッジ追加の順序', () => {
    const ops = computeOperations(emptySheet(), {
      id: sid,
      name: 'test',
      nodes: [n('n1'), n('n2')],
      edges: [e('e1', 'n1', 'n2')],
    });
    // node.add が先、edge.add が後
    const nodeAddIndex = ops.findIndex((o) => o.op === 'node.add');
    const edgeAddIndex = ops.findIndex((o) => o.op === 'edge.add');
    expect(nodeAddIndex).toBeLessThan(edgeAddIndex);
  });
});
