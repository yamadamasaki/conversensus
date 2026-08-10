import {
  type Batch,
  type BranchMeta,
  type Commit,
  type CommitOperation,
  type GraphFile,
  type GraphFileListItem,
  graphFileToBatches,
} from '@conversensus/shared';
import type { SheetChange } from '../../sync/computeOperations';
import { INITIAL_CURSOR } from '../../sync/syncProvider';
import type { BranchOplogDeps, BranchOpsDeps } from '../useBranchOperations';
import type { FileSheetOpsDeps } from '../useFileSheetOperations';

export function createInMemoryFileSheetOpsDeps(): FileSheetOpsDeps & {
  _files: Map<string, GraphFile>;
  _fileList: GraphFileListItem[];
} {
  const fileStore = new Map<string, GraphFile>();
  const fileList: GraphFileListItem[] = [];
  /** tombstone を立てた fileId (ANA-127)。fileStore からは消えない */
  const deletedIds = new Set<string>();

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

    // 一覧は削除済みを隠す (server の `listOplogFiles` と同じ, ANA-127)
    fetchFiles: async () => fileList.filter((f) => !deletedIds.has(f.id)),

    // 既知集合は削除済みも含む (server の `listAllFileIds`)。**この非対称が ANA-127 の
    // 修正そのもの**なので、in-memory 側でも忠実に再現する — ここを一覧と同じにすると
    // 「削除したファイルを discovery が materialize し直さない」テストが素通りする。
    //
    // fileStore と fileList の和を取るのは、materialize (`pushReceivedBatches`) を
    // 模すテストが fileList にだけ積むためである。実装では op-log の行が唯一の
    // 出どころなので和は要らない。
    fetchLocalFileIds: async () => [
      ...new Set([...fileStore.keys(), ...fileList.map((f) => f.id)]),
    ],

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

    // 削除 = tombstone (ANA-127)。**fileStore からは消さない** — 実装側でも op-log の
    // 行は残り、それが discovery の既知集合になる。実 provider (HTTP) を叩かないよう
    // `deleteFileByTombstone` ごと差し替える。
    deleteFile: async (fileId, actor) => {
      deletedIds.add(fileId);
      return {
        id: `tombstone-${fileId}` as Batch['id'],
        actor,
        clock: 1,
        timestamp: 0,
        ops: [{ kind: 'file.remove' }],
      };
    },

    // rkey 移行 (Phase 7 p7-4) は既定で「移行済」= 走らせない。移行の副作用が
    // 発見・受信のテストの観測に混ざらないようにする (移行自体は
    // `migrateRemoteRkey.test.ts` と、これを false にする専用テストで見る)。
    hasRkeyMigrated: () => true,
    markRkeyMigrated: () => {},
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
    }),
  };
}

/**
 * `BranchOpsDeps` の in-memory 実装 (step1 Phase 6 p6-5b で純粋関数だけになった)。
 *
 * `computeSheetChanges` を差し替え可能にしてあるのは、pendingChanges / ハイライト /
 * ゴースト表示といった **UI の見え方が差分計算の結果だけで決まる**ことを、シートを
 * 実際に編集せずに固定するため。
 */
export function createInMemoryBranchOpsDeps(): BranchOpsDeps & {
  _setComputeOps: (ops: CommitOperation[]) => void;
} {
  let _changes: SheetChange[] = [];

  return {
    computeSheetChanges: () => _changes,

    // 呼び出し側は op だけを与えればよい。カテゴリは op の種別から素直に決まる
    // (追加・削除は structure、更新は content) ので、テストの記述量を増やさない。
    _setComputeOps: (ops: CommitOperation[]) => {
      _changes = ops.map((op) => ({
        op,
        categories: [
          op.op.endsWith('.update') ? 'content' : 'structure',
        ] as SheetChange['categories'],
      }));
    },
  };
}
