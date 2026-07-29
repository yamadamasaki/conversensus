import {
  type Batch,
  type BranchMeta,
  type Commit,
  type GraphFile,
  type GraphFileListItem,
  graphFileToBatches,
} from '@conversensus/shared';
import { INITIAL_CURSOR } from '../../sync/syncProvider';
import type { BranchOplogDeps } from '../useBranchOperations';
import type { FileSheetOpsDeps } from '../useFileSheetOperations';

// biome-ignore lint/suspicious/noExplicitAny: fetchBranchSheetFromPds の戻り値は any で十分
type AnySheet = any;

export function createInMemoryFileSheetOpsDeps(): FileSheetOpsDeps & {
  _files: Map<string, GraphFile>;
  _fileList: GraphFileListItem[];
} {
  const fileStore = new Map<string, GraphFile>();
  const fileList: GraphFileListItem[] = [];

  const deps: FileSheetOpsDeps & {
    _files: Map<string, GraphFile>;
    _fileList: GraphFileListItem[];
  } = {
    _files: fileStore,
    _fileList: fileList,

    createFile: async (name: string) => {
      const id = crypto.randomUUID();
      const file: GraphFile = {
        id,
        name,
        description: '',
        sheets: [
          { id: crypto.randomUUID(), name: 'Sheet 1', nodes: [], edges: [] },
        ],
      };
      fileStore.set(id, file);
      fileList.push({
        id: file.id,
        name: file.name,
        description: file.description,
      });
      return file;
    },

    exportFile: (_file: GraphFile) => {
      // no-op in tests
    },

    // server の op-log を模す。`POST /files` の genesis 直書き (p6-1) と同じく、
    // 作成済みファイルは必ず genesis を持つ。未知 id は空 op-log。
    // zod mock 下で genesis の batch id が実 UUID にならないため、決定論的な plain id に
    // 振り直して projection の tiebreak を安定させる。
    fetchBatches: async (id: string) => {
      const file = fileStore.get(id);
      if (!file) return [];
      return graphFileToBatches(file).map(
        (b, i) => ({ ...b, id: `genesis-${i}` }) as Batch,
      );
    },

    fetchFiles: async () => [...fileList],

    // 受信 materialize の書き込み口 (Phase 4e-2b)。in-memory では何も書かない。
    pushReceivedBatches: async () => 0,

    importFile: async (
      data: import('@conversensus/shared').ConversensusFile,
    ) => {
      const file: GraphFile = {
        id: data.id,
        name: data.name,
        description: data.description ?? '',
        sheets: data.sheets,
      };
      fileStore.set(file.id, file);
      fileList.push({
        id: file.id,
        name: file.name,
        description: file.description,
      });
      return file;
    },

    removeFile: async (id: string) => {
      fileStore.delete(id);
      const idx = fileList.findIndex((f) => f.id === id);
      if (idx >= 0) fileList.splice(idx, 1);
    },

    atprotoFilesDelete: async (_id: string) => {
      // no-op in tests
    },
  };

  return deps;
}

/**
 * op-log 経路 (step1 Phase 5 p5-4) の in-memory deps。
 *
 * 1 つの batches ストアを **branch tap の書き込み口と projection の読取口で共有**する
 * ところが要 — hook が「編集を branch 専用 op-log へ流し、そこから読み直す」ことを
 * 単体で検証できるようにする。
 */
export function createInMemoryBranchOplogDeps(): BranchOplogDeps & {
  _batches: Map<string, Batch[]>;
  _branches: Map<string, BranchMeta>;
  _commits: Map<string, Commit[]>;
} {
  const batches = new Map<string, Batch[]>();
  const branches = new Map<string, BranchMeta>();
  const commits = new Map<string, Commit[]>();
  let idCounter = 0;

  const append = (fileId: string, items: Batch[]): number => {
    const log = batches.get(fileId) ?? [];
    const known = new Set(log.map((b) => b.id));
    const added = items.filter((b) => !known.has(b.id));
    batches.set(fileId, [...log, ...added]);
    return added.length;
  };

  return {
    _batches: batches,
    _branches: branches,
    _commits: commits,

    fetchBatches: async (fileId) => [...(batches.get(fileId) ?? [])],
    appendBatches: async (fileId, items) => append(fileId, items),

    saveBranch: async (meta) => {
      branches.set(meta.id, meta);
      return meta;
    },
    fetchBranches: async (trunkFileId) =>
      [...branches.values()].filter((b) => b.trunkFileId === trunkFileId),
    deleteBranch: async (_trunkFileId, branchId) => {
      const meta = branches.get(branchId);
      if (!meta) return;
      branches.delete(branchId);
      batches.delete(meta.branchFileId);
      commits.delete(meta.branchFileId);
    },

    saveCommit: async (fileId, commit) => {
      commits.set(fileId, [...(commits.get(fileId) ?? []), commit]);
      return commit;
    },
    fetchCommits: async (fileId) => [...(commits.get(fileId) ?? [])],

    // 決定論的な id。projection の tiebreak (clock→actor→id) を安定させる
    newId: () => {
      idCounter += 1;
      return `id-${idCounter}`;
    },

    // branch tap の宛先。同じ batches ストアへ書くので、書いた直後の projection に載る
    createBranchProvider: (fileId) => ({
      push: async (items: Batch[]) => {
        append(fileId, items);
      },
      pull: async () => ({
        batches: [...(batches.get(fileId) ?? [])],
        cursor: INITIAL_CURSOR,
      }),
      subscribe: () => () => {},
    }),
  };
}

