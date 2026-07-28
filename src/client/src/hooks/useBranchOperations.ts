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
import { makeCommit } from '@conversensus/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api';
import {
  BRANCH_STATUS,
  type Branch,
  computeOperations,
  createBranch,
  createCommit,
  createMergeRecord,
  deleteBranchWithRecords,
  fetchBranchesForSheet,
  fetchBranchSheetFromPds,
  fetchCommitsForBranch,
  mergeBranchToTrunk,
  sheets,
  syncBranchSheetToAtproto,
  syncFileToAtproto,
  TRUNK_PREFIX,
  updateBranchStatus,
} from '../atproto';
import { BRANCH_FROM_OPLOG } from '../config';
import {
  type BranchProjectionDeps,
  createBranchOnOplog,
  readBranchSheets,
} from '../sync/branchProjection';
import { mergeBranchOnOplog } from '../sync/mergeBranch';
import type { SyncProvider } from '../sync/syncProvider';
import { type TapClock, useEventSyncTap } from './useEventSyncTap';

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
 * UI が扱うブランチ。**旧 PDS 経路の `Branch` と op-log の `BranchMeta` が同居する**
 * (step1 Phase 5 p5-4)。`BRANCH_FROM_OPLOG` でどちらが作られるかが決まるが、
 * Sidebar が触るのは `{id, name, status}` の共通部分だけなので UI は区別しない。
 */
export type AnyBranch = Branch | BranchMeta;

/**
 * op-log 側のブランチか。フラグではなく**構造で**判定する — フラグ切替の前後で
 * state に残った古い形のブランチを取り違えないため (`branchFileId` は op-log 専用)。
 */
export function isBranchMeta(branch: AnyBranch): branch is BranchMeta {
  return 'branchFileId' in branch;
}

/** 状態マップのキー。旧経路は uri、op-log は id で一意 */
const branchKey = (branch: AnyBranch): string =>
  isBranchMeta(branch) ? branch.id : branch.uri;

export interface BranchOpsDeps {
  computeOperations: typeof computeOperations;
  createBranch: typeof createBranch;
  createCommit: typeof createCommit;
  createMergeRecord: typeof createMergeRecord;
  deleteBranchWithRecords: typeof deleteBranchWithRecords;
  fetchBranchesForSheet: typeof fetchBranchesForSheet;
  fetchBranchSheetFromPds: typeof fetchBranchSheetFromPds;
  fetchCommitsForBranch: typeof fetchCommitsForBranch;
  mergeBranchToTrunk: typeof mergeBranchToTrunk;
  sheetsRef: (sheetId: string) => Promise<{ uri: string; cid: string }>;
  updateBranchStatus: typeof updateBranchStatus;
  syncFileToAtproto: typeof syncFileToAtproto;
  TRUNK_PREFIX: string;
}

