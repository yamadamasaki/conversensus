import type {
  Actor,
  Batch,
  BranchId,
  BranchMeta,
  Commit,
  CommitId,
  EdgeLayout,
  FileId,
  GraphEdge,
  GraphFile,
  GraphNode,
  NodeLayout,
  Sheet,
  SheetId,
} from '@conversensus/shared';
import { BRANCH_STATUS, makeCommit } from '@conversensus/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api';
import { TRUNK_PREFIX } from '../atproto';
import {
  type BranchProjectionDeps,
  createBranchOnOplog,
  readBranchSheets,
} from '../sync/branchProjection';
import { computeSheetChanges } from '../sync/computeOperations';
import { mergeBranchOnOplog } from '../sync/mergeBranch';
import type { SyncProvider } from '../sync/syncProvider';
import { type TapClock, useEventSyncTap } from './useEventSyncTap';

/**
 * ブランチの差分状態 (ANA-119/120, S3)。
 *
 * **差分の起点は状態から 1 つに決まる。** 以前は「分岐点」基準 (画面のハイライト) と
 * 「直近コミット」基準 (commit ダイアログ) の 2 つが並列に生きていて、1 回 commit した
 * 後に編集を続けると **同じ画面で 2 つの異なる差分が同時に意味を持っていた**。
 * 状態をコードの一級の概念にして, 起点をそこから決めることで食い違いを構造的に無くす。
 *
 * 仕様は `deepse/requirements/operation-manual-for-dev.md`「ブランチの作成と利用」。
 */
export const BRANCH_DIFF_STATE = {
  /** trunk 表示中。差分は出さない */
  TRUNK: 'trunk',
  /** 分岐直後 / merge 直後。差分は出さない */
  UNCHANGED: 'unchanged',
  /** 前回 commit (無ければ分岐点) 以降に編集がある。起点 = 前回 commit = **次の commit の対象** */
  EDITING: 'editing',
  /** 編集が無く commit が 1 件以上ある。起点 = 分岐点 = **次の merge の対象** */
  COMMITTED: 'committed',
} as const;

export type BranchDiffState =
  (typeof BRANCH_DIFF_STATE)[keyof typeof BRANCH_DIFF_STATE];

/**
 * 差分状態を決める。**唯一の判定規則**として切り出してある (hook の外から検証できる)。
 *
 * @param hasPendingChanges 直近コミット (無ければ分岐点) 以降に正味の差分があるか
 * @param commitCount 前回 merge 以降の commit 数
 */
export function resolveBranchDiffState(
  isTrunk: boolean,
  hasPendingChanges: boolean,
  commitCount: number,
): BranchDiffState {
  if (isTrunk) return BRANCH_DIFF_STATE.TRUNK;
  if (hasPendingChanges) return BRANCH_DIFF_STATE.EDITING;
  if (commitCount > 0) return BRANCH_DIFF_STATE.COMMITTED;
  return BRANCH_DIFF_STATE.UNCHANGED;
}

type ConfirmState = {
  message: string;
  resolve: (ok: boolean) => void;
};

type InputState = {
  message: string;
  resolve: (value: string) => void;
};

type AlertState = {
  message: string;
  resolve: () => void;
};

/**
 * UI 表示用の差分計算 (step1 Phase 6 p6-5b で残った唯一の注入点)。
 *
 * 旧 PDS 経路 (`branchState.ts`) の I/O 関数群はここに並んでいたが、安全弁
 * `BRANCH_FROM_OPLOG` の撤去で経路ごと退役した。op-log 側の I/O は
 * `BranchOplogDeps` にあるので、こちらに残るのは純粋関数だけである。
 */
export interface BranchOpsDeps {
  computeSheetChanges: typeof computeSheetChanges;
}

export const defaultBranchOpsDeps: BranchOpsDeps = {
  computeSheetChanges,
};

