import type {
  Actor,
  Batch,
  BatchId,
  BranchMeta,
  Commit,
  CommitId,
  DtrId,
  EdgeLayout,
  FileId,
  GraphEdge,
  GraphFile,
  GraphNode,
  MergeConflict,
  NodeLayout,
  Sheet,
  SheetId,
} from '@conversensus/shared';
import {
  BRANCH_STATUS,
  didFromActor,
  makeCommit,
  requiresConfirmation,
} from '@conversensus/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api';
import { TRUNK_PREFIX } from '../atproto';
import { putJudgment } from '../atproto/judgmentStore';
import type { RemoteSyncQueue } from '../atproto/remoteSyncQueue';
import { type GraphEvent, makeEventBase } from '../events/GraphEvent';
import { appendJudgment } from '../sync/appendJudgment';
import { branchMetaRecorder, readBranchMeta } from '../sync/branchMetaLog';
import {
  type BranchProjectionDeps,
  createBranchOnOplog,
  readBranchSheets,
} from '../sync/branchProjection';
import { computeSheetChanges } from '../sync/computeOperations';
import {
  countCommitsAfter,
  lastMergeSourceAt,
  mergeBranchOnOplog,
  previewMerge,
} from '../sync/mergeBranch';
import { migrateBranchMeta } from '../sync/migrateBranchMeta';
import type { RosterSource } from '../sync/rosterSource';
import { startDtrForConflicts } from '../sync/startDtr';
import type { SyncProvider } from '../sync/syncProvider';
import {
  type ReceivedSummary,
  type TapClock,
  type TapHandle,
  useEventSyncTap,
} from './useEventSyncTap';

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

/** 対立を「content 1 件 / structure 2 件」の形で言い表す。確認とログで同じ言葉を使う */
function describeConflicts(conflicts: readonly MergeConflict[]): string {
  const byCategory = new Map<string, number>();
  for (const c of conflicts) {
    byCategory.set(c.category, (byCategory.get(c.category) ?? 0) + 1);
  }
  return [...byCategory]
    .map(([category, count]) => `${category} ${count} 件`)
    .join(' / ');
}

export type ConfirmState = {
  message: string;
  resolve: (ok: boolean) => void;
};

export type InputState = {
  message: string;
  resolve: (value: string) => void;
};

/**
 * 画面に出す競合の通知 (Phase 3 T4)。
 *
 * **名前を一緒に運ぶ。**削除依存の対象はまさに消された要素なので、いま開いているシートから
 * 名前を引けない。分岐点での名前を merge の結果が持っているので、それをそのまま渡す。
 */
export type ConflictNoticeState = {
  conflicts: MergeConflict[];
  /** 対象 id → 分岐点での名前。引けなかった対象は入らない */
  labels: Map<string, string>;
  /**
   * 保留の記録 (fork) として書かれた件数 (Phase 3 T6)。
   * **explicit merge では 0** — 人が押した merge は保留ではなく取り込みである
   */
  forkCount?: number;
};

export type AlertState = {
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
  /**
   * content の競合から DtR を起動する (step2 Phase 6 D1)。
   *
   * **起動するかどうかの判断は向こう側にある。**ここは呼ぶだけで、競合の種別で
   * 絞らない — 線引き (`needsForcedStart`) を呼び出し側にも置くと、同じ規則が
   * 2 箇所に分かれて「放っておくとずれる」(T0 で踏んだ形である)
   */
  startDtrForConflicts: typeof startDtrForConflicts;
}

export const defaultBranchOpsDeps: BranchOpsDeps = {
  computeSheetChanges,
  startDtrForConflicts,
};

/**
 * op-log 経路の I/O (step1 Phase 5 p5-4)。すべてローカルデーモン向け。
 *
 * **branch / commit のメタはここに無い** (step2 Phase 3 T7-1)。以前は daemon の SQLite の
 * 行 (`saveBranch` / `fetchBranches` / `saveCommit` / `fetchCommits` / `deleteBranch`) で、
 * 相手に届かなかった。いまは trunk の tap (`trunkRecord`) で op-log に記録し、trunk を
 * 畳み込んで読む。
 */
