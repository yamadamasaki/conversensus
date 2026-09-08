import {
  type Actor,
  type Batch,
  type BlobCid,
  type ConversensusFile,
  type Did,
  type FileId,
  type GraphFile,
  type GraphFileListItem,
  type Lamport,
  LOCAL_DID,
  type Participation,
  participationGenesisBatch,
  projectFile,
  type SheetId,
} from '@conversensus/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createFile,
  fetchBatches,
  fetchFiles,
  fetchLocalFileIds,
  pushReceivedBatches,
} from '../api';
import { FanoutSyncProvider } from '../atproto/fanoutSyncProvider';
import { listJudgmentFileIds, putJudgment } from '../atproto/judgmentStore';
import type { RemoteSyncQueue } from '../atproto/remoteSyncQueue';
import type { GraphEvent } from '../events/GraphEvent';
import { makeEventBase } from '../events/GraphEvent';
import { exportFile, importFile } from '../files/fileTransfer';
import { collectBlobOrigins } from '../images/blobOrigins';
import type { PopupTarget } from '../SettingsPopup';
import { didFromActor } from '../sync/actor';
import {
  bootstrapParticipation,
  hasParticipationBootstrapped,
  markParticipationBootstrapped,
} from '../sync/bootstrapParticipation';
import type { DetectedConflicts } from '../sync/conflicts';
import { discoverParticipatingFiles } from '../sync/discoverParticipatingFiles';
import { discoverRemoteFiles } from '../sync/discoverRemoteFiles';
import { deleteFileByTombstone } from '../sync/fileDeletion';
import { LocalServerSyncProvider } from '../sync/localServerSyncProvider';
import {
  hasRkeyMigrated,
  markRkeyMigrated,
  migrateRemoteRkey,
} from '../sync/migrateRemoteRkey';
import type { DetectedOverwrites } from '../sync/overwrites';
import { collectParticipantBatches } from '../sync/receiveParticipantBatches';
import { reprojectAfterReceive } from '../sync/reprojectAfterReceive';
import type { RosterSource } from '../sync/rosterSource';
import { type FileSharing, fileSharing } from '../sync/rosterView';
import { rejoinObligation } from '../sync/syncObligation';
import type { ConflictNoticeState } from './useBranchOperations';
import {
  type ReceivedSummary,
  type TapHandle,
  useEventSyncTap,
} from './useEventSyncTap';

export type ConfirmState = {
  message: string;
  resolve: (ok: boolean) => void;
};

export type AlertState = {
  message: string;
  resolve: () => void;
};

export interface FileSheetOpsDeps {
  createFile: typeof createFile;
  exportFile: typeof exportFile;
  fetchBatches: typeof fetchBatches;
  fetchFiles: typeof fetchFiles;
  importFile: typeof importFile;
  /** 受信 batch の書き込み口 (marker 経路, Phase 4e-2b の materialize 用) */
  pushReceivedBatches: typeof pushReceivedBatches;
  /** この端末が op-log を持つ file_id の全集合 (削除済みを含む, ANA-127) */
  fetchLocalFileIds: typeof fetchLocalFileIds;
  /**
   * ファイル削除 = op-log への tombstone 追記 (ANA-127)。
   *
   * **tap ではなくここを通る**理由は `sync/fileDeletion.ts` の冒頭にある —
   * tap は activeFile に束ねられているが、削除は開いていないファイルにも掛かる。
   * 宛先 provider (local / ログイン中は fanout) はフック側が組み立てて渡す。
   */
  deleteFile: typeof deleteFileByTombstone;
  /**
   * rkey 移行の marker (Phase 7 p7-4)。既定は localStorage (DID 単位)。
   *
   * **deps にしてあるのはテストのため** — 移行は「起動時に 1 回」なので、差し替えられないと
   * 他のテスト (発見・受信) の観測に移行の副作用が混ざり、何を検証しているのか分からなくなる。
   * in-memory deps は「移行済」を既定にして移行経路を止める。
   */
  hasRkeyMigrated: (did: string) => boolean;
  markRkeyMigrated: (did: string) => void;
}

export const defaultFileSheetOpsDeps: FileSheetOpsDeps = {
  createFile,
  exportFile,
  fetchBatches,
  fetchFiles,
  importFile,
  pushReceivedBatches,
  fetchLocalFileIds,
  deleteFile: deleteFileByTombstone,
  hasRkeyMigrated,
  markRkeyMigrated,
};