/**
 * op-log 経路の I/O (step1 Phase 5 p5-4)。すべてローカルデーモン向けで
 * **remote (ATProto) へは出さない** (設計 §9.2 の不変条件: branch は local 専用)。
 */
export interface BranchOplogDeps extends BranchProjectionDeps {
  appendBatches: (fileId: FileId, batches: Batch[]) => Promise<number>;
  fetchBranches: (trunkFileId: FileId) => Promise<BranchMeta[]>;
  deleteBranch: (trunkFileId: FileId, branchId: BranchId) => Promise<void>;
  saveCommit: (fileId: FileId, commit: Commit) => Promise<Commit>;
  fetchCommits: (fileId: FileId) => Promise<Commit[]>;
  /** branch 編集の書き込み先 provider (テスト差し替え用。既定はローカルデーモン) */
  createBranchProvider?: (fileId: FileId) => SyncProvider;
}

export const defaultBranchOplogDeps: BranchOplogDeps = {
  fetchBatches: (fileId) => api.fetchBatches(fileId),
  appendBatches: api.pushBatches,
  saveBranch: api.saveBranch,
  fetchBranches: api.fetchBranches,
  deleteBranch: api.deleteBranch,
  saveCommit: api.saveCommit,
  fetchCommits: api.fetchCommits,
  newId: () => crypto.randomUUID(),
};

interface UseBranchOperationsParams {
  activeFile: GraphFile | null;
  activeSheetId: SheetId | null;
  activeSheet: Sheet | null;
  onSetActiveFile: (file: GraphFile | null) => void;
  setConfirmState: (s: ConfirmState | null) => void;
  setInputState: (s: InputState | null) => void;
  setAlertState: (s: AlertState | null) => void;
  /**
   * この端末の操作主体 `<did>#<deviceId>` (Phase 4d-2)。branch batch / commit の作者。
   * **既定値を持たせない** — 'local' 等に落とすと 4d-2 で削除した `LOCAL_ACTOR` が
   * 復活し、端末を識別できない batch が静かに生まれる。
   */
  actor: Actor;
  /**
   * trunk の Lamport 発番器。merge の再スタンプに使う (p5-4)。
   * **既定値を持たせない** — no-op に落とすと clock 0 の batch が trunk に入る。
   */
  trunkClock: TapClock;
  deps?: BranchOpsDeps;
  oplogDeps?: BranchOplogDeps;
}