export interface BranchOplogDeps {
  /** file_id の op-log を取得する (trunk / branch とも同じ口) */
  fetchBatches: (fileId: FileId) => Promise<Batch[]>;
  appendBatches: (fileId: FileId, batches: Batch[]) => Promise<number>;
  /** id を採番する (branch id / コミット id / branch 専用 file_id) */
  newId: () => string;
  /** branch 編集の書き込み先 provider (テスト差し替え用。既定はローカルデーモン) */
  createBranchProvider?: (fileId: FileId) => SyncProvider;
  /**
   * branch の受信の書き込み口 (テスト差し替え用, T7-3)。既定は `api.pushReceivedBatches`。
   * **安定参照であること** (tap の受信 effect が張り直される)
   */
  appendReceived?: (fileId: FileId, batches: Batch[]) => Promise<number>;
  /**
   * SQLite に残る branch 行を読む (step2 Phase 3 T7-6 の載せ直し専用)。
   * 省略すると載せ直しを行わない
   */
  fetchLegacyBranches?: (trunkFileId: FileId) => Promise<BranchMeta[]>;
  /** SQLite に残る commit 行を読む (T7-6 の載せ直し専用) */
  fetchLegacyCommits?: (fileId: FileId) => Promise<Commit[]>;
}

export const defaultBranchOplogDeps: BranchOplogDeps = {
  fetchBatches: (fileId) => api.fetchBatches(fileId),
  appendBatches: api.pushBatches,
  newId: () => crypto.randomUUID(),
  fetchLegacyBranches: api.fetchBranches,
  fetchLegacyCommits: api.fetchCommits,
};

/** `trunkSettled` の既定。**モジュール定数にする** — 毎レンダー作ると effect が張り直される */
const resolvedSettled = () => Promise.resolve();

