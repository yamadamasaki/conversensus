import { describe, expect, it } from 'bun:test';
import type {
  EdgeId,
  GraphEdge,
  GraphNode,
  NodeId,
  Sheet,
  SheetId,
} from '@conversensus/shared';
import {
  computeOperations,
  fetchBranchesForSheet,
  fetchCommitsForBranch,
} from './branchState';
import type { BranchStateDeps } from './collectionTypes';
import { createInMemoryDeps } from './testing/inMemoryCollections';

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

// --- Async function tests (with in-memory DI) ---

function setupDeps(): BranchStateDeps {
  return createInMemoryDeps();
}

const DID = 'did:plc:test';

describe('fetchBranchesForSheet (async)', () => {
  it('空の collection からは空配列を返す', async () => {
    const deps = setupDeps();
    const result = await fetchBranchesForSheet(
      '00000000-0000-0000-0000-000000000001' as SheetId,
      deps,
    );
    expect(result).toEqual([]);
  });

  it('該当シートの branch のみを返す', async () => {
    const deps = setupDeps();
    const targetSheetId = '00000000-0000-0000-0000-000000000001' as SheetId;
    const otherSheetId = '00000000-0000-0000-0000-000000000002' as SheetId;

    await deps.branches.put('b1', {
      sheet: {
        uri: `at://${DID}/app.conversensus.graph.sheet/${targetSheetId}`,
        cid: 'c1',
      },
      name: 'branch-1',
      authorDid: DID,
      status: 'open',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await deps.branches.put('b2', {
      sheet: {
        uri: `at://${DID}/app.conversensus.graph.sheet/${otherSheetId}`,
        cid: 'c2',
      },
      name: 'branch-2',
      authorDid: DID,
      status: 'open',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await fetchBranchesForSheet(targetSheetId, deps);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('branch-1');
  });

  it('branch の全フィールドが正しくマッピングされる', async () => {
    const deps = setupDeps();
    const sheetId = '00000000-0000-0000-0000-000000000001';
    const sheetRef = {
      uri: `at://${DID}/app.conversensus.graph.sheet/${sheetId}`,
      cid: 'c-sheet',
    };

    await deps.branches.put('branch-1', {
      sheet: sheetRef,
      name: 'feature-x',
      description: 'test description',
      authorDid: DID,
      status: 'open',
      baseCommit: {
        uri: `at://${DID}/app.conversensus.graph.commit/commit-1`,
        cid: 'c-commit',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await fetchBranchesForSheet(sheetId as SheetId, deps);
    expect(result).toHaveLength(1);
    const b = result[0];
    expect(b.id).toBe('branch-1');
    expect(b.name).toBe('feature-x');
    expect(b.description).toBe('test description');
    expect(b.authorDid).toBe(DID);
    expect(b.status).toBe('open');
    expect(b.baseCommitUri).toBe(
      `at://${DID}/app.conversensus.graph.commit/commit-1`,
    );
    expect(b.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('fetchCommitsForBranch (async)', () => {
  it('空の collection からは空配列を返す', async () => {
    const deps = setupDeps();
    const result = await fetchCommitsForBranch(
      `at://${DID}/app.conversensus.graph.branch/b1`,
      deps,
    );
    expect(result).toEqual([]);
  });

  it('該当 branch の commit を parentCommit チェーン順に返す', async () => {
    const deps = setupDeps();
    const branchUri = `at://${DID}/app.conversensus.graph.branch/b1`;
    const sheetUri = `at://${DID}/app.conversensus.graph.sheet/s1`;

    // c2 → c1 (c2 has parent c1, c1 has no parent)
    await deps.commits.put('c2', {
      sheet: { uri: sheetUri, cid: 'cs' },
      branch: { uri: branchUri, cid: 'cb' },
      message: 'second',
      authorDid: DID,
      parentCommit: {
        uri: `at://${DID}/app.conversensus.graph.commit/c1`,
        cid: 'cc1',
      },
      operations: [],
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    await deps.commits.put('c1', {
      sheet: { uri: sheetUri, cid: 'cs' },
      branch: { uri: branchUri, cid: 'cb' },
      message: 'first',
      authorDid: DID,
      operations: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await fetchCommitsForBranch(branchUri, deps);
    expect(result).toHaveLength(2);
    expect(result[0].message).toBe('first');
    expect(result[0].parentCommitUri).toBeUndefined();
    expect(result[1].message).toBe('second');
    expect(result[1].parentCommitUri).toBe(
      `at://${DID}/app.conversensus.graph.commit/c1`,
    );
  });

  it('別 branch の commit は返さない', async () => {
    const deps = setupDeps();
    const branch1Uri = `at://${DID}/app.conversensus.graph.branch/b1`;
    const branch2Uri = `at://${DID}/app.conversensus.graph.branch/b2`;
    const sheetUri = `at://${DID}/app.conversensus.graph.sheet/s1`;

    await deps.commits.put('c1', {
      sheet: { uri: sheetUri, cid: 'cs' },
      branch: { uri: branch1Uri, cid: 'cb1' },
      message: 'branch1-commit',
      authorDid: DID,
      operations: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await deps.commits.put('c2', {
      sheet: { uri: sheetUri, cid: 'cs' },
      branch: { uri: branch2Uri, cid: 'cb2' },
      message: 'branch2-commit',
      authorDid: DID,
      operations: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await fetchCommitsForBranch(branch1Uri, deps);
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe('branch1-commit');
  });
});