export function useBranchOperations({
  activeFile,
  activeSheetId,
  activeSheet,
  onSetActiveFile,
  setConfirmState,
  setInputState,
  setAlertState,
  actor,
  trunkClock,
  deps = defaultBranchOpsDeps,
  oplogDeps = defaultBranchOplogDeps,
}: UseBranchOperationsParams) {
  const [activeBranch, setActiveBranch] = useState<BranchMeta | null>(null);
  const [sheetBranches, setSheetBranches] = useState<Map<string, BranchMeta[]>>(
    new Map(),
  );
  const [newCommitsSinceMerge, setNewCommitsSinceMerge] = useState(0);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);

  const [lastCommitBase, setLastCommitBase] = useState<Sheet | null>(null);
  const [branchOriginalBase, setBranchOriginalBase] = useState<Sheet | null>(
    null,
  );
  const preBranchFile = useRef<GraphFile | null>(null);
  // merge 時にその時点の newCommitsSinceMerge を累積保存し、
  // 再エントリ時に commits.length - 累積値 で真の新規コミット数を計算する。
  // **base / 直近コミット時点の控えは持たない** — op-log からその都度導出する (p5-4)。
  const mergedCommitCounts = useRef<Map<string, number>>(new Map());

  const isTrunk = !activeBranch || activeBranch.name === TRUNK_PREFIX;

  // branch を開いている間だけ、編集の宛先を branch 専用 op-log にする。
  // **これが載せ替えの要**: 旧経路では branch 中の編集も trunk の tap に流れていたため、
  // branch の編集が trunk の op-log を汚していた (W3d で branch を凍結した際の積み残し)。
  const { record: branchSyncRecord, settled: branchSettled } = useEventSyncTap(
    activeBranch?.branchFileId ?? null,
    {
      actor,
      // 分岐点の後から発番する。空の branch op-log は clock 1 から始まってしまい、
      // それでは base 時点の trunk batch に LWW で負ける (§p5-4)。
      ...(activeBranch && { clockFloor: activeBranch.base.at }),
      // remoteQueue は渡さない = branch batches は remote へ出ない (設計 §9.2)
      ...(oplogDeps.createBranchProvider && {
        createLocalProvider: oplogDeps.createBranchProvider,
      }),
    },
  );

  // File が切り替わったらブランチ状態をリセット
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeFile?.id の変化をトリガーにする意図的な設計
  useEffect(() => {
    setActiveBranch(null);
    setLastCommitBase(null);
    setBranchOriginalBase(null);
    setNewCommitsSinceMerge(0);
    mergedCommitCounts.current.clear();
    preBranchFile.current = null;
  }, [activeFile?.id]);

  /**
   * 未コミットの変更 = 直近コミット (無ければ分岐点) からの正味の差分。
   *
   * **コミットの実体は「ログ上のラベル付きオフセット」だが、表示はあくまで正味の差分**に
   * する (p5-4 の確定事項)。op-log の未コミット batch をそのまま数えると、編集して undo した
   * 往復が「2 変更」に見えてしまうため。基準の `lastCommitBase` は op-log から導出する。
   *
   * これが空かどうかが「変更中」かどうかの判定 (= 差分状態の入力) でもある。
   */
  const pendingChanges = useMemo(() => {
    if (
      isTrunk ||
      !lastCommitBase ||
      !activeSheet ||
      (activeBranch?.status !== BRANCH_STATUS.OPEN &&
        activeBranch?.status !== BRANCH_STATUS.MERGED)
    )
      return [];
    return deps.computeSheetChanges(lastCommitBase, activeSheet);
  }, [isTrunk, lastCommitBase, activeSheet, activeBranch?.status, deps]);

  const diffState = useMemo(
    () =>
      resolveBranchDiffState(
        isTrunk,
        pendingChanges.length > 0,
        newCommitsSinceMerge,
      ),
    [isTrunk, pendingChanges.length, newCommitsSinceMerge],
  );

  /** 差分の起点。状態から 1 つに決まる (無変更 / trunk では起点を持たない) */
  const diffBase = useMemo(() => {
    if (diffState === BRANCH_DIFF_STATE.EDITING) return lastCommitBase;
    if (diffState === BRANCH_DIFF_STATE.COMMITTED) return branchOriginalBase;
    return null;
  }, [diffState, lastCommitBase, branchOriginalBase]);

  /**
   * 画面に出す差分。**commit ダイアログと同じ起点から出す** — 変更中は
   * `pendingChanges` そのもの、commit 済みなら分岐点からの差分 (= 次の merge の対象)。
   */
  const changes = useMemo(() => {
    if (diffState === BRANCH_DIFF_STATE.EDITING) return pendingChanges;
    if (!diffBase || !activeSheet) return [];
    return deps.computeSheetChanges(diffBase, activeSheet);
  }, [diffState, diffBase, activeSheet, pendingChanges, deps]);

  const [addedNodeIds, updatedNodeIds, addedEdgeIds, updatedEdgeIds] =
    useMemo(() => {
      const addN = new Set<string>();
      const updN = new Set<string>();
      const addE = new Set<string>();
      const updE = new Set<string>();
      for (const { op } of changes) {
        if (op.op === 'node.add') addN.add(op.nodeId);
        else if (op.op === 'node.update') updN.add(op.nodeId);
        else if (op.op === 'edge.add') addE.add(op.edgeId);
        else if (op.op === 'edge.update') updE.add(op.edgeId);
        // remove は conflicted に含めない（ゴースト表示用に別途計算）
      }
      return [addN, updN, addE, updE] as const;
    }, [changes]);

  // 削除予定のノード/エッジ（起点に存在し current に存在しない）
  const [deletedNodes, deletedEdges, deletedNodeLayouts, deletedEdgeLayouts] =
    useMemo(() => {
      if (!diffBase) return [[], [], [], []] as const;
      const removedNodeIds = new Set<string>();
      const removedEdgeIds = new Set<string>();
      for (const { op } of changes) {
        if (op.op === 'node.remove') removedNodeIds.add(op.nodeId);
        if (op.op === 'edge.remove') removedEdgeIds.add(op.edgeId);
      }
      return [
        diffBase.nodes.filter((n) => removedNodeIds.has(n.id)),
        diffBase.edges.filter((e) => removedEdgeIds.has(e.id)),
        (diffBase.layouts ?? []).filter((l) => removedNodeIds.has(l.nodeId)),
        (diffBase.edgeLayouts ?? []).filter((l) =>
          removedEdgeIds.has(l.edgeId),
        ),
      ] as const;
    }, [diffBase, changes]);

  /**
   * branch 状態を捨てて trunk へ戻る。
   *
   * @returns 復帰した trunk のファイル。**呼び出し側が trunk のファイルを起点に
   *   処理を続けられるようにする** — branch 表示中の `activeFile` は該当シートが
   *   branch の内容なので、それを土台にファイルを組み立てると branch の内容が
   *   trunk へ移ってしまう (シート追加の経路で実際に起きていた)。
   */
  const resetBranchState = useCallback((): GraphFile | null => {
    setActiveBranch(null);
    setLastCommitBase(null);
    setBranchOriginalBase(null);
    setNewCommitsSinceMerge(0);
    const restored = preBranchFile.current;
    if (restored) {
      onSetActiveFile(restored);
      preBranchFile.current = null;
    }
    return restored;
  }, [onSetActiveFile]);

  /** trunk へ戻る。branch 側の内容は branch tap が既に op-log へ書いている */
  const backToTrunk = useCallback(
    (branch: BranchMeta | null) => {
      setActiveBranch(branch);
      setLastCommitBase(null);
      setBranchOriginalBase(null);
      setNewCommitsSinceMerge(0);
      if (preBranchFile.current) {
        onSetActiveFile(preBranchFile.current);
        preBranchFile.current = null;
      }
    },
    [onSetActiveFile],
  );

  /** branch のシート内容を op-log の projection から組み立てて表示に載せる */
  const selectBranchFromOplog = useCallback(
    async (sheetId: SheetId, meta: BranchMeta) => {
      if (!activeFile) return;
      const sheetMeta = activeFile.sheets.find((s) => s.id === sheetId) ?? {
        id: sheetId,
        name: '',
      };
      const commits = await oplogDeps.fetchCommits(meta.branchFileId);
      const lastCommit = commits[commits.length - 1];
      const { current, base, atLastCommit } = await readBranchSheets(
        meta,
        { id: sheetMeta.id, name: sheetMeta.name },
        oplogDeps,
        { ...(lastCommit && { lastCommitAt: lastCommit.at }) },
      );

      // trunk からブランチに入る時のみ trunk の状態を保存
      if (!activeBranch || activeBranch.name === TRUNK_PREFIX) {
        preBranchFile.current = activeFile;
      }

      // 旧経路と違い base / 直近コミット時点は控えを持たずログから導出する
      setBranchOriginalBase(base);
      setLastCommitBase(
        meta.status === BRANCH_STATUS.OPEN ||
          meta.status === BRANCH_STATUS.MERGED
          ? atLastCommit
          : null,
      );
      onSetActiveFile({
        ...activeFile,
        sheets: activeFile.sheets.map((s) => (s.id === sheetId ? current : s)),
      });
      if (meta.status === BRANCH_STATUS.MERGED) {
        const mergedCount = mergedCommitCounts.current.get(meta.id) ?? 0;
        setNewCommitsSinceMerge(Math.max(0, commits.length - mergedCount));
      } else {
        setNewCommitsSinceMerge(commits.length);
      }
      setActiveBranch(meta);
    },
    [activeFile, activeBranch, onSetActiveFile, oplogDeps],
  );

  const handleSelectBranch = useCallback(
    async (sheetId: SheetId, branch: BranchMeta | null) => {
      if (!branch || branch.name === TRUNK_PREFIX) {
        // 編集は branch tap が逐次 op-log へ書いているので、抜ける前の保存は要らない
        // (旧 PDS 経路にあった pre-switch save は p6-5b で経路ごと退役した)。
        backToTrunk(branch);
        return;
      }

      try {
        await selectBranchFromOplog(sheetId, branch);
      } catch (err) {
        console.warn('[branch] select failed:', err);
        // 失敗を握り潰すと「クリックしても何も起きない」になる (W3d5-7 の教訓)。
        // 失敗は daemon 由来なので、原因を切り分けられるよう画面にも出す。
        await new Promise<void>((resolve) => {
          setAlertState({
            message: 'branch を開けませんでした。',
            resolve,
          });
        });
      }
    },
    [setAlertState, backToTrunk, selectBranchFromOplog],
  );

  const handleCreateBranch = useCallback(
    async (sheetId: SheetId) => {
      const name = await new Promise<string>((resolve) => {
        setInputState({ message: 'branch 名を入力してください:', resolve });
      });
      if (!name?.trim()) return;
      try {
        if (!activeFile) throw new Error('アクティブなファイルがありません');
        // 複製は行わず、分岐点 (現在のログ先端) を指す base コミットだけを記録する
        const branch = await createBranchOnOplog(
          {
            name: name.trim(),
            sheetId,
            trunkFileId: activeFile.id as FileId,
            authorActor: actor,
          },
          oplogDeps,
        );
        setSheetBranches((prev) => {
          const next = new Map(prev);
          const existing = next.get(sheetId) ?? [];
          next.set(sheetId, [...existing, branch]);
          return next;
        });
      } catch (err) {
        console.warn('[branch] create failed:', err);
        await new Promise<void>((resolve) => {
          setAlertState({
            message: 'branch の作成に失敗しました。',
            resolve,
          });
        });
      }
    },
    [activeFile, setInputState, setAlertState, oplogDeps, actor],
  );

  /** merge 後の後始末 */
  const afterMerge = useCallback(
    (sheetId: SheetId, merged: BranchMeta, mergedTrunk?: GraphFile) => {
      setSheetBranches((prev) => {
        const next = new Map(prev);
        const existing = next.get(sheetId) ?? [];
        next.set(
          sheetId,
          existing.map((b) => (b.id === merged.id ? merged : b)),
        );
        return next;
      });
      // trunk へ戻ったときに merge 済みの内容が見えるようにする
      if (mergedTrunk) {
        preBranchFile.current = mergedTrunk;
      } else if (activeFile && activeSheet) {
        preBranchFile.current = {
          ...activeFile,
          sheets: activeFile.sheets.map((s) =>
            s.id === sheetId ? activeSheet : s,
          ),
        };
      }
      setActiveBranch(merged);
      setBranchOriginalBase(activeSheet ?? null);
      setLastCommitBase(activeSheet ?? null);
      // 今回 merge したコミット数を累積
      mergedCommitCounts.current.set(
        merged.id,
        (mergedCommitCounts.current.get(merged.id) ?? 0) + newCommitsSinceMerge,
      );
      setNewCommitsSinceMerge(0);
    },
    [activeFile, activeSheet, newCommitsSinceMerge],
  );

  const handleMergeBranch = useCallback(
    async (branch: BranchMeta) => {
      if (!activeSheetId || !activeFile) return;
      const ok = await new Promise<boolean>((resolve) => {
        setConfirmState({
          message: `branch "${branch.name}" を trunk に merge しますか？`,
          resolve,
        });
      });
      if (!ok) return;
      try {
        // 🔴 直前の編集が branch op-log に着地するのを待つ。待たないと、その編集が
        // trunk に載らないまま branch だけ MERGED になる (record は非同期に flush する)。
        await branchSettled();
        // branch batches を trunk 先端の後へ再スタンプして trunk op-log へ追記する。
        // 再スタンプの発番は trunk の tap と同じ clock で行う (同 clock の衝突回避)。
        const result = await mergeBranchOnOplog(branch, {
          fetchBatches: oplogDeps.fetchBatches,
          appendBatches: oplogDeps.appendBatches,
          saveBranch: oplogDeps.saveBranch,
          seedClock: trunkClock.seed,
          tick: trunkClock.tick,
        });
        if (result.conflicts.length > 0) {
          // 収束は LWW で確定させ、対立は診断ログに残す (可視化は後続 phase)
          console.warn(
            `[branch] merge: ${result.conflicts.length} 件の content 対立を LWW で確定`,
            result.conflicts,
          );
        }
        afterMerge(activeSheetId, result.branch, result.trunk);
      } catch (err) {
        console.warn('[branch] merge failed:', err);
        await new Promise<void>((resolve) => {
          setAlertState({ message: 'merge に失敗しました。', resolve });
        });
      }
    },
    [
      activeSheetId,
      activeFile,
      setConfirmState,
      setAlertState,
      oplogDeps,
      trunkClock,
      afterMerge,
      branchSettled,
    ],
  );

  /** close / delete でアクティブなブランチが失われたときの後始末 */
  const clearActiveBranch = useCallback(
    (branch: BranchMeta) => {
      if (activeBranch?.id !== branch.id) return;
      backToTrunk(null);
    },
    [activeBranch, backToTrunk],
  );

  const handleCloseBranch = useCallback(
    async (branch: BranchMeta) => {
      const ok = await new Promise<boolean>((resolve) => {
        setConfirmState({
          message: `branch "${branch.name}" を close しますか？`,
          resolve,
        });
      });
      if (!ok) return;
      try {
        const closedBranch = await oplogDeps.saveBranch({
          ...branch,
          status: BRANCH_STATUS.CLOSED,
        });
        setSheetBranches((prev) => {
          const next = new Map(prev);
          const sheetId = branch.sheetId;
          const existing = next.get(sheetId) ?? [];
          next.set(
            sheetId,
            existing.map((b) => (b.id === branch.id ? closedBranch : b)),
          );
          return next;
        });
        clearActiveBranch(branch);
      } catch (err) {
        console.warn('[branch] close failed:', err);
        await new Promise<void>((resolve) => {
          setAlertState({ message: 'close に失敗しました。', resolve });
        });
      }
    },
    [setConfirmState, setAlertState, oplogDeps, clearActiveBranch],
  );

  const handleDeleteBranch = useCallback(
    async (branch: BranchMeta) => {
      const ok = await new Promise<boolean>((resolve) => {
        setConfirmState({
          message: `branch "${branch.name}" を削除しますか？\nこの操作は取り消せません。`,
          resolve,
        });
      });
      if (!ok) return;
      try {
        // メタと branch 専用 op-log をまとめて消す (server 側 1 tx)
        await oplogDeps.deleteBranch(branch.trunkFileId, branch.id);
        setSheetBranches((prev) => {
          const next = new Map(prev);
          const sheetId = branch.sheetId;
          next.set(
            sheetId,
            (next.get(sheetId) ?? []).filter((b) => b.id !== branch.id),
          );
          return next;
        });
        clearActiveBranch(branch);
      } catch (err) {
        console.warn('[branch] delete failed:', err);
        await new Promise<void>((resolve) => {
          setAlertState({ message: '削除に失敗しました。', resolve });
        });
      }
    },
    [setConfirmState, setAlertState, oplogDeps, clearActiveBranch],
  );

  const handleCommit = useCallback(
    async (message: string) => {
      if (!activeBranch || !activeSheetId || !activeSheet) return;
      if (pendingChanges.length === 0) return;

      try {
        // 直前の編集の着地を待つ。待たないとその編集がコミット位置に入らず、
        // 再オープン時に「コミット済みのはずの変更」が未コミットとして復活する。
        await branchSettled();
        // コミット = ログ上のラベル付きオフセット。差分そのものは持たない
        // (`pendingChanges` は表示用で、コミットに焼き込むのはログ位置だけ)。
        const branchBatches = await oplogDeps.fetchBatches(
          activeBranch.branchFileId,
        );
        const commit = makeCommit(
          oplogDeps.newId() as CommitId,
          message,
          actor,
          branchBatches,
        );
        await oplogDeps.saveCommit(activeBranch.branchFileId, commit);

        setLastCommitBase(activeSheet);
        setNewCommitsSinceMerge((prev) => prev + 1);
        setCommitDialogOpen(false);
      } catch (err) {
        console.warn('[commit] create failed:', err);
        await new Promise<void>((resolve) => {
          setAlertState({ message: 'コミットに失敗しました。', resolve });
        });
      }
    },
    [
      activeBranch,
      activeSheetId,
      activeSheet,
      pendingChanges,
      setAlertState,
      oplogDeps,
      actor,
      branchSettled,
    ],
  );

  // activeSheetId が変わったら branches を fetch
  const trunkFileId = activeFile?.id;
  useEffect(() => {
    if (!activeSheetId) return;
    // branch メタは trunk 単位で保存されているのでシートで絞る。ファイル未選択の間は
    // 空一覧を入れる (前のファイルの branch を出したままにしない)。
    const load = trunkFileId
      ? oplogDeps
          .fetchBranches(trunkFileId as FileId)
          .then((bs) => bs.filter((b) => b.sheetId === activeSheetId))
      : Promise.resolve<BranchMeta[]>([]);
    load
      .then((bs) => {
        setSheetBranches((prev) => {
          const next = new Map(prev);
          next.set(activeSheetId, bs);
          return next;
        });
      })
      .catch((err) => {
        // op-log 経路は ATProto に依存しないので、ここが失敗するのは daemon 障害の
        // ときだけ。黙って古い一覧を出し続けないよう診断ログに残す
        // (W3d5-7 の「無言の失敗」の教訓)。
        console.warn('[branch] ブランチ一覧の取得に失敗しました:', err);
      });
  }, [activeSheetId, oplogDeps, trunkFileId]);

  return {
    activeBranch,
    sheetBranches,
    newCommitsSinceMerge,
    commitDialogOpen,
    setCommitDialogOpen,
    isTrunk,
    /**
     * 差分状態 (ANA-120)。画面のハイライト・commit・merge の可否はすべてこれで決まる。
     * merge できるのは `COMMITTED` のときだけ (未コミットの編集を残したまま merge させない)。
     */
    diffState,
    addedNodeIds,
    updatedNodeIds,
    addedEdgeIds,
    updatedEdgeIds,
    conflictedNodeIds: new Set([...addedNodeIds, ...updatedNodeIds]),
    conflictedEdgeIds: new Set([...addedEdgeIds, ...updatedEdgeIds]),
    deletedNodes: deletedNodes as GraphNode[],
    deletedEdges: deletedEdges as GraphEdge[],
    deletedNodeLayouts: deletedNodeLayouts as NodeLayout[],
    deletedEdgeLayouts: deletedEdgeLayouts as EdgeLayout[],
    pendingChanges,
    /**
     * branch 表示中の編集の宛先。trunk 表示中は null。
     * GraphEditor には trunk 用と使い分けて渡す — branch の編集を trunk の
     * op-log へ流さないための切替点。
     */
    branchSyncRecord: activeBranch ? branchSyncRecord : null,
    handleSelectBranch,
    handleCreateBranch,
    handleMergeBranch,
    handleCloseBranch,
    handleDeleteBranch,
    handleCommit,
    resetBranchState,
  };
}