export function createInMemoryBranchOpsDeps(): {
  createBranch: (
    name: string,
    sheetId: string,
    sheetRef: { uri: string; cid: string },
  ) => Promise<AnySheet>;
  fetchBranchesForSheet: (sheetId: string) => Promise<AnySheet[]>;
  fetchBranchSheetFromPds: (
    branchId: string,
    sheetId: string,
  ) => Promise<AnySheet>;
  fetchCommitsForBranch: (branchUri: string) => Promise<AnySheet[]>;
  mergeBranchToTrunk: (
    branch: AnySheet,
    sheetId: string,
    sheetRef: AnySheet,
  ) => Promise<void>;
  createMergeRecord: (
    branch: AnySheet,
    sheetRef: AnySheet,
    branchRef: AnySheet,
    latestCommit?: AnySheet,
  ) => Promise<AnySheet>;
  updateBranchStatus: (branch: AnySheet, status: string) => Promise<AnySheet>;
  deleteBranchWithRecords: (branch: AnySheet) => Promise<void>;
  createCommit: (
    message: string,
    ops: AnySheet[],
    sheetRef: AnySheet,
    branchRef: AnySheet,
    parentRef?: AnySheet,
  ) => Promise<AnySheet>;
  sheetsRef: (sheetId: string) => Promise<{ uri: string; cid: string }>;
  syncFileToAtproto: (file: AnySheet) => Promise<void>;
  computeOperations: (base: AnySheet, current: AnySheet) => AnySheet[];
  TRUNK_PREFIX: string;
  _branches: Map<string, AnySheet[]>;
  _commits: Map<string, AnySheet[]>;
  _setComputeOps: (ops: AnySheet[]) => void;
} {
  const branches = new Map<string, AnySheet[]>();
  const commits = new Map<string, AnySheet[]>();
  let branchCounter = 0;
  let _computeOps: AnySheet[] = [];

  return {
    _branches: branches,
    _commits: commits,

    createBranch: async (name: string, sheetId: string) => {
      branchCounter++;
      const branch = {
        id: `b-${branchCounter}`,
        name,
        uri: `at://branch/${branchCounter}`,
        cid: `cid-b-${branchCounter}`,
        sheetId,
        status: 'open' as const,
      };
      const existing = branches.get(sheetId) ?? [];
      existing.push(branch);
      branches.set(sheetId, existing);
      return branch;
    },

    fetchBranchesForSheet: async (sheetId: string) =>
      branches.get(sheetId) ?? [],

    fetchBranchSheetFromPds: async (_branchId: string, _sheetId: string) => ({
      id: _sheetId,
      name: 'Sheet 1',
      nodes: [],
      edges: [],
    }),

    fetchCommitsForBranch: async (branchUri: string) =>
      commits.get(branchUri) ?? [],

    mergeBranchToTrunk: async () => {},

    createMergeRecord: async () => ({
      uri: 'at://merge/1',
      cid: 'cid-m',
    }),

    updateBranchStatus: async (branch: AnySheet, status: string) => ({
      ...branch,
      status,
    }),

    deleteBranchWithRecords: async (branch: AnySheet) => {
      const sheetBranches = branches.get(branch.sheetId) ?? [];
      branches.set(
        branch.sheetId,
        sheetBranches.filter((b: AnySheet) => b.id !== branch.id),
      );
    },

    createCommit: async (
      _message: string,
      _ops: AnySheet[],
      _sheetRef: AnySheet,
      branchRef: AnySheet,
      _parentRef?: AnySheet,
    ) => {
      const commit = {
        uri: `at://commit/${Date.now()}`,
        cid: `cid-c-${Date.now()}`,
        message: _message,
        ops: _ops,
      };
      const existing = commits.get(branchRef.uri) ?? [];
      existing.push(commit);
      commits.set(branchRef.uri, existing);
      return commit;
    },

    sheetsRef: async (_sheetId: string) => ({
      uri: `at://sheet/${_sheetId}`,
      cid: 'cid-s',
    }),

    syncFileToAtproto: async () => {},

    computeOperations: () => _computeOps,

    _setComputeOps: (ops: AnySheet[]) => {
      _computeOps = ops;
    },

    TRUNK_PREFIX: 'trunk',
  };
}