interface UseBranchOperationsParams {
  activeFile: GraphFile | null;
  activeSheetId: SheetId | null;
  activeSheet: Sheet | null;
  onSetActiveFile: (file: GraphFile | null) => void;
  setConfirmState: (s: ConfirmState | null) => void;
  setInputState: (s: InputState | null) => void;
  setAlertState: (s: AlertState | null) => void;
  /**
   * merge で検出した競合を画面に届ける (Phase 3 T4)。**`console.warn` は人に届かない。**
   * 空配列を渡したら通知は閉じる
   */
  setConflictNotice: (notice: ConflictNoticeState) => void;
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
  /**
   * trunk の tap の `record`。branch / commit のメタをここから op-log に記録する
   * (step2 Phase 3 T7-1)。**既定値を持たせない** — no-op に落とすと branch を作っても
   * どこにも残らない。**安定参照であること** (記録口を作り直すと依存する callback が張り直される)
   */
  trunkRecord: (event: GraphEvent) => void;
  /**
   * remote 送信キュー (step2 Phase 3 T7-2)。渡すと branch 上の編集も remote へ出る。
   * null なら local-only (未ログイン時)。trunk の tap に渡すものと同じキューであること
   */
  remoteQueue?: RemoteSyncQueue | null;
  /**
   * 名簿の供給元 (step2 Phase 3 T7-3)。渡すと参加者の branch の編集を引く。
   * branch は名簿を持たないので、trunk の名簿で読む相手と期間を決める
   */
  roster?: RosterSource | null;
  /**
   * trunk の受信で画面が差し替わった回数 (step2 Phase 3 T7-3)。変わったら branch 一覧を
   * 読み直す — 相手が作った branch のメタは trunk の受信で届くので、これが無いと
   * シートを切り替えるまで一覧に出ない
   */
  receiveEpoch?: number;
  /**
   * trunk の tap の drain 完了を待つ (step2 Phase 3 T7-6)。SQLite から載せ直したメタを
   * 一覧に読む前に待つ。省略すると待たない (記録が同期的なテスト用)
   */
  trunkSettled?: () => Promise<void>;
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
  setConflictNotice,
  actor,
  trunkClock,
  trunkRecord,
  remoteQueue = null,
  roster = null,
  receiveEpoch = 0,
  trunkSettled = resolvedSettled,
  deps = defaultBranchOpsDeps,
  oplogDeps = defaultBranchOplogDeps,
}: UseBranchOperationsParams) {
  // branch / commit のメタの書き込み口 (T7-1)。読み取りは `readBranchMeta` で trunk を畳む
  const branchMeta = useMemo(
    () => branchMetaRecorder(trunkRecord),
    [trunkRecord],
  );
  const projectionDeps = useMemo<BranchProjectionDeps>(
    () => ({
      fetchBatches: oplogDeps.fetchBatches,
      newId: oplogDeps.newId,
      recordBranchCreated: branchMeta.branchCreated,
    }),
    [oplogDeps, branchMeta],
  );

  const [activeBranch, setActiveBranch] = useState<BranchMeta | null>(null);
  const [sheetBranches, setSheetBranches] = useState<Map<string, BranchMeta[]>>(
    new Map(),
  );
  const [newCommitsSinceMerge, setNewCommitsSinceMerge] = useState(0);
  /**
   * 受信で開いている branch を組み直した回数 (step2 Phase 3 T7-3 の修正, T7-7 実機で発覚)。
   *
   * **state を差し替えるだけでは canvas に出ない。**GraphEditor が React Flow を再 seed する
   * 契機は file.id / シート / `receiveEpoch` の変化だけで、組み直しはどれも変えない。
   * trunk の受信 (`fileOps.receiveEpoch`) と同じ役目なので、App が足し合わせて渡す
   */
  const [branchReceiveEpoch, setBranchReceiveEpoch] = useState(0);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);

  const [lastCommitBase, setLastCommitBase] = useState<Sheet | null>(null);
  const [branchOriginalBase, setBranchOriginalBase] = useState<Sheet | null>(
    null,
  );
  const preBranchFile = useRef<GraphFile | null>(null);

  const isTrunk = !activeBranch || activeBranch.name === TRUNK_PREFIX;

  // branch を開いている間だけ、編集の宛先を branch 専用 op-log にする。
  // **これが載せ替えの要**: 旧経路では branch 中の編集も trunk の tap に流れていたため、
  // branch の編集が trunk の op-log を汚していた (W3d で branch を凍結した際の積み残し)。
  // 受信で branch の中身を組み直す口 (T7-3)。組み直しは下で定義する `selectBranchFromOplog`
  // を使うので ref で後から繋ぐ — tap に渡す callback は安定参照でなければならない
  const reselectOnReceiveRef = useRef<() => void>(() => {});
  const handleBranchReceived = useCallback(
    (_fileId: FileId, _result: ReceivedSummary, tap: TapHandle) => {
      void tap.settled().then(() => {
        // 未 flush の編集が残っているうちは組み直さない (画面の編集を失わないため。
        // trunk の `reprojectAfterReceive` と同じ判断)。次の受信契機が拾う
        if (tap.pending() === 0) reselectOnReceiveRef.current();
      });
    },
    [],
  );

  const { record: branchSyncRecord, settled: branchSettled } = useEventSyncTap(
    activeBranch?.branchFileId ?? null,
    {
      actor,
      // 分岐点の後から発番する。空の branch op-log は clock 1 から始まってしまい、
      // それでは base 時点の trunk batch に LWW で負ける (§p5-4)。
      ...(activeBranch && { clockFloor: activeBranch.base.at }),
      // branch の編集も remote へ出す (step2 Phase 3 T7-2)。step1 §9.2 の「branch batch は
      // local 専用」はここで外れる。別の端末・相手が branch の中身を読むための前提である。
      // 名簿 (roster) は渡さない — 参加者の branch を引くのは T7-3 で、trunk の名簿を借りる
      remoteQueue,
      // 参加者の branch の編集を引く (T7-3)。読む相手と期間は trunk の名簿が決める
      roster,
      ...(activeBranch && { trunkFileId: activeBranch.trunkFileId }),
      onReceived: handleBranchReceived,
      ...(oplogDeps.appendReceived && {
        appendReceived: oplogDeps.appendReceived,
      }),
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

  /**
   * branch を開いている間に受信した trunk を、戻ったときに見せるために控え直す
   * (T7-7 の実機で発覚した欠陥, 2026-09-17)。
   *
   * 戻り先は「branch へ入る前の trunk の写し」なので、受信した分を入れ直さないと
   * **閉じた瞬間に古い trunk が出る**。branch を開いていないときは何もしない
   * (写しが無いので、trunk の表示は受信の差し替えがそのまま担う)。
   */
  const keepTrunkForReturn = useCallback((file: GraphFile) => {
    if (preBranchFile.current) preBranchFile.current = file;
  }, []);

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
      // merge 済み branch を再オープンしたときの起点は **trunk の merge コミット**から
      // 導く (ANA-119 S6)。以前はセッション内の ref に頼っていたので、アプリを開き直すと
      // merge 済みの内容まで差分に出ていた。
      // コミットは branch のものも trunk のものも trunk の op-log にある (T7-1)
      const { trunkCommits, branchCommits } = await readBranchMeta(
        oplogDeps.fetchBatches,
        meta.trunkFileId,
      );
      const commits = branchCommits.get(meta.id) ?? [];
      const lastCommit = commits[commits.length - 1];
      const lastMergeAt = lastMergeSourceAt(trunkCommits, meta.id);
      const { current, atLastCommit, atLastMerge } = await readBranchSheets(
        meta,
        { id: sheetMeta.id, name: sheetMeta.name },
        projectionDeps,
        {
          ...(lastCommit && { lastCommitAt: lastCommit.at }),
          ...(lastMergeAt !== undefined && { lastMergeAt }),
        },
      );

      // trunk からブランチに入る時のみ trunk の状態を保存
      if (!activeBranch || activeBranch.name === TRUNK_PREFIX) {
        preBranchFile.current = activeFile;
      }

      // 旧経路と違い、どの時点の控えも持たずログから導出する。
      // merge 対象の起点は「最後の merge 時点」— 未 merge なら分岐点と同じ値になるので
      // 状態による場合分けが要らない
      setBranchOriginalBase(atLastMerge);
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
      setNewCommitsSinceMerge(countCommitsAfter(commits, lastMergeAt));
      setActiveBranch(meta);
    },
    [activeFile, activeBranch, onSetActiveFile, oplogDeps, projectionDeps],
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

  // 受信した branch の編集を画面に出す (T7-3)。開いている branch を op-log から組み直す。
  // 失敗しても画面は受信前のまま残るだけなので、ダイアログは出さず診断ログに留める
  reselectOnReceiveRef.current = () => {
    if (!activeBranch || activeBranch.name === TRUNK_PREFIX) return;
    selectBranchFromOplog(activeBranch.sheetId, activeBranch)
      // 組み直した state を canvas に出す (GraphEditor の再 seed の契機)
      .then(() => setBranchReceiveEpoch((epoch) => epoch + 1))
      .catch((err) =>
        console.warn('[branch] reprojection after receive failed:', err),
      );
  };

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
          projectionDeps,
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
    [activeFile, setInputState, setAlertState, projectionDeps, actor],
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
      // merge した時点 = branch op-log の先端 = いま画面に出ている内容。
      // 再オープン時は同じ値を trunk の merge コミット (`sourceAt`) から導き直す (S6)
      setBranchOriginalBase(activeSheet ?? null);
      setLastCommitBase(activeSheet ?? null);
      setNewCommitsSinceMerge(0);
    },
    [activeFile, activeSheet],
  );

  /**
   * content の競合から DtR を起動する (step2 Phase 6 D1)。
   *
   * **merge を適用した後に呼ぶ。**仕様は DtR を「この競合を引き起こした merge 操作
   * (op-log) に」紐づけると定めており、材料も先読みではなく**適用した結果**を使う。
   *
   * **未ログインでは起動できない。**判断ログの書き先は自分の repo なので、PDS が
   * 無ければ書きようがない。**黙って飛ばさない** — 競合そのものは起きているので、
   * 起動できなかったことは警告に出す (無言の見送りを作らない, Phase 2 の教訓)。
   */
  const startDtr = useCallback(
    async (branch: BranchMeta, conflicts: readonly MergeConflict[]) => {
      if (!roster) {
        if (conflicts.some((c) => c.category === 'content'))
          console.warn(
            '[dtr] 未ログインのため DtR を起動できない (競合は LWW で確定済み)',
          );
        return;
      }
      const trunkFileId = branch.trunkFileId;
      // 名簿は**既定値を供給するだけ**である。同じ読みで clock の seed に要る判断ログ
      // (`batches`) も受け取る — 取り直すと二重に読むうえ、その間に増えた分とずれる
      const { participation, batches } = await roster.read(trunkFileId);
      await deps.startDtrForConflicts(
        {
          trunkFileId,
          conflicts,
          branchId: branch.id,
          branchName: branch.name,
          participants: participation.participating,
          viewer: didFromActor(actor),
        },
        {
          // 器は trunk の op-log へ。branch / commit のメタと同じ tap の `record` を通す
          recordSheetCreated: (sheetId, name) =>
            trunkRecord({
              ...makeEventBase('file'),
              type: 'SHEET_CREATED',
              sheetId,
              name,
            }),
          appendJudgment: (fileId, ops) =>
            appendJudgment(
              {
                // merge 先の trunk は必ず開いているので tap の clock を使ってよい
                clock: trunkClock,
                actor,
                putJudgment,
                newBatchId: () => crypto.randomUUID() as BatchId,
              },
              fileId,
              ops,
              batches,
            ),
          // **`oplogDeps.newId` を使わない。**判断ログもシートの作成も API 境界で
          // uuid を要求するが、あちらは連番を返す実装がありうる (テストの偽物がそう)
          newSheetId: () => crypto.randomUUID() as SheetId,
          newDtrId: () => crypto.randomUUID() as DtrId,
        },
      );
    },
    [roster, deps, actor, trunkRecord, trunkClock],
  );

  const handleMergeBranch = useCallback(
    async (branch: BranchMeta) => {
      if (!activeSheetId || !activeFile) return;
      try {
        // 🔴 直前の編集が branch op-log に着地するのを待つ。待たないと、その編集が
        // trunk に載らないまま branch だけ MERGED になる (record は非同期に flush する)。
        // **先読みより前に置く** — 未着地の編集は対立の検出からも漏れる。
        await branchSettled();

        // 適用の前に何が起きるかを見せる (Phase 3 T1)。merge は不可逆なので、
        // 人の判断が要る対立 (content / structure) があれば取り込む前に問う。
        // layout は「通知のみで DtR を起動しない」種別なので止めない。
        const preview = await previewMerge(branch, {
          fetchBatches: oplogDeps.fetchBatches,
        });
        const blocking = preview.conflicts.filter(requiresConfirmation);
        if (blocking.length > 0) {
          const proceed = await new Promise<boolean>((resolve) => {
            setConfirmState({
              message: `branch "${branch.name}" の取り込みで ${describeConflicts(blocking)} を検出しました。取り込むと trunk に載り、取り消せません。続けますか?`,
              resolve,
            });
          });
          if (!proceed) return;
        }

        // merge 理由は commit と同様に**必須** (ANA-122)。対立が無ければ理由の入力が
        // 唯一の確認になる — 見せるものが無いのに二段構えにしても得るものが無い。
        const message = await new Promise<string>((resolve) => {
          setInputState({
            message: `branch "${branch.name}" を trunk に merge します。理由を入力してください:`,
            resolve,
          });
        });
        if (!message.trim()) return;

        // branch batches を trunk 先端の後へ再スタンプして trunk op-log へ追記する。
        // 再スタンプの発番は trunk の tap と同じ clock で行う (同 clock の衝突回避)。
        const result = await mergeBranchOnOplog(
          branch,
          { message: message.trim(), actor },
          {
            fetchBatches: oplogDeps.fetchBatches,
            appendBatches: oplogDeps.appendBatches,
            recordStatus: branchMeta.statusChanged,
            // merge は trunk のコミットなので branchId を付けない
            recordCommit: (commit) => branchMeta.commitAdded(commit),
            newId: oplogDeps.newId,
            seedClock: trunkClock.seed,
            tick: trunkClock.tick,
          },
        );
        // 収束は LWW で確定させ、対立は**画面に届ける** (Phase 3 T4)。
        // **通知に出すのは確認で見せた先読みではなく、実際に適用した結果である** —
        // 先読みと適用の間に trunk が動けば件数は食い違いうる。
        setConflictNotice({
          conflicts: result.conflicts,
          labels: result.conflictLabels,
        });
        if (result.conflicts.length > 0) {
          console.warn(
            `[branch] merge: ${describeConflicts(result.conflicts)} を LWW で確定`,
            result.conflicts,
          );
        }
        // content の競合は DtR を強制起動する (step2 Phase 6 D1)。
        // **ここで投げても merge は成功している。**同じ try に入れると
        // 「merge に失敗しました」と嘘を報告し、trunk に載った変更を人が探しに行く
        try {
          await startDtr(branch, result.conflicts);
        } catch (err) {
          console.warn('[dtr] 起動に失敗した:', err);
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
      setInputState,
      setConfirmState,
      setAlertState,
      setConflictNotice,
      oplogDeps,
      branchMeta,
      trunkClock,
      actor,
      afterMerge,
      branchSettled,
      startDtr,
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
        branchMeta.statusChanged(branch.id, BRANCH_STATUS.CLOSED);
        const closedBranch: BranchMeta = {
          ...branch,
          status: BRANCH_STATUS.CLOSED,
        };
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
    [setConfirmState, setAlertState, branchMeta, clearActiveBranch],
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
        // `branch.remove` を trunk に記録する。一度消したら戻らない (設計 決定 7)。
        // branch 専用 op-log の行はローカルに残る — 以前の server 側 1 tx の削除は
        // SQLite のメタ行から branch file_id を引いていたので、メタを op-log に移すと効かない
        branchMeta.removed(branch.id);
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
    [setConfirmState, setAlertState, branchMeta, clearActiveBranch],
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
        branchMeta.commitAdded(commit, activeBranch.id);

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
      branchMeta,
      actor,
      branchSettled,
    ],
  );

  // activeSheetId が変わったら branches を fetch。trunk の受信 (`receiveEpoch`) でも読み直す —
  // 相手の branch のメタは trunk の受信で届く (T7-3)
  const trunkFileId = activeFile?.id;
  /**
   * SQLite の branch / commit を載せ直した trunk (step2 Phase 3 T7-6)。**セッション内で
   * File ごとに 1 回**にする — 一覧は受信のたびに読み直すので、毎回 SQLite を読みに行かない。
   * 載せ直し自体はべき等なので、再起動で再び走っても op-log は汚れない
   */
  const migratedTrunksRef = useRef(new Set<FileId>());
  const migrateLegacyMeta = useCallback(
    async (id: FileId) => {
      const { fetchLegacyBranches, fetchLegacyCommits } = oplogDeps;
      if (!fetchLegacyBranches || !fetchLegacyCommits) return;
      if (migratedTrunksRef.current.has(id)) return;
      migratedTrunksRef.current.add(id);
      try {
        const result = await migrateBranchMeta(id, {
          fetchBatches: oplogDeps.fetchBatches,
          fetchLegacyBranches,
          fetchLegacyCommits,
          recorder: branchMeta,
        });
        if (result.branches.length === 0 && result.commits === 0) return;
        // 1 回きりの手続きなので記録が残る形で出す (無言にしない)
        console.info(
          `[branch] SQLite から ${result.branches.length} 個の branch と ` +
            `${result.commits} 件の commit を op-log へ載せ直しました`,
        );
        // 記録は非同期に flush するので、一覧を読む前に待つ
        await trunkSettled();
        // 移した branch の中身も remote へ出す (T7-2 の送信は branch を開いたときにしか
        // 走らないので、開かれない古い branch は相手に届かない)。一覧の表示は待たない
        if (remoteQueue) {
          for (const meta of result.branches) {
            void oplogDeps
              .fetchBatches(meta.branchFileId)
              .then((batches) =>
                remoteQueue.catchUp(batches, meta.branchFileId),
              )
              .catch((err) =>
                console.warn('[branch] 載せ直した branch の送信に失敗:', err),
              );
          }
        }
      } catch (err) {
        // 失敗したら次の契機で再試行する (何も書かずに投げる契約なので半端は残らない)
        migratedTrunksRef.current.delete(id);
        console.warn('[branch] SQLite からの載せ直しに失敗しました:', err);
      }
    },
    [oplogDeps, branchMeta, trunkSettled, remoteQueue],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: receiveEpoch は読み直しの契機としてだけ使う
  useEffect(() => {
    if (!activeSheetId) return;
    // branch メタは trunk の op-log にあるので畳んでシートで絞る (T7-1)。ファイル未選択の
    // 間は空一覧を入れる (前のファイルの branch を出したままにしない)。
    // **先に SQLite の古いメタを載せ直す** (T7-6)。載せ直さないと T7-1 以前の branch が出ない
    const load = trunkFileId
      ? migrateLegacyMeta(trunkFileId as FileId)
          .then(() =>
            readBranchMeta(oplogDeps.fetchBatches, trunkFileId as FileId),
          )
          .then(({ branches }) =>
            [...branches.values()].filter((b) => b.sheetId === activeSheetId),
          )
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
  }, [activeSheetId, oplogDeps, trunkFileId, receiveEpoch, migrateLegacyMeta]);

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
    /**
     * 受信で開いている branch を組み直した回数 (T7-3)。App は trunk の `receiveEpoch` と
     * 足して GraphEditor に渡す — どちらが進んでも canvas を再 seed する
     */
    branchReceiveEpoch,
    /**
     * branch を開いている間に受信した trunk の控え先 (2026-09-17)。
     * App が `useFileSheetOperations` へ渡す
     */
    keepTrunkForReturn,
    handleSelectBranch,
    handleCreateBranch,
    handleMergeBranch,
    handleCloseBranch,
    handleDeleteBranch,
    handleCommit,
    resetBranchState,
  };
}
