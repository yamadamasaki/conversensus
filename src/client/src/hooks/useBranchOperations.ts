import type {
  Actor,
  Batch,
  BranchMeta,
  CausalClock,
  CommitId,
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
  isFork,
  isUpTo,
  makeCommit,
  requiresConfirmation,
} from '@conversensus/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api';
import { TRUNK_PREFIX } from '../atproto';
import type { RemoteSyncQueue } from '../atproto/remoteSyncQueue';
import type { GraphEvent } from '../events/GraphEvent';
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
import type { RosterSource } from '../sync/rosterSource';
import type { SyncProvider } from '../sync/syncProvider';
import {
  type ReceivedSummary,
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
  /** 主のボタンの言葉。動詞で、何が起きるかを書く (visual language §6.2)。省くと「OK」 */
  confirmLabel?: string;
  /** 取り消せない破壊的な操作 */
  danger?: boolean;
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
  /**
   * どの File の競合か (step3 Phase 6 S6-1a)。閉じたときに既読を File ごとに書く。
   * 無ければ既読を書かない
   */
  fileId?: FileId;
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
}

export const defaultBranchOpsDeps: BranchOpsDeps = {
  computeSheetChanges,
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
}

export const defaultBranchOplogDeps: BranchOplogDeps = {
  fetchBatches: (fileId) => api.fetchBatches(fileId),
  appendBatches: api.pushBatches,
  newId: () => crypto.randomUUID(),
};

interface UseBranchOperationsParams {
  /** 開いている File (trunk の姿)。**branch の中身では差し替えない** (step3 Phase 3 S3-2) */
  activeFile: GraphFile | null;
  activeSheetId: SheetId | null;
  /** merge で進んだ trunk を画面の state に入れる */
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
   * trunk の因果の発番器 (step3 Phase 1)。**branch の tap と merge の写しはこれを共有する** —
   * trunk とその branch は同じ因果の範囲にあり、別々に振ると同じ点を 2 回使ってしまう。
   * File を開いていなければ null (その間 branch は開けず、merge もできない)
   */
  trunkCausal?: CausalClock | null;
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
   * explicit merge で人の判断が要る競合があったときに merger を開く (step3 Phase 5)。省略すると
   * 今までどおり確認を挟んで branch の勝ちで進める
   */
  onOpenMerger?: (branch: BranchMeta) => void;
  deps?: BranchOpsDeps;
  oplogDeps?: BranchOplogDeps;
}