interface UseFileSheetOperationsParams {
  setConfirmState: (s: ConfirmState | null) => void;
  setAlertState: (s: AlertState | null) => void;
  /**
   * implicit merge で検出した競合を画面に届ける (step2 Phase 3 T5)。
   * **競合が 0 件のときは呼ばれない** — 定期サイクルが空で上書きすると、人が読んで
   * いる通知が消えるためである
   */
  setConflictNotice: (notice: ConflictNoticeState) => void;
  /**
   * 上書きの報告を画面へ渡す (step2 Phase 3 T8)。
   *
   * **競合と違って「溜める」ので、値ではなく更新関数を受け取る形にする** —
   * この報告は自動では出ない印なので、上書きすると人が見に行く前に消える。
   */
  onOverwrites: (detected: DetectedOverwrites) => void;
  deps?: FileSheetOpsDeps;
  /**
   * テスト用: op-log tap の record を差し替える。未指定なら内部 tap (LocalServerSyncProvider)。
   * content 経路 (GraphEditor) は sheetId を渡し、structure 経路 (以下のハンドラ) は渡さない (W3c2)。
   */
  syncRecord?: (event: GraphEvent, sheetId?: SheetId) => void;
  /**
   * W3d5 remote 送信キュー (§3.4)。ATProto ログイン中のみ非 null (`useRemoteSyncQueue`)。
   * null なら tap は local-only = W3d と完全に同じ挙動 (退行なし)。
   */
  remoteQueue?: RemoteSyncQueue | null;
  /** この端末の操作主体 `<did>#<deviceId>` (Phase 4d-2)。tap が batch の actor に使う */
  actor: Actor;
  /**
   * 名簿の供給元 (step2 Phase 2 S2)。**渡すと同期が他 actor の repo も読む**。
   * null なら自分の repo だけを見る step1 の挙動になる。
   */
  roster?: RosterSource | null;
  /**
   * 編集中 (ノードの inline editor / ドラッグ中) なら true を返す (Phase 4e-3, §3.3)。
   * 編集中の受信は activeFile 差し替えを保留し、次の受信契機で反映する。
   * **安定参照であること** (ref 経由を推奨)。未指定 = 常に編集中でない扱い。
   */
  isEditingActive?: () => boolean;
}

