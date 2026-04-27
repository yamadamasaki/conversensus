/**
 * In-memory collection implementations for testing.
 *
 * Each collection stores records keyed by rkey and supports the same interface
 * as the real PDS-backed collections in `../collections.ts`.
 */

import type { RecordResult, StrongRef } from '../types';

let _counter = 0;

function nextCid(): string {
  _counter += 1;
  return `bafy-test-cid-${_counter}`;
}

function makeUri(collection: string, rkey: string): string {
  return `at://did:plc:test/${collection}/${rkey}`;
}

// ---- generic in-memory record store ----

function createInMemoryStore<T>() {
  const records = new Map<string, { uri: string; cid: string; value: T }>();

  return {
    put(rkey: string, data: T): Promise<RecordResult> {
      const uri = makeUri('test.collection', rkey);
      const cid = nextCid();
      records.set(rkey, { uri, cid, value: data });
      return Promise.resolve({ uri, cid });
    },

    get(rkey: string) {
      const entry = records.get(rkey);
      if (!entry) throw new Error(`Record not found: ${rkey}`);
      return Promise.resolve(entry);
    },

    list() {
      return Promise.resolve(Array.from(records.values()));
    },

    delete(rkey: string): Promise<void> {
      records.delete(rkey);
      return Promise.resolve();
    },

    listForPrefix(prefix: string) {
      const results = Array.from(records.entries())
        .filter(([rkey]) => rkey.startsWith(`${prefix}_`))
        .map(([, v]) => v);
      return Promise.resolve(results);
    },

    ref(rkey: string): Promise<StrongRef> {
      const entry = records.get(rkey);
      if (!entry) throw new Error(`Record not found: ${rkey}`);
      return Promise.resolve({ uri: entry.uri, cid: entry.cid });
    },

    refFromResult(_rkey: string, result: RecordResult): StrongRef {
      return { uri: result.uri, cid: result.cid };
    },

    /** Expose raw map for test assertions */
    _records: records,
  };
}

// ---- typed collection factories ----

export function createInMemoryBranches() {
  return createInMemoryStore<Record<string, unknown>>();
}

export function createInMemoryCommits() {
  return createInMemoryStore<Record<string, unknown>>();
}

export function createInMemoryMerges() {
  const store = createInMemoryStore<Record<string, unknown>>();
  // merges インターフェースは put のみ使う
  return { put: store.put.bind(store), _records: store._records };
}

export function createInMemoryNodes() {
  return createInMemoryStore<Record<string, unknown>>();
}

export function createInMemoryEdges() {
  return createInMemoryStore<Record<string, unknown>>();
}

export function createInMemoryNodeLayouts() {
  return createInMemoryStore<Record<string, unknown>>();
}

export function createInMemoryEdgeLayouts() {
  return createInMemoryStore<Record<string, unknown>>();
}

export function createInMemorySheets() {
  const store = createInMemoryStore<Record<string, unknown>>();
  // sheets インターフェースは get のみ使う
  return { get: store.get.bind(store), _records: store._records };
}

import type { BranchStateDeps } from '../collectionTypes';

export function createInMemoryDeps(
  overrides?: Partial<BranchStateDeps>,
): BranchStateDeps {
  return {
    branches: createInMemoryBranches() as BranchStateDeps['branches'],
    commits: createInMemoryCommits() as BranchStateDeps['commits'],
    merges: createInMemoryMerges() as BranchStateDeps['merges'],
    nodes: createInMemoryNodes() as BranchStateDeps['nodes'],
    edges: createInMemoryEdges() as BranchStateDeps['edges'],
    nodeLayouts: createInMemoryNodeLayouts() as BranchStateDeps['nodeLayouts'],
    edgeLayouts: createInMemoryEdgeLayouts() as BranchStateDeps['edgeLayouts'],
    sheets: createInMemorySheets() as BranchStateDeps['sheets'],
    ...overrides,
  };
}