export function useBranchOperations({
  activeFile,
  activeSheetId,
  onSetActiveFile,
  setConfirmState,
  setInputState,
  setAlertState,
  setConflictNotice,
  actor,
  trunkCausal = null,
  trunkRecord,
  remoteQueue = null,
  roster = null,
  receiveEpoch = 0,
  deps = defaultBranchOpsDeps,
  oplogDeps = defaultBranchOplogDeps,
  onOpenMerger,
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
  /**
   * 開いている branch のシート (step3 Phase 3 S3-2)。branch の projection で始まり、
   * 画面の編集 (`onBranchSheetChange`) で進む。
   *
   * 以前はこれを持たず、`activeFile` の当該シートを branch の中身で差し替えていた。
   * そのため trunk を退避して戻るときに復元し、受信した trunk を控え直し、シートを足す前に
   * trunk へ戻す、という後始末が要った (設計 F1)。branch の中身を別に持てば、どれも要らない
   */
  const [branchSheet, setBranchSheet] = useState<Sheet | null>(null);

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

  const {
    record: branchSyncRecord,
    settled: branchSettled,
    syncNow: syncBranchNow,
  } = useEventSyncTap(activeBranch?.branchFileId ?? null, {
    actor,
    // 分岐点の後から発番する。空の branch op-log は clock 1 から始まってしまい、
    // それでは base 時点の trunk batch に LWW で負ける (§p5-4)。
    ...(activeBranch && { clockFloor: activeBranch.base.at }),
    // 点は trunk と同じ連番から振る (trunkCausal の注)
    ...(trunkCausal && { causal: trunkCausal }),
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
  });

  // File が切り替わったらブランチ状態をリセット
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeFile?.id の変化をトリガーにする意図的な設計
  useEffect(() => {
    setActiveBranch(null);
    setLastCommitBase(null);
    setBranchOriginalBase(null);
    setNewCommitsSinceMerge(0);
    setBranchSheet(null);
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
      !branchSheet ||
      (activeBranch?.status !== BRANCH_STATUS.OPEN &&
        activeBranch?.status !== BRANCH_STATUS.MERGED)
    )
      return [];
    return deps.computeSheetChanges(lastCommitBase, branchSheet);
  }, [isTrunk, lastCommitBase, branchSheet, activeBranch?.status, deps]);

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
    if (!diffBase || !branchSheet) return [];
    return deps.computeSheetChanges(diffBase, branchSheet);
  }, [diffState, diffBase, branchSheet, pendingChanges, deps]);

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

  /** branch 状態を捨てて trunk へ戻る。trunk の姿は `activeFile` がそのまま持っている */
  const resetBranchState = useCallback(() => {
    setActiveBranch(null);
    setLastCommitBase(null);
    setBranchOriginalBase(null);
    setNewCommitsSinceMerge(0);
    setBranchSheet(null);
  }, []);

  /** trunk へ戻る。branch 側の内容は branch tap が既に op-log へ書いている */
  const backToTrunk = useCallback((branch: BranchMeta | null) => {
    setActiveBranch(branch);
    setLastCommitBase(null);
    setBranchOriginalBase(null);
    setNewCommitsSinceMerge(0);
    setBranchSheet(null);
  }, []);

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
      setBranchSheet(current);
      setNewCommitsSinceMerge(countCommitsAfter(commits, lastMergeAt));
      setActiveBranch(meta);
    },
    [activeFile, oplogDeps, projectionDeps],
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

  /**
   * 開いている branch を op-log から組み直して canvas に出す (受信と同じ経路)。merger の merge 後の
   * pane は branch の op-log に解決の編集を積むが、branch 自身の表示 (`branchSheet`) は動かさない。
   * merger から branch の表示に戻ったときに呼ぶ (step3 Phase 5 の実機で発覚)
   */
  const reloadBranch = useCallback(() => reselectOnReceiveRef.current(), []);

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
      // trunk の姿を merge 後へ進める (trunk へ戻ったときに merge 済みの内容が見える)。
      // 再 projection に失敗したときは、画面の branch の中身を trunk のシートに当てて近似する
      if (mergedTrunk) {
        onSetActiveFile(mergedTrunk);
      } else if (activeFile && branchSheet) {
        onSetActiveFile({
          ...activeFile,
          sheets: activeFile.sheets.map((s) =>
            s.id === sheetId ? branchSheet : s,
          ),
        });
      }
      setActiveBranch(merged);
      // merge した時点 = branch op-log の先端 = いま画面に出ている内容。
      // 再オープン時は同じ値を trunk の merge コミット (`sourceAt`) から導き直す (S6)
      setBranchOriginalBase(branchSheet);
      setLastCommitBase(branchSheet);
      setNewCommitsSinceMerge(0);
    },
    [activeFile, branchSheet, onSetActiveFile],
  );

  /**
   * branch を trunk へ merge する本体 (確認も理由の入力も挟まない)。explicit merge の確認の後と、
   * merger の merge ボタン (`mergeResolved`) が呼ぶ。
   *
   * `notify: false` は競合の通知を出さない — merger では人が競合を 1 件ずつ見て決めた後なので、
   * 「LWW で確定した」と知らせるのは事実に反する
   */
  const applyMerge = useCallback(
    async (branch: BranchMeta, message: string, { notify = true } = {}) => {
      if (!activeSheetId) return;
      // branch の batch を写して trunk op-log へ追記する。写しは merge した人自身の batch で、
      // 点は trunk の tap と同じ発番器で振る (step3 Phase 1 D2)
      if (!trunkCausal)
        throw new Error('merge: trunk の発番器が無い (File が開かれていない)');
      const result = await mergeBranchOnOplog(
        branch,
        { message: message, actor },
        {
          fetchBatches: oplogDeps.fetchBatches,
          appendBatches: oplogDeps.appendBatches,
          recordStatus: branchMeta.statusChanged,
          // merge は trunk のコミットなので branchId を付けない
          recordCommit: (commit) => branchMeta.commitAdded(commit),
          newId: oplogDeps.newId,
          causal: trunkCausal,
        },
      );
      // 収束は LWW で確定させ、対立は**画面に届ける** (Phase 3 T4)。
      // **通知に出すのは確認で見せた先読みではなく、実際に適用した結果である** —
      // 先読みと適用の間に trunk が動けば件数は食い違いうる。
      if (notify) {
        setConflictNotice({
          conflicts: result.conflicts,
          labels: result.conflictLabels,
          fileId: branch.trunkFileId,
        });
      }
      if (notify && result.conflicts.length > 0) {
        console.warn(
          `[branch] merge: ${describeConflicts(result.conflicts)} を LWW で確定`,
          result.conflicts,
        );
      }
      afterMerge(activeSheetId, result.branch, result.trunk);
    },
    [
      activeSheetId,
      trunkCausal,
      actor,
      oplogDeps,
      branchMeta,
      setConflictNotice,
      afterMerge,
    ],
  );

  /**
   * merger の merge ボタン (step3 Phase 5 Q3)。解決の編集 (branch に積んだもの) が未コミットなら、
   * 同じ message でコミットしてから merge する。
   *
   * **未コミットかは op-log で判る** — merger の画面は「trunk + branch」の姿を出していて、branch 自身の
   * 表示 (`branchSheet`) は動かないので、表示から数えた変更 (`pendingChanges`) は当てにならない
   */
  const mergeResolved = useCallback(
    async (branch: BranchMeta, message: string) => {
      try {
        await branchSettled();
        const branchBatches = await oplogDeps.fetchBatches(branch.branchFileId);
        const { branchCommits } = await readBranchMeta(
          oplogDeps.fetchBatches,
          branch.trunkFileId,
        );
        const last = branchCommits.get(branch.id)?.at(-1);
        const uncommitted = branchBatches.some(
          (b) => last === undefined || !isUpTo(last, b),
        );
        if (uncommitted) {
          branchMeta.commitAdded(
            makeCommit(
              oplogDeps.newId() as CommitId,
              message,
              actor,
              branchBatches,
            ),
            branch.id,
          );
        }
        await applyMerge(branch, message, { notify: false });
      } catch (err) {
        console.warn('[merger] merge failed:', err);
        await new Promise<void>((resolve) => {
          setAlertState({ message: 'merge に失敗しました。', resolve });
        });
      }
    },
    [branchSettled, oplogDeps, branchMeta, actor, applyMerge, setAlertState],
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
        // 人の判断が要る競合があれば merger を開く (step3 Phase 5)。開けない (口が無い) ときは
        // 今までどおり確認を挟む。fork (保留した競合) は中身が空なので計算し直しても競合は出ないが、
        // 保留したのは人の判断が要るからなので、やはり merger で決める (S5-3, Q8)
        if ((blocking.length > 0 || isFork(branch)) && onOpenMerger) {
          onOpenMerger(branch);
          return;
        }
        if (blocking.length > 0) {
          const proceed = await new Promise<boolean>((resolve) => {
            setConfirmState({
              message: `branch "${branch.name}" の取り込みで ${describeConflicts(blocking)} を検出しました。取り込むと trunk に載り、取り消せません。続けますか?`,
              resolve,
              confirmLabel: 'merge',
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

        await applyMerge(branch, message.trim());
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
      oplogDeps,
      branchSettled,
      onOpenMerger,
      applyMerge,
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
          confirmLabel: 'close',
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
          confirmLabel: '削除',
          danger: true,
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
      if (!activeBranch || !activeSheetId || !branchSheet) return;
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

        setLastCommitBase(branchSheet);
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
      branchSheet,
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
   * branch の一覧を trunk の op-log から読み直す。
   */
  const loadBranchList = useCallback(async () => {
    if (!activeSheetId) return;
    try {
      // branch メタは trunk の op-log にあるので畳んでシートで絞る (T7-1)。ファイル未選択の
      // 間は空一覧を入れる (前のファイルの branch を出したままにしない)
      const bs = trunkFileId
        ? await readBranchMeta(
            oplogDeps.fetchBatches,
            trunkFileId as FileId,
          ).then(({ branches }) =>
            [...branches.values()].filter((b) => b.sheetId === activeSheetId),
          )
        : [];
      setSheetBranches((prev) => {
        const next = new Map(prev);
        next.set(activeSheetId, bs);
        return next;
      });
    } catch (err) {
      // op-log 経路は ATProto に依存しないので、ここが失敗するのは daemon 障害の
      // ときだけ。黙って古い一覧を出し続けないよう診断ログに残す
      // (W3d5-7 の「無言の失敗」の教訓)。
      console.warn('[branch] ブランチ一覧の取得に失敗しました:', err);
    }
  }, [activeSheetId, oplogDeps, trunkFileId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: receiveEpoch は読み直しの契機としてだけ使う
  useEffect(() => {
    void loadBranchList();
  }, [loadBranchList, receiveEpoch]);

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
     * 開いている branch の受信を今すぐ行う。trunk 表示中は何もしない (tap が無い)。
     *
     * **「今すぐ同期」は trunk と branch の両方を引く** (App が束ねる)。以前は trunk の
     * `syncNow` だけが配線されていて、branch を開いたまま押しても相手の branch の編集は
     * 来ず、定期同期 (30 秒) を待つしかなかった (step3 Phase 0 の App 結合テストで発覚)
     */
    syncBranchNow,
    /**
     * 開いている branch のシート (step3 Phase 3 S3-2)。trunk 表示中は null。
     * 画面はこれを描き、編集は `onBranchSheetChange` で返す
     */
    branchSheet: activeBranch ? branchSheet : null,
    /** 画面で branch のシートを編集した (GraphEditor の `onSheetChange`) */
    onBranchSheetChange: setBranchSheet,
    handleSelectBranch,
    handleCreateBranch,
    handleMergeBranch,
    handleCloseBranch,
    handleDeleteBranch,
    handleCommit,
    mergeResolved,
    reloadBranch,
    resetBranchState,
  };
}
