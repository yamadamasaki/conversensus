import type { GraphFile, GraphFileListItem } from '@conversensus/shared';
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

    fetchFile: async (id: string) => {
      const file = fileStore.get(id);
      if (!file) throw new Error(`File not found: ${id}`);
      return file;
    },

    fetchFiles: async () => [...fileList],

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

    saveFile: async (_file: GraphFile) => {
      // no-op in tests (cache save)
    },

    atprotoFilesDelete: async (_id: string) => {
      // no-op in tests
    },

    fetchFileFromAtproto: async (_id: string) => {
      throw new Error('Not found');
    },

    fetchFilesFromAtproto: async () => [],

    login: async (_handle: string, _password: string) => {
      // no-op in tests
    },

    syncFileToAtproto: async (_file: GraphFile) => {
      // no-op in tests
    },
  };

  return deps;
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
} {
  const branches = new Map<string, AnySheet[]>();
  const commits = new Map<string, AnySheet[]>();
  let branchCounter = 0;

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

    computeOperations: () => [],

    TRUNK_PREFIX: 'trunk',
  };
}