export function useFileSheetOperations({
  setConfirmState,
  setAlertState,
  setConflictNotice,
  onOverwrites,
  deps = defaultFileSheetOpsDeps,
  syncRecord: syncRecordOverride,
  remoteQueue = null,
  actor,
  roster = null,
  isEditingActive,
}: UseFileSheetOperationsParams) {
  const [files, setFiles] = useState<GraphFileListItem[]>([]);
  const [activeFile, setActiveFile] = useState<GraphFile | null>(null);
  const [activeSheetId, setActiveSheetId] = useState<SheetId | null>(null);
  const [expandedFileIds, setExpandedFileIds] = useState<Set<string>>(
    new Set(),
  );
  const [newFileName, setNewFileName] = useState('');
  const [popupTarget, setPopupTarget] = useState<PopupTarget | null>(null);

  const activeSheet = useMemo(
    () => activeFile?.sheets.find((s) => s.id === activeSheetId) ?? null,
    [activeFile, activeSheetId],
  );

  // handleReceived (安定参照) から最新の activeFile を読むための ref。
  // state を直接 dep に取ると受信 effect が activeFile 変化のたびに張り直される。
  const activeFileRef = useRef<GraphFile | null>(null);
  useEffect(() => {
    activeFileRef.current = activeFile;
  }, [activeFile]);

  // 受信 swap の世代番号 (Phase 4e-4 実機で発見)。GraphEditor は React Flow の内部
  // state を file.id / activeSheetId の変化でしかリセットしないため、同一ファイルの
  // activeFile 差し替え (受信 swap) は画面に反映されない。swap のたびに増える本値を
  // GraphEditor の reset effect の依存に加えて再 seed を発火させる。
  const [receiveEpoch, setReceiveEpoch] = useState(0);

  // 開いている File の共有状態 (step2 Phase 2, 2026-09-05 実機で発覚)。
  //
  // **取り消されても File は手元に残る** — ローカル正典は自分の写しなので消さない。
  // しかし止まるのは取り込みであって表示ではないので、何も出さないと
  // 「もう同期されない File」が普通の File に見える。同期サイクルが毎回名簿を読むので、
  // その結果を受け取るだけで済む (表示のために読み直すとリクエストが倍になる)。
  const [sharing, setSharing] = useState<{
    fileId: FileId;
    state: FileSharing;
  } | null>(null);
  /**
   * 画像 blob の由来 `cid → DID` (step2 Phase 2 S5)。**projection と同じ batch から
   * 導く**ので、projection を差し替える場所で必ず一緒に更新する。
   */
  const [blobOrigins, setBlobOrigins] = useState<Map<BlobCid, Did>>(new Map());
  /** cid から由来を引く。**Map ではなく関数を降ろす** (`blobOriginContext`) */
  const originOf = useCallback(
    (cid: BlobCid) => blobOrigins.get(cid),
    [blobOrigins],
  );
  /**
   * 果たしていない同期義務 (step2 Phase 2 S6)。**再参加した File を、同期が済むまで
   * 読み取り専用にする**ための状態である。
   */
  const [obligation, setObligation] = useState<{
    fileId: FileId;
    /** 最後に開いた参加期間の始点。**義務を果たしたかどうかの鍵** */
    since: Lamport;
  } | null>(null);
  /**
   * 果たし終えた義務 (File → その時の期間の始点)。
   *
   * **真偽値では足りない。**「一度同期した」だけを覚えると、その後もう一度離脱して
   * 再参加したときに義務が生まれない。期間の始点は再参加のたびに変わる
   */
  const dischargedRef = useRef(new Map<FileId, Lamport>());

  /**
   * implicit merge の競合を画面へ渡す (step2 Phase 3 T5)。
   *
   * explicit merge (`useBranchOperations`) と**同じ通知に載せる** — 人から見れば
   * どちらも「競合が起きた」であって、経路の違いは関心事ではない。
   */
  const handleConflicts = useCallback(
    (_fileId: FileId, detected: DetectedConflicts, forkCount: number) => {
      setConflictNotice({
        conflicts: detected.conflicts,
        labels: detected.labels,
        forkCount,
      });
    },
    [setConflictNotice],
  );

  /**
   * 上書きの報告を画面へ渡す (step2 Phase 3 T8)。
   *
   * **競合の通知には載せない。**「競合しました」と「あなたの書いたものが変わりました」は
   * 言い方も扱いも別である、というのが T8 の決着そのものである。
   */
  const handleOverwrites = useCallback(
    (_fileId: FileId, detected: DetectedOverwrites) => {
      onOverwrites(detected);
    },
    [onOverwrites],
  );

  const handleRoster = useCallback(
    (fileId: FileId, participation: Participation) => {
      const viewer = didFromActor(actor);
      setSharing({ fileId, state: fileSharing(participation, viewer) });

      const since = rejoinObligation(participation, viewer);
      setObligation(
        since !== null && dischargedRef.current.get(fileId) !== since
          ? { fileId, since }
          : null,
      );
    },
    [actor],
  );

  /**
   * 画面に出ている projection が含んでいた**他 actor の batch 数** (File ごと)。
   *
   * **「画面が古い」を測る物差し**である (#202)。自分の編集では増えないので、
   * 自分で描いている間に不要な差し替えが走らない。op-log は追記しかされないので
   * 単調に増え、増えていれば必ず画面に無いものが正典にある。
   */
  const projectedForeignRef = useRef(new Map<FileId, number>());
  const foreignCount = useCallback(
    (batches: readonly Batch[]) =>
      batches.filter((b) => b.actor !== actor).length,
    [actor],
  );

  // 受信着地後の画面反映 (Phase 4e-3, 4e 設計 §3.3)。tap のローカル drain を待ち、
  // pending が空のときだけ再 projection で activeFile を差し替える (未 flush 編集を
  // 失わない)。見送り (defer) は次の受信契機が拾う。
  /**
   * 差し替えが走っている File。
   *
   * **契機が 2 つある** (受信の着地 / 手元の正典が動いた) ので、同じサイクルで 2 回
   * 差し替えないための柵である。2 回走らせても結果は同じだが、`receiveEpoch` が
   * 2 つ進んで React Flow が二度 seed し直す (選択が落ちる)。
   */
  const swappingRef = useRef(new Set<FileId>());

  const swapProjection = useCallback(
    (fileId: FileId, tap: TapHandle) => {
      if (swappingRef.current.has(fileId)) return;
      swappingRef.current.add(fileId);
      reprojectAfterReceive({
        settled: tap.settled,
        pendingCount: tap.pending,
        loadProjection: async () => {
          // **受信後もここを通す。**他 actor が貼った画像は受信で初めて手元に来る
          // ので、由来を更新しないと「読み込んだときには無かった画像」が出ない
          const batches = await deps.fetchBatches(fileId);
          setBlobOrigins(collectBlobOrigins(batches));
          projectedForeignRef.current.set(fileId, foreignCount(batches));
          return projectFile(batches, fileId);
        },
        ...(isEditingActive && { isEditing: isEditingActive }),
      })
        .then((result) => {
          if (result.kind !== 'swap') {
            console.info(`[sync] reprojection deferred: ${result.reason}`);
            return;
          }
          // 受信対象のファイルを開いたままのときだけ差し替える (再 projection 中に
          // ファイルを切り替えていたら何もしない)
          if (activeFileRef.current?.id !== fileId) return;
          setActiveFile(result.file);
          // GraphEditor に React Flow の再 seed を伝える (同一 file.id の差し替えは
          // これが無いと画面に出ない — 4e-4 実機で発見)
          setReceiveEpoch((epoch) => epoch + 1);
          // 開いていたシートが受信で消えていたら先頭シートへ退避する
          setActiveSheetId((prev) =>
            prev !== null && result.file.sheets.some((s) => s.id === prev)
              ? prev
              : ((result.file.sheets[0]?.id ?? null) as SheetId | null),
          );
        })
        .catch((error) =>
          console.warn('[sync] reprojection after receive failed:', error),
        )
        .finally(() => swappingRef.current.delete(fileId));
    },
    [deps, isEditingActive, foreignCount],
  );

  const handleReceived = useCallback(
    (fileId: FileId, _result: ReceivedSummary, tap: TapHandle) =>
      swapProjection(fileId, tap),
    [swapProjection],
  );

  /**
   * 受信のサイクルが最後まで走った。
   *
   * 1. **同期義務を解く** (S6)。果たしたことを覚えてから外す
   * 2. **画面が古くないか見る** (#202)
   *
   * 2 が要るのは、`onReceived` が「**このブラウザがローカル正典に追記したとき**」しか
   * 鳴らないからである。同じデーモンを共有する別の窓が書いた分は**もう正典に入って
   * いる**ので追記が 0 になり、画面だけが古いまま残る (2 つのブラウザで同じ
   * `localhost:5173` を開いた構成。2026-09-06 実機で発覚)。
   *
   * **古いのはローカル正典ではなく画面である。**だから remote ではなく手元を見る。
   */
  const handleSynced = useCallback(
    (fileId: FileId, tap: TapHandle) => {
      setObligation((prev) => {
        if (!prev || prev.fileId !== fileId) return prev;
        dischargedRef.current.set(fileId, prev.since);
        return null;
      });

      if (activeFileRef.current?.id !== fileId) return;
      // 受信の着地が既に差し替えを始めていれば、ここで測る意味は無い
      if (swappingRef.current.has(fileId)) return;
      deps
        .fetchBatches(fileId)
        .then((batches) => {
          const seen = projectedForeignRef.current.get(fileId);
          // **知らない File は測らない。**開いた時点で必ず記録されるので、
          // 未記録は「開いていない」を意味する
          if (seen === undefined || foreignCount(batches) <= seen) return;
          console.info(
            `[sync] ${fileId}: 手元の正典に画面へ出ていない batch がある。差し替える`,
          );
          swapProjection(fileId, tap);
        })
        .catch((error) =>
          console.warn('[sync] local canon check failed:', error),
        );
    },
    [deps, foreignCount, swapProjection],
  );

  // 操作ログ tap をファイル単位で保持する (W3c1)。content (GraphEditor) と
  // structure (以下の構造ハンドラ) の両方が単一の tap = 単一 Lamport 発番源を共有する。
  // remote キューがあれば tap は fanout (ローカル正典 + remote) になる (W3d5-5)。
  const {
    record: internalSyncRecord,
    clock: trunkClock,
    syncNow,
  } = useEventSyncTap(activeFile?.id ?? null, {
    remoteQueue,
    actor,
    // 「読む順序は名簿 → グラフ」の前半 (step2 Phase 2 S2)
    roster,
    // 受信 (a) の書き込み口も discovery (4e-2b) と同じ deps 抽象を通す。
    // 既定は api の pushReceivedBatches なので挙動は変わらない (deps は安定参照)。
    appendReceived: deps.pushReceivedBatches,
    fetchLocal: deps.fetchBatches,
    onReceived: handleReceived,
    onRoster: handleRoster,
    onConflicts: handleConflicts,
    onOverwrites: handleOverwrites,
    onSynced: handleSynced,
  });
  const syncRecord = syncRecordOverride ?? internalSyncRecord;

  // trunk 読取 (Phase 6 p6-3 で op-log 単独へ, 設計 §3.6)。
  //
  // W3d は op-log を正典としつつ snapshot への dual-read フォールバックを残していたが、
  // p6-3 で snapshot への**書込を止めた**ため退避先として成立しなくなった (古い内容を
  // 見せる方が失敗するより悪い)。安全弁 `READ_FROM_OPLOG` もここで役目を終える。
  const loadFile = useCallback(
    async (id: string): Promise<GraphFile> => {
      const batches = await deps.fetchBatches(id as FileId);
      const file = projectFile(batches, id as FileId);
      // 画像 blob の由来は **op-log にしか無い** (step2 Phase 2 S5)。projection の
      // 出力 (`GraphFile`) には載せないので、batch を読んだこの場で導いて持つ
      setBlobOrigins(collectBlobOrigins(batches));
      // 「画面が古い」を測る物差しの起点 (#202)
      projectedForeignRef.current.set(id as FileId, foreignCount(batches));
      // 有効な GraphFile は必ず 1 枚以上のシートを持つ (W3d-2 の読取失敗判定)。
      // 0 枚 = 欠損ファイル / 孤児 batch のみ。呼び出し側で alert に至らせる。
      if (file.sheets.length === 0) {
        throw new Error(`op-log projection has no sheets: ${id}`);
      }
      return file;
    },
    [deps, foreignCount],
  );

  const openFile = useCallback(
    async (id: string) => {
      try {
        const file = await loadFile(id);
        setActiveFile(file);
        setActiveSheetId((file.sheets[0]?.id ?? null) as SheetId | null);
        setExpandedFileIds((prev) => new Set([...prev, id]));
      } catch (err) {
        console.error('Failed to open file:', err);
        await new Promise<void>((resolve) => {
          setAlertState({
            message: 'ファイルを開けませんでした。',
            resolve,
          });
        });
      }
    },
    [loadFile, setAlertState],
  );

  const toggleExpand = useCallback(
    (id: string) => {
      let isExpanding = false;
      setExpandedFileIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
          isExpanding = true;
        }
        return next;
      });
      if (isExpanding && (!activeFile || activeFile.id !== id)) {
        openFile(id);
      }
    },
    [activeFile, openFile],
  );

  const handleCreate = useCallback(async () => {
    try {
      const name = newFileName.trim() || '無題';
      const created = await deps.createFile(name);
      setFiles((fs) => [
        ...fs,
        {
          id: created.id,
          name: created.name,
          description: created.description,
        },
      ]);
      // 作成直後も同じ op-log 経路で読み直し、projection を表示する (open との一貫性)。
      // `POST /files` が genesis を書いた後なので必ず読める (p6-1)。
      const file = await loadFile(created.id);
      setActiveFile(file);
      setActiveSheetId((file.sheets[0]?.id ?? null) as SheetId | null);
      setExpandedFileIds((prev) => new Set([...prev, created.id]));
      setNewFileName('');
      // 名簿の起点を置く (step2 Phase 1)。**作成のこの瞬間だけが「誰が作ったか」を
      // 知っている** — グラフの op-log に作成者は載らない (計画の事実 7)。起点が無い
      // File では招待が 1 件残らず pre 条件で捨てられ、名簿が永久に空になる。
      //
      // ログイン前は DID が無いので置けない。その File は次に名簿を開いたときに
      // `ensureOwnGenesis` が拾う。**失敗しても File の作成は成功として扱う** —
      // 同じ理由で拾い直せるので、ここで巻き戻す筋合いが無い
      if (didFromActor(actor) !== LOCAL_DID) {
        putJudgment(
          created.id as FileId,
          participationGenesisBatch(created.id, actor),
        ).catch((err) =>
          console.warn(
            '[participation] 起点を置けなかった (次に名簿を開いたとき置き直す):',
            err,
          ),
        );
      }
    } catch (err) {
      console.error('Failed to create file:', err);
    }
  }, [newFileName, deps, loadFile, actor]);

  /**
   * 画面 state を進める (Phase 6 p6-3, 設計 §3.6)。**永続化はしない**。
   *
   * 旧 `persistFile` は「画面 state 更新」と「snapshot 書込 (`saveFile` +
   * `syncFileToAtproto`)」の二役だった。後者を消すと前者だけが残る — それがこの関数。
   * 状態の永続化は op-log tap (`syncRecord`) が唯一の書込口になった。
   *
   * ✅ Phase 5 の `isBranchActive` ガードはこの撤去で**構造ごと消えた** — 「branch 表示中は
   * snapshot へ書かない」というガードは、書込先が無ければ要らない。Phase 5 critic の
   * 「呼び出し側ごとのガードは必ず漏れる」への最終的な答え。
   */
  const updateFileState = useCallback((updated: GraphFile) => {
    setActiveFile(updated);
    // サイドバー一覧の名前・説明を追随させる (一覧は id/name/description だけを持つ)
    setFiles((fs) =>
      fs.map((f) =>
        f.id === updated.id
          ? {
              id: updated.id,
              name: updated.name,
              description: updated.description,
            }
          : f,
      ),
    );
  }, []);

  const handleSaveFileSettings = useCallback(
    (fileId: string, name: string, description: string) => {
      if (!activeFile || activeFile.id !== fileId) return;
      // op-log へ変化した項目のみ emit する (dual-write, 空 batch 回避)
      if (name !== activeFile.name) {
        syncRecord({ ...makeEventBase('file'), type: 'FILE_RENAMED', name });
      }
      const newDesc = description || undefined;
      if (newDesc !== activeFile.description) {
        syncRecord({
          ...makeEventBase('file'),
          type: 'FILE_DESCRIBED',
          ...(newDesc !== undefined && { description: newDesc }),
        });
      }
      updateFileState({
        ...activeFile,
        name,
        description: newDesc,
      });
    },
    [activeFile, updateFileState, syncRecord],
  );

  /**
   * 削除対象ファイルへの push 口を組み立てる (ANA-127)。
   *
   * tap (`useEventSyncTap`) と同じ組み方 — ローカル正典が成功条件で、ログイン中だけ
   * fanout で remote キューにも積む。tap を使わないのは、削除が **activeFile 以外にも
   * 掛かる**ためである (`sync/fileDeletion.ts` 冒頭)。
   */
  const pushToFile = useCallback(
    async (fileId: FileId, batches: Batch[]): Promise<void> => {
      const local = new LocalServerSyncProvider(fileId);
      const provider = remoteQueue
        ? new FanoutSyncProvider({ local, remoteQueue, fileId })
        : local;
      await provider.push(batches);
    },
    [remoteQueue],
  );

  const handleDeleteFile = useCallback(
    async (id: string) => {
      const target = files.find((f) => f.id === id);
      if (target) {
        const ok = await new Promise<boolean>((resolve) => {
          setConfirmState({
            message: `「${target.name}」を削除しますか？\nシートも全て削除されます。`,
            resolve,
          });
        });
        if (!ok) return;
      }
      try {
        // 削除 = op-log へ tombstone を追記する (ANA-127)。ローカル DB の行は消さない
        // — 消すと tombstone まで消え、次の discovery が「未知ファイル」と判定して
        // PDS から materialize し直す (設計 D1)。失敗したら UI からも消さない。
        await deps.deleteFile(id as FileId, actor, {
          fetchBatches: deps.fetchBatches,
          push: pushToFile,
        });
        setFiles((fs) => fs.filter((f) => f.id !== id));
        if (activeFile?.id === id) {
          setActiveFile(null);
          setActiveSheetId(null);
        }
        setExpandedFileIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setPopupTarget(null);
      } catch (err) {
        console.error('Failed to delete file:', err);
      }
    },
    [activeFile, files, setConfirmState, deps, actor, pushToFile],
  );

  const handleSaveSheetSettings = useCallback(
    (sheetId: string, name: string, description: string) => {
      if (!activeFile) return;
      const sheet = activeFile.sheets.find((s) => s.id === sheetId);
      // op-log へ変化した項目のみ emit する (dual-write, 空 batch 回避)
      if (sheet && name !== sheet.name) {
        syncRecord({
          ...makeEventBase('file'),
          type: 'SHEET_RENAMED',
          sheetId: sheetId as SheetId,
          name,
        });
      }
      const newDesc = description || undefined;
      if (sheet && newDesc !== sheet.description) {
        syncRecord({
          ...makeEventBase('file'),
          type: 'SHEET_DESCRIBED',
          sheetId: sheetId as SheetId,
          ...(newDesc !== undefined && { description: newDesc }),
        });
      }
      updateFileState({
        ...activeFile,
        sheets: activeFile.sheets.map((s) =>
          s.id === sheetId ? { ...s, name, description: newDesc } : s,
        ),
      });
    },
    [activeFile, updateFileState, syncRecord],
  );

  const handleDeleteSheet = useCallback(
    async (sheetId: string) => {
      if (!activeFile) return;
      if (activeFile.sheets.length <= 1) {
        await new Promise<void>((resolve) => {
          setAlertState({
            message: '最後のシートは削除できません',
            resolve,
          });
        });
        return;
      }
      const updated: GraphFile = {
        ...activeFile,
        sheets: activeFile.sheets.filter((s) => s.id !== sheetId),
      };
      // op-log へ sheet.remove を emit する (dual-write)
      syncRecord({
        ...makeEventBase('file'),
        type: 'SHEET_REMOVED',
        sheetId: sheetId as SheetId,
      });
      if (activeSheetId === sheetId) {
        setActiveSheetId((updated.sheets[0]?.id ?? null) as SheetId | null);
      }
      setPopupTarget(null);
      updateFileState(updated);
    },
    [activeFile, activeSheetId, updateFileState, setAlertState, syncRecord],
  );

  const handleImportFile = useCallback(
    async (data: ConversensusFile) => {
      try {
        const file = await deps.importFile(data);
        setFiles((fs) => [
          ...fs,
          { id: file.id, name: file.name, description: file.description },
        ]);
        setActiveFile(file);
        setActiveSheetId((file.sheets[0]?.id ?? null) as SheetId | null);
        setExpandedFileIds((prev) => new Set([...prev, file.id]));
      } catch (err) {
        console.error('Failed to import file:', err);
        await new Promise<void>((resolve) => {
          setAlertState({
            message:
              'インポートに失敗しました。ファイル形式を確認してください。',
            resolve,
          });
        });
      }
    },
    [deps, setAlertState],
  );

  // 未オープンのファイルの書き出し元も op-log の projection にする (Phase 6 p6-3)。
  // 設計 §3.4 は「server に GraphFile を組み立てて返す責務を残さない」ために
  // `GET /files/:id` を消す判断をした (projection の第 2 実装を作らない)。その代わりが
  // これ — 読取は `loadFile` と同じ 1 本の経路に揃う。
  const handleExportFile = useCallback(
    async (fileId: string) => {
      try {
        const file =
          activeFile?.id === fileId ? activeFile : await loadFile(fileId);
        const { missingBlobs } = await deps.exportFile(file);
        // 同梱できなかった画像は**黙って落とさない** (ANA-116 D1)。実体がこの端末に
        // 無い画像 (他端末が作って未表示のもの) は書き出しに含められないので、
        // そのファイルを他の端末で開いてもその画像は出ない
        if (missingBlobs.length > 0) {
          await new Promise<void>((resolve) => {
            setAlertState({
              message: `${missingBlobs.length} 個の画像の実体がこの端末に無いため, 書き出したファイルには含まれていません。`,
              resolve,
            });
          });
        }
      } catch (err) {
        console.error('Failed to export file:', err);
      }
    },
    [activeFile, deps, loadFile, setAlertState],
  );

  // 初期ファイル読み込み
  useEffect(() => {
    deps.fetchFiles().then(setFiles).catch(console.error);
  }, [deps]);

  // 参加を承認した File を手元に立ち上げる (step2 Phase 2 S3)。
  //
  // 承認しただけでは手元に File は無い — 判断ログには承認が載るが、グラフの batch は
  // 1 件も自分の repo に無いからである。**列挙の入口は自分の判断ログ**で、他 actor の
  // repo は 1 件も列挙しない (U6-P1: 回すとその actor の File が全部見える)。
  //
  // **名簿の起点 (bootstrap) の後に走らせる。**起点が無い File では名簿が空になり、
  // 「いま参加者か」を確かめられない。
  //
  // 契機は 2 つある。**起動時・`online`** (下の effect) と、**参加を承認した直後**
  // (App が呼ぶ)。後者が無いと、承認しても次に開き直すまでサイドバーに出てこない。
  const discoverParticipating = useCallback((): Promise<void> => {
    if (!roster || !remoteQueue) return Promise.resolve();
    const did = didFromActor(actor);
    return discoverParticipatingFiles({
      // **自分の repo だけを読む。**判断ログの rkey は batches と同じスキームなので、
      // 自分が関わった File の fileId がここから出る
      listJudgmentFileIds: () => listJudgmentFileIds(),
      listLocalFileIds: deps.fetchLocalFileIds,
      readRoster: (fileId) => roster.read(fileId),
      // 集めるだけで書かない。削除の判定 (remove-wins) を書く前に挟むため
      collectFromParticipants: (fileId, participation) =>
        collectParticipantBatches(fileId, participation, did, {
          pullRemoteForFile: (id, repo) =>
            remoteQueue.pullRemoteForFile(id, repo),
        }),
      appendReceived: deps.pushReceivedBatches,
      viewer: did,
    })
      .then((result) => {
        if (result.skippedDeletedFiles > 0) {
          console.info(
            `[participation] skipped ${result.skippedDeletedFiles} file(s) ` +
              'deleted by another participant',
          );
        }
        if (result.discovered.length === 0) return;
        console.info(
          `[participation] joined ${result.discovered.length} file(s), ` +
            `${result.appended} batch(es)`,
        );
        deps.fetchFiles().then(setFiles).catch(console.error);
      })
      .catch((error) =>
        console.warn('[participation] file discovery failed:', error),
      );
  }, [remoteQueue, deps, actor, roster]);

  // 未知ファイルの発見と materialize (Phase 4e-2b, 4e 設計 §3.2b)。
  // **リモートのファイル一覧を得る唯一の経路** (Phase 6 p6-4, 設計 §3.8)。以前は
  // `loadAtprotoFiles` (PDS の legacy file レコード一覧) が並走していたが、あちらは
  // snapshot 由来のメタデータしか持たず、op-log で作られたファイルは載らない。
  // remote の fileId を列挙し、ローカル正典に無いファイルの batch 群だけを marker 経路へ
  // 書く (Phase 7 p7-3 で「全件取得 → 既知分を捨てる」から変更)。契機は受信 (a) と同じ
  // 「起動時 + online + 手動は今すぐ同期に相乗り予定」(§3.4)。
  // `remoteQueue` はログイン中のみ非 null なので、撤去した `loadAtprotoFiles` の契機
  // (セッション確立時) もこの effect の再実行が引き取っている。
  // 発見したら一覧を読み直す — GET /files が op-log との和集合 (4e-2a) なので、
  // materialize されたファイルはこれだけで Sidebar に現れる。
  //
  // **発見の前に rkey 移行 (Phase 7 p7-4) を 1 回だけ通す**。p7-1 より前に書かれた
  // 旧 rkey のレコードは新経路 (列挙・prefix 取得) の走査に現れないので、移行を経ずに
  // 発見だけを回すと「PDS にしか無い古い batch」を持つファイルが見えないままになる。
  // 移行は marker (端末ローカル) で 1 回に限られ、失敗しても marker が立たないので
  // 次の契機で再試行される (設計 §3.4 / §6.2)。
  // **移行が失敗しても発見は走らせる** — 発見は非破壊で、移行と独立に価値があるため。
  useEffect(() => {
    if (!remoteQueue) return;
    const did = didFromActor(actor);
    const migrate = () =>
      migrateRemoteRkey({
        // repo 全件。**移行だけが使う口** — 旧 rkey は新経路の走査に現れない (p7-5)
        pullAllRemoteForMigration: () =>
          remoteQueue.pullAllRemoteForMigration(),
        appendReceived: deps.pushReceivedBatches,
        fetchBatches: deps.fetchBatches,
        // 新形式で既に載っている分を除くための範囲取得 (まとめ書きは既存 rkey で落ちる)
        pullRemoteForFile: (fileId) => remoteQueue.pullRemoteForFile(fileId),
        // キューを経由しない直送 (上限で溢れると完了判定が嘘になる, remoteSyncQueue 参照)
        createRemote: (entries) => remoteQueue.createRemote(entries),
        // 再 push は自分が書いた batch だけ (S0)。移行を抜け道にしない
        did,
        hasMigrated: () => deps.hasRkeyMigrated(did),
        markMigrated: () => deps.markRkeyMigrated(did),
      })
        .then((result) => {
          if (result.status === 'already-migrated') return;
          // 無言で済ませない (§3.6) — 移行は 1 回きりなので記録が残る形で出す
          console.info(
            `[sync] rkey migration done: ${result.remoteFiles} remote file(s), ` +
              `received ${result.receivedBatches} batch(es), ` +
              `re-pushed ${result.pushedBatches} batch(es) across ` +
              `${result.pushedFiles} file(s) in ${result.elapsedMs}ms`,
          );
          // 移行の全件受信で未知ファイルが materialize されている可能性がある
          deps.fetchFiles().then(setFiles).catch(console.error);
        })
        .catch((error) =>
          console.warn(
            '[sync] rkey migration failed (will retry on the next start):',
            error,
          ),
        );

    // **Promise を返す。**`finally` のコールバックが thenable を返したときだけ
    // 後段がそれを待つ。返さないと名簿の bootstrap が発見の完了前に走る
    const discover = () => {
      return discoverRemoteFiles({
        // 列挙 → 未知ファイルだけ取得 (Phase 7 p7-3)。既知ファイルの batch は落とさない。
        // 列挙は「remote 側で削除済みか」も返す (ANA-127 S3) ので、他端末で削除された
        // ファイルはここで弾かれ、この端末に materialize されない
        listRemoteFiles: () => remoteQueue.listRemoteFiles(),
        pullRemoteForFile: (fileId) => remoteQueue.pullRemoteForFile(fileId),
        // **一覧 (`fetchFiles`) ではなく全 file_id を既知集合にする** (ANA-127)。
        // 一覧は削除済みを隠すので、それを既知集合に使うと削除したファイルが
        // 「未知」に化けて PDS から materialize され、削除が取り消される。
        listLocalFileIds: deps.fetchLocalFileIds,
        appendReceived: deps.pushReceivedBatches,
      })
        .then((result) => {
          // 削除で materialize を見送った分は無言にしない (ANA-127 S3)。
          // 「PDS にはあるのに手元に出てこない」を後から説明できる唯一の記録である
          if (result.skippedDeletedFiles > 0) {
            console.info(
              `[sync] skipped ${result.skippedDeletedFiles} remote file(s) ` +
                'deleted elsewhere',
            );
          }
          if (result.discovered.length === 0) return;
          console.info(
            `[sync] discovered ${result.discovered.length} remote file(s), ` +
              `${result.appended} batch(es)`,
          );
          deps.fetchFiles().then(setFiles).catch(console.error);
        })
        .catch((error) =>
          console.warn('[sync] remote file discovery failed:', error),
        );
    };
    // 名簿の起点を既存 File に置く (step2 Phase 1)。
    //
    // **発見の後に走らせる。**発見が materialize した File にも起点が要るのに、
    // 先に走らせると marker が立って二度と拾えなくなる。step1 の発見は自分の repo
    // からしか拾わないので、materialize された File も自分のものである。
    //
    // 手続きはべき等 (genesis の id が fileId と actor から決まる) なので、
    // 失敗しても marker が立たず次の契機で再試行される。
    const bootstrap = () =>
      bootstrapParticipation({
        listLocalFileIds: deps.fetchLocalFileIds,
        fetchBatches: deps.fetchBatches,
        listJudgmentFileIds: () => listJudgmentFileIds(),
        putJudgment,
        actor,
        hasBootstrapped: () => hasParticipationBootstrapped(did),
        markBootstrapped: () => markParticipationBootstrapped(did),
      })
        .then((result) => {
          if (result.status === 'already-bootstrapped') return;
          // 無言で済ませない — 1 回きりなので記録が残る形で出す
          console.info(
            `[participation] bootstrap done: wrote ${result.wrote} genesis, ` +
              `skipped ${result.skippedExisting} existing / ` +
              `${result.skippedForeign} foreign / ` +
              `${result.skippedDeleted} deleted in ${result.elapsedMs}ms`,
          );
        })
        .catch((error) =>
          console.warn(
            '[participation] bootstrap failed (will retry on the next start):',
            error,
          ),
        );

    // 移行 → 発見 → 名簿の起点 → 参加 File の発見 の順に走らせる。
    // 前段の成否によらず後段は必ず実行する
    const sync = () => {
      migrate()
        .finally(discover)
        .finally(bootstrap)
        .finally(discoverParticipating);
    };
    sync();
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [remoteQueue, deps, actor, discoverParticipating]);

  return {
    files,
    /**
     * 画像 blob の由来を引く (step2 Phase 2 S5)。`BlobOriginProvider` に渡す。
     * **他 actor が貼った画像は自分の repo に無い**ので、これが無いと出ない
     */
    originOf,
    /**
     * 果たしていない同期義務 (step2 Phase 2 S6)。**この File は読み取り専用にする** —
     * 離脱中の他人の編集を取りこぼしたまま書くと、受け取った側でエラーになる
     */
    obligation,
    /**
     * 開いている File の共有状態 (step2 Phase 2)。**開いている File の分しか無い** —
     * 同期するのは開いている File だけなので、それ以外の共有状態は分からない
     * (知るには File の数だけ名簿を読むことになる)。
     */
    sharing,
    /**
     * 参加を承認した File を手元に立ち上げる (step2 Phase 2 S3)。
     * **承認の直後に呼ぶ** — 呼ばないと次に開き直すまでサイドバーに出てこない。
     */
    discoverParticipating,
    activeFile,
    activeSheetId,
    setActiveFile,
    setActiveSheetId,
    expandedFileIds,
    newFileName,
    setNewFileName,
    popupTarget,
    setPopupTarget,
    activeSheet,
    openFile,
    toggleExpand,
    handleCreate,
    updateFileState,
    handleSaveFileSettings,
    handleDeleteFile,
    handleSaveSheetSettings,
    handleDeleteSheet,
    handleImportFile,
    handleExportFile,
    syncRecord,
    // trunk の Lamport 発番器 (p5-4)。merge が branch batches を trunk へ再スタンプ
    // するときに使う — 発番器を分けると同 (clock, actor) の batch が生まれる。
    trunkClock,
    receiveEpoch,
    // 「今すぐ同期」(SyncStatusIndicator) の口。開いている間に他所で起きた変更を
    // 取りに行く手段がこれしかない (GitHub #202)
    syncNow,
  };
}