export const defaultBranchOpsDeps: BranchOpsDeps = {
  computeOperations,
  createBranch,
  createCommit,
  createMergeRecord,
  deleteBranchWithRecords,
  fetchBranchesForSheet,
  fetchBranchSheetFromPds,
  fetchCommitsForBranch,
  mergeBranchToTrunk,
  sheetsRef: (sheetId) => sheets.ref(sheetId),
  updateBranchStatus,
  syncFileToAtproto,
  TRUNK_PREFIX,
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
  /** テスト・退行用の経路スイッチ。既定は `BRANCH_FROM_OPLOG` */
  branchFromOplog?: boolean;
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
  branchFromOplog = BRANCH_FROM_OPLOG,
}: UseBranchOperationsParams) {
  const [activeBranch, setActiveBranch] = useState<AnyBranch | null>(null);
  const [sheetBranches, setSheetBranches] = useState<Map<string, AnyBranch[]>>(
    new Map(),
  );
  const [newCommitsSinceMerge, setNewCommitsSinceMerge] = useState(0);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);

  const [lastCommitBase, setLastCommitBase] = useState<Sheet | null>(null);
  const [branchOriginalBase, setBranchOriginalBase] = useState<Sheet | null>(
    null,
  );
  const branchOriginalBaseMap = useRef<Map<string, Sheet>>(new Map());
  const lastCommitBaseMap = useRef<Map<string, Sheet>>(new Map());
  const preBranchFile = useRef<GraphFile | null>(null);
  const latestCommitRef = useRef<{ uri: string; cid: string } | null>(null);
  // merge 時にその時点の newCommitsSinceMerge を累積保存し、
  // 再エントリ時に cs.length - 累積値 で真の新規コミット数を計算する
  const mergedCommitCounts = useRef<Map<string, number>>(new Map());

  const isTrunk = !activeBranch || activeBranch.name === TRUNK_PREFIX;

  // op-log モードで branch を開いている間だけ、編集の宛先を branch 専用 op-log にする。
  // **これが載せ替えの要**: 旧経路では branch 中の編集も trunk の tap に流れていたため、
  // branch の編集が trunk の op-log を汚していた (W3d で branch を凍結した際の積み残し)。
  const activeMeta =
    branchFromOplog && activeBranch && isBranchMeta(activeBranch)
      ? activeBranch
      : null;
  const { record: branchSyncRecord } = useEventSyncTap(
    activeMeta?.branchFileId ?? null,
    {
      actor,
      // 分岐点の後から発番する。空の branch op-log は clock 1 から始まってしまい、
      // それでは base 時点の trunk batch に LWW で負ける (§p5-4)。
      ...(activeMeta && { clockFloor: activeMeta.base.at }),
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
    branchOriginalBaseMap.current.clear();
    lastCommitBaseMap.current.clear();
    mergedCommitCounts.current.clear();
    preBranchFile.current = null;
    latestCommitRef.current = null;
  }, [activeFile?.id]);

  const [addedNodeIds, updatedNodeIds, addedEdgeIds, updatedEdgeIds] =
    useMemo(() => {
      if (isTrunk || !branchOriginalBase || !activeSheet) {
        return [
          new Set<string>(),
          new Set<string>(),
          new Set<string>(),
          new Set<string>(),
        ] as const;
      }
      const ops = deps.computeOperations(branchOriginalBase, activeSheet);
      const addN = new Set<string>();
      const updN = new Set<string>();
      const addE = new Set<string>();
      const updE = new Set<string>();
      for (const op of ops) {
        if (op.op === 'node.add') addN.add(op.nodeId);
        else if (op.op === 'node.update') updN.add(op.nodeId);
        else if (op.op === 'edge.add') addE.add(op.edgeId);
        else if (op.op === 'edge.update') updE.add(op.edgeId);
        // remove は conflicted に含めない（ゴースト表示用に別途計算）
      }
      return [addN, updN, addE, updE] as const;
    }, [isTrunk, branchOriginalBase, activeSheet, deps]);

  // 削除予定のノード/エッジ（base に存在し current に存在しない）
  const [deletedNodes, deletedEdges, deletedNodeLayouts, deletedEdgeLayouts] =
    useMemo(() => {
      if (isTrunk || !branchOriginalBase || !activeSheet) {
        return [[], [], [], []] as const;
      }
      const ops = deps.computeOperations(branchOriginalBase, activeSheet);
      const removedNodeIds = new Set<string>();
      const removedEdgeIds = new Set<string>();
      for (const op of ops) {
        if (op.op === 'node.remove') removedNodeIds.add(op.nodeId);
        if (op.op === 'edge.remove') removedEdgeIds.add(op.edgeId);
      }
      return [
        branchOriginalBase.nodes.filter((n) => removedNodeIds.has(n.id)),
        branchOriginalBase.edges.filter((e) => removedEdgeIds.has(e.id)),
        (branchOriginalBase.layouts ?? []).filter((l) =>
          removedNodeIds.has(l.nodeId),
        ),
        (branchOriginalBase.edgeLayouts ?? []).filter((l) =>
          removedEdgeIds.has(l.edgeId),
        ),
      ] as const;
    }, [isTrunk, branchOriginalBase, activeSheet, deps]);

  /**
   * 未コミットの変更。**コミットの実体は「ログ上のラベル付きオフセット」だが、
   * 表示はあくまで正味の差分**にする (p5-4 の確定事項)。op-log の未コミット batch を
   * そのまま数えると、編集して undo した往復が「2 変更」に見えてしまうため。
   * 基準の `lastCommitBase` は op-log モードでは op-log から導出する。
   */
  const pendingOps = useMemo(() => {
    if (
      isTrunk ||
      !lastCommitBase ||
      !activeSheet ||
      (activeBranch?.status !== BRANCH_STATUS.OPEN &&
        activeBranch?.status !== BRANCH_STATUS.MERGED)
    )
      return [];
    return deps.computeOperations(lastCommitBase, activeSheet);
  }, [isTrunk, lastCommitBase, activeSheet, activeBranch?.status, deps]);

  const resetBranchState = useCallback(() => {
    setActiveBranch(null);
    setLastCommitBase(null);
    setBranchOriginalBase(null);
    setNewCommitsSinceMerge(0);
    if (preBranchFile.current) {
      onSetActiveFile(preBranchFile.current);
      preBranchFile.current = null;
    }
  }, [onSetActiveFile]);

  const setBranchBases = useCallback((sheet: Sheet) => {
    setBranchOriginalBase(sheet);
    setLastCommitBase(sheet);
  }, []);

  /** trunk へ戻る (両経路共通)。branch 側の内容は各経路の永続に既に書かれている */
  const backToTrunk = useCallback(
    (branch: AnyBranch | null) => {
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
    async (sheetId: SheetId, branch: AnyBranch | null) => {
      latestCommitRef.current = null;

      if (!branch || branch.name === TRUNK_PREFIX) {
        // 旧経路では trunk に戻る前に編集内容を PDS の branch レコードへ保存する
        // 必要があった。op-log 経路では branch tap が編集ごとに書いているので不要。
        if (
          !branchFromOplog &&
          activeBranch &&
          activeBranch.name !== TRUNK_PREFIX &&
          activeSheetId &&
          activeFile
        ) {
          const sheet = activeFile.sheets.find((s) => s.id === activeSheetId);
          if (sheet && !isBranchMeta(activeBranch)) {
            try {
              const sheetRef = await sheets.ref(activeSheetId);
              await syncBranchSheetToAtproto(sheet, sheetRef, activeBranch.id);
            } catch (err) {
              console.warn('[branch] pre-switch save failed:', err);
            }
          }
        }
        backToTrunk(branch);
        return;
      }

      try {
        if (isBranchMeta(branch)) {
          await selectBranchFromOplog(sheetId, branch);
          return;
        }
        const branchSheet = await deps.fetchBranchSheetFromPds(
          branch.id,
          sheetId,
        );
        const cs = await deps.fetchCommitsForBranch(branch.uri);

        // trunk からブランチに入る時のみ trunk の状態を保存
        if (!activeBranch || activeBranch.name === TRUNK_PREFIX) {
          preBranchFile.current = activeFile ?? null;
        }

        // branchOriginalBase: ブランチ作成時 (または前回マージ時) の trunk スナップショット
        const storedOriginal = branchOriginalBaseMap.current.get(branch.uri);
        const originalBase = storedOriginal ?? branchSheet;
        if (!storedOriginal) {
          branchOriginalBaseMap.current.set(branch.uri, originalBase);
        }
        setBranchOriginalBase(originalBase);
        if (
          branch.status === BRANCH_STATUS.OPEN ||
          branch.status === BRANCH_STATUS.MERGED
        ) {
          const storedLastBase = lastCommitBaseMap.current.get(branch.uri);
          if (storedLastBase) {
            setLastCommitBase(storedLastBase);
          } else {
            setLastCommitBase(originalBase);
            lastCommitBaseMap.current.set(branch.uri, originalBase);
          }
        } else {
          setLastCommitBase(null);
        }

        if (cs.length > 0) {
          const last = cs[cs.length - 1];
          latestCommitRef.current = { uri: last.uri, cid: last.cid };
        }

        if (activeFile) {
          onSetActiveFile({
            ...activeFile,
            sheets: activeFile.sheets.map((s) =>
              s.id === sheetId ? branchSheet : s,
            ),
          });
        }

        if (branch.status === BRANCH_STATUS.MERGED) {
          const mergedCount = mergedCommitCounts.current.get(branch.uri) ?? 0;
          setNewCommitsSinceMerge(Math.max(0, cs.length - mergedCount));
        } else {
          setNewCommitsSinceMerge(cs.length);
        }
        setActiveBranch(branch);
      } catch (err) {
        console.warn('[branch] select failed:', err);
      }
    },
    [
      activeFile,
      activeSheetId,
      onSetActiveFile,
      deps,
      activeBranch,
      backToTrunk,
      branchFromOplog,
      selectBranchFromOplog,
    ],
  );

  const handleCreateBranch = useCallback(
    async (sheetId: SheetId) => {
      const name = await new Promise<string>((resolve) => {
        setInputState({ message: 'branch 名を入力してください:', resolve });
      });
      if (!name?.trim()) return;
      try {
        const branch: AnyBranch = branchFromOplog
          ? await (async () => {
              if (!activeFile)
                throw new Error('アクティブなファイルがありません');
              // 複製は行わず、分岐点 (現在のログ先端) を指す base コミットだけを記録する
              return createBranchOnOplog(
                {
                  name: name.trim(),
                  sheetId,
                  trunkFileId: activeFile.id as FileId,
                  authorActor: actor,
                },
                oplogDeps,
              );
            })()
          : await (async () => {
              let sheetRef: { uri: string; cid: string };
              try {
                sheetRef = await deps.sheetsRef(sheetId);
              } catch {
                if (!activeFile)
                  throw new Error('アクティブなファイルがありません');
                await deps.syncFileToAtproto(activeFile);
                sheetRef = await deps.sheetsRef(sheetId);
              }
              return deps.createBranch(name.trim(), sheetId, sheetRef);
            })();
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
            message: branchFromOplog
              ? 'branch の作成に失敗しました。'
              : 'branch の作成に失敗しました。ATProto にログインしているか確認してください。',
            resolve,
          });
        });
      }
    },
    [
      activeFile,
      setInputState,
      setAlertState,
      deps,
      oplogDeps,
      branchFromOplog,
      actor,
    ],
  );

  /** merge 後の共通後始末 (どちらの経路でも状態遷移は同じ) */
  const afterMerge = useCallback(
    (sheetId: SheetId, merged: AnyBranch, mergedTrunk?: GraphFile) => {
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
      const key = branchKey(merged);
      mergedCommitCounts.current.set(
        key,
        (mergedCommitCounts.current.get(key) ?? 0) + newCommitsSinceMerge,
      );
      if (activeSheet) {
        branchOriginalBaseMap.current.set(key, activeSheet);
        lastCommitBaseMap.current.set(key, activeSheet);
      }
      setNewCommitsSinceMerge(0);
    },
    [activeFile, activeSheet, newCommitsSinceMerge],
  );

  const handleMergeBranch = useCallback(
    async (branch: AnyBranch) => {
      if (!activeSheetId || !activeFile) return;
      const ok = await new Promise<boolean>((resolve) => {
        setConfirmState({
          message: `branch "${branch.name}" を trunk に merge しますか？`,
          resolve,
        });
      });
      if (!ok) return;
      try {
        if (isBranchMeta(branch)) {
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
          return;
        }

        const sheetRef = await deps.sheetsRef(activeSheetId);
        const branchRef = { uri: branch.uri, cid: branch.cid };
        const latestCommit = latestCommitRef.current ?? undefined;

        await deps.mergeBranchToTrunk(branch, activeSheetId, sheetRef);
        await deps.createMergeRecord(branch, sheetRef, branchRef, latestCommit);
        const mergedBranch = await deps.updateBranchStatus(
          branch,
          BRANCH_STATUS.MERGED,
        );
        afterMerge(activeSheetId, mergedBranch);
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
      deps,
      oplogDeps,
      trunkClock,
      afterMerge,
    ],
  );

  /** close / delete でアクティブなブランチが失われたときの後始末 */
  const clearActiveBranch = useCallback(
    (branch: AnyBranch) => {
      if (activeBranch?.id !== branch.id) return;
      lastCommitBaseMap.current.delete(branchKey(activeBranch));
      backToTrunk(null);
    },
    [activeBranch, backToTrunk],
  );

  const handleCloseBranch = useCallback(
    async (branch: AnyBranch) => {
      const ok = await new Promise<boolean>((resolve) => {
        setConfirmState({
          message: `branch "${branch.name}" を close しますか？`,
          resolve,
        });
      });
      if (!ok) return;
      try {
        const closedBranch: AnyBranch = isBranchMeta(branch)
          ? await oplogDeps.saveBranch({
              ...branch,
              status: BRANCH_STATUS.CLOSED,
            })
          : await deps.updateBranchStatus(branch, BRANCH_STATUS.CLOSED);
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
    [setConfirmState, setAlertState, deps, oplogDeps, clearActiveBranch],
  );

  const handleDeleteBranch = useCallback(
    async (branch: AnyBranch) => {
      const ok = await new Promise<boolean>((resolve) => {
        setConfirmState({
          message: `branch "${branch.name}" を削除しますか？\nこの操作は取り消せません。`,
          resolve,
        });
      });
      if (!ok) return;
      try {
        if (isBranchMeta(branch)) {
          // メタと branch 専用 op-log をまとめて消す (server 側 1 tx)
          await oplogDeps.deleteBranch(branch.trunkFileId, branch.id);
        } else {
          await deps.deleteBranchWithRecords(branch);
        }
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
    [setConfirmState, setAlertState, deps, oplogDeps, clearActiveBranch],
  );

  const handleCommit = useCallback(
    async (message: string) => {
      if (!activeBranch || !activeSheetId || !activeSheet) return;
      if (pendingOps.length === 0) return;

      try {
        if (isBranchMeta(activeBranch)) {
          // コミット = ログ上のラベル付きオフセット。差分そのものは持たない
          // (`pendingOps` は表示用で、コミットに焼き込むのはログ位置だけ)。
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
        } else {
          const sheetRef = await deps.sheetsRef(activeSheetId);
          const branchRef = { uri: activeBranch.uri, cid: activeBranch.cid };
          const parentRef = latestCommitRef.current ?? undefined;

          const commit = await deps.createCommit(
            message,
            pendingOps,
            sheetRef,
            branchRef,
            parentRef,
          );
          latestCommitRef.current = { uri: commit.uri, cid: commit.cid };
        }

        setLastCommitBase(activeSheet);
        lastCommitBaseMap.current.set(branchKey(activeBranch), activeSheet);
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
      pendingOps,
      setAlertState,
      deps,
      oplogDeps,
      actor,
    ],
  );

  // activeSheetId が変わったら branches を fetch
  const trunkFileId = activeFile?.id;
  useEffect(() => {
    if (!activeSheetId) return;
    const load = branchFromOplog
      ? trunkFileId
        ? // op-log の branch メタは trunk 単位で保存されているのでシートで絞る
          oplogDeps
            .fetchBranches(trunkFileId as FileId)
            .then((bs) => bs.filter((b) => b.sheetId === activeSheetId))
        : Promise.resolve<AnyBranch[]>([])
      : deps.fetchBranchesForSheet(activeSheetId);
    load
      .then((bs: AnyBranch[]) => {
        setSheetBranches((prev) => {
          const next = new Map(prev);
          next.set(activeSheetId, bs);
          return next;
        });
      })
      .catch(() => {
        // ATProto 未ログイン時 / ファイル未オープン時はサイレントスキップ
      });
  }, [activeSheetId, deps, oplogDeps, branchFromOplog, trunkFileId]);

  return {
    activeBranch,
    sheetBranches,
    newCommitsSinceMerge,
    commitDialogOpen,
    setCommitDialogOpen,
    isTrunk,
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
    pendingOps,
    /**
     * branch 表示中の編集の宛先 (op-log モードのみ)。trunk 表示中は null。
     * GraphEditor には trunk 用と使い分けて渡す — branch の編集を trunk の
     * op-log へ流さないための切替点。
     */
    branchSyncRecord: activeMeta ? branchSyncRecord : null,
    handleSelectBranch,
    handleCreateBranch,
    handleMergeBranch,
    handleCloseBranch,
    handleDeleteBranch,
    handleCommit,
    resetBranchState,
    setBranchBases,
  };
}
