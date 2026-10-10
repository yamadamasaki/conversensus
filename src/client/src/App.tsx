import {
  addressKey,
  BRANCH_STATUS,
  type BranchId,
  type BranchMeta,
  DERIVED_FROM_SHEET_PROPERTY,
  type Did,
  derivedNodeIdOf,
  type FileId,
  type FolderId,
  type GraphFile,
  type GraphViewAddress,
  HEAD_CUT,
  heldMaxima,
  isFork,
  METAGRAPH_SHEET_KIND,
  type NodeId,
  type PropertyName,
  placeDerivedNodes,
  refreshDerivedNodes,
  SHEET_KIND_PROPERTY,
  type Sheet,
  type SheetId,
  type SheetKind,
  sheetKindOf,
  TEMPLATE_SHEET_KIND,
  type Template,
  type TemplateGraphContent,
  type TemplateRef,
  templateGraphOf,
} from '@conversensus/shared';
import { FilePlus, Files, FileUp, PanelLeft, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AcceptInvitationDialog } from './AcceptInvitationDialog';
import { AlertDialog } from './AlertDialog';
import { AtprotoLoginDialog } from './AtprotoLoginDialog';
import { fetchBatches } from './api';
import { authNeedsPassword } from './atproto/client';
import { CommitDialog } from './CommitDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { ConflictList } from './ConflictList';
import { ConflictNotice, NOTICE_Z_INDEX } from './ConflictNotice';
import { devPanesEnabled } from './config';
import { BOUNDARY_LABELS, ErrorBoundary } from './ErrorBoundary';
import { type GraphEvent, makeEventBase } from './events/GraphEvent';
import { readImportFile } from './files/readImportFile';
import { type FolderNode, siblingNameTaken } from './folders/folderTree';
import { GraphEditor } from './GraphEditor';
import { GraphHeader, type HeaderBranch } from './GraphHeader';
import type { PreviewMarks } from './GraphPreview';
import { alignToPane } from './graph/alignToPane';
import { splitMetagraphEvent } from './graph/metagraphEvents';
import {
  ERASE_CONFIRM_LABEL,
  KEEP_CANCEL_LABEL,
  logoutFlow,
} from './hooks/logoutFlow';
import { useActor } from './hooks/useActor';
import { useAtprotoSession } from './hooks/useAtprotoSession';
import {
  BRANCH_DIFF_STATE,
  useBranchOperations,
} from './hooks/useBranchOperations';
import { useChangeCounter } from './hooks/useChangeCounter';
import type { UndoState } from './hooks/useEventStore';
import { useFileSheetOperations } from './hooks/useFileSheetOperations';
import { useFolders } from './hooks/useFolders';
import { useGraphPanels } from './hooks/useGraphPanels';
import { useLocalOnlyCount } from './hooks/useLocalOnlyCount';
import { useMergerSnapshot } from './hooks/useMergerSnapshot';
import { useNoticeInbox } from './hooks/useNoticeInbox';
import { useParticipation } from './hooks/useParticipation';
import { useRemoteSyncQueue } from './hooks/useRemoteSyncQueue';
import { useResolvedTemplates } from './hooks/useResolvedTemplates';
import { useRosterSource } from './hooks/useRosterSource';
import { useSidePanels } from './hooks/useSidePanels';
import { useTabNavigation } from './hooks/useTabNavigation';
import { useTabs } from './hooks/useTabs';
import { useViewportTier } from './hooks/useViewportTier';
import { InputDialog } from './InputDialog';
import { InvitationDialog } from './InvitationDialog';
import { BlobOriginProvider } from './images/blobOriginContext';
import { compactHeader } from './layout/viewportTier';
import { otherTabsOpen, requestErase } from './local/eraseDevice';
import { OverwriteNotice } from './OverwriteNotice';
import { PaneFrame } from './PaneFrame';
import { ParticipateDialog } from './ParticipateDialog';
import { ParticipationHistoryDialog } from './ParticipationHistoryDialog';
import { PassivePane } from './PassivePane';
import { PropertyEditor } from './PropertyEditor';
import { propertyRows } from './property/propertyRows';
import { RightSidebar } from './RightSidebar';
import { ReadOnlyProvider } from './readOnlyContext';
import { SearchPanel } from './SearchPanel';
import { type OpenOptions, Sidebar } from './Sidebar';
import { SidePanel } from './SidePanel';
import { openForksOf } from './sync/forkArrival';
import {
  carryChecks,
  conflictTargets,
  diffMarks,
  forkSideLabels,
} from './sync/merger';
import { participationRounds } from './sync/participationHistoryView';
import { TabBar } from './TabBar';
import { TemplateApplyDialog } from './TemplateApplyDialog';
import {
  activeTab,
  isMultiple,
  MERGER_PANE,
  openFileIds,
  type Tab,
  tabAddress,
} from './tabs/tabs';
import { color, font, radius, shadow } from './theme';
import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';
import { generateId } from './uuid';

/** 特殊なグラフのシートの既定の名前 (step3 Phase 4)。n は同じ種類の何枚目か */
const SPECIAL_SHEET_NAMES: Record<SheetKind, (n: number) => string> = {
  [TEMPLATE_SHEET_KIND]: (n) => `Template ${n}`,
  [METAGRAPH_SHEET_KIND]: (n) => (n === 1 ? 'index' : `index ${n}`),
};

/** merger の後の pane で、画面の state へ返さない (`onSheetChange` の受け手) */
const ignoreSheetChange = () => {};

/** File が 1 つも無いときの案内 (§9.1)。JSX の折り返しで「、」の後に空白が入らないよう 1 つの文字列にする */
const EMPTY_FILES_NOTE =
  'File は Sheet (グラフ) を束ねる単位です。新しく作るか、.conversensus を import するか、受け取った参加コードで共同作業に加わってください。';

export default function App() {
  // Dialog state (UI only)
  const [confirmState, setConfirmState] = useState<{
    message: string;
    resolve: (ok: boolean) => void;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  } | null>(null);
  const [inputState, setInputState] = useState<{
    message: string;
    resolve: (value: string) => void;
  } | null>(null);
  const [alertState, setAlertState] = useState<{
    message: string;
    resolve: () => void;
  } | null>(null);
  const undoStateMapRef = useRef<Map<string, UndoState>>(new Map());

  // ATProto セッション
  const {
    session: atprotoSession,
    resuming: atprotoResuming,
    login: atprotoLogin,
    logout: atprotoLogout,
  } = useAtprotoSession();
  /** 画面右下の通知と、閉じた通知の既読 (step3 Phase 6 S6-1a) */
  const {
    conflictNotice,
    showConflicts,
    closeConflictNotice,
    overwriteNotice,
    handleOverwrites,
    dismissOverwrites,
    arrivedForks,
    handleForksArrived,
  } = useNoticeInbox(atprotoSession?.did ?? null);
  /** 上書きの報告の対象名。競合と同じ「分岐点での名前」から引く */
  const overwriteLabelOf = useCallback(
    (target: string) => overwriteNotice.labels.get(target) ?? target,
    [overwriteNotice],
  );
  /**
   * 競合の対象を人が読める名前にする。**id は UUID なので出しても意味が無い。**
   *
   * 名前は merge の結果 (分岐点での名前) から引く — 削除依存の対象は消された要素なので
   * **いま開いているシートには居ない**。空の名前は「無い」と分かる形に言い換える。
   */
  const conflictLabelOf = useCallback(
    (target: string) => {
      const label = conflictNotice.labels.get(target);
      if (label === undefined) return target;
      return label === '' ? '(名前のない要素)' : label;
    },
    [conflictNotice.labels],
  );

  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  /** 未ログインの間に、この端末にだけある編集の数 (FPR 前 L-3) */
  // 起動時の復元が済むまでは数えない (ログイン済みの人に一瞬だけ出さない)
  const localOnlyCount = useLocalOnlyCount(
    atprotoSession === null && !atprotoResuming,
  );

  // remote (ATProto) 送信キュー。未ログイン時は null → tap は local-only (W3d5-5)
  const remoteQueue = useRemoteSyncQueue(atprotoSession);

  /** ログアウト — この端末のデータも消すかを訊く (#288) */
  const handleLogout = useCallback(
    () =>
      logoutFlow({
        unsent: remoteQueue
          ? {
              count: remoteQueue.pendingCount,
              overflowed: remoteQueue.overflowed,
            }
          : null,
        askErase: (message) =>
          new Promise((resolve) =>
            setConfirmState({
              message,
              resolve,
              confirmLabel: ERASE_CONFIRM_LABEL,
              cancelLabel: KEEP_CANCEL_LABEL,
              danger: true,
            }),
          ),
        otherTabsOpen: () =>
          otherTabsOpen(
            navigator.locks ? () => navigator.locks.query() : undefined,
            true,
          ),
        alert: (message) =>
          new Promise((resolve) => setAlertState({ message, resolve })),
        logout: atprotoLogout,
        requestErase: () => requestErase(sessionStorage),
        reload: () => location.reload(),
      }),
    [remoteQueue, atprotoLogout],
  );
  /** 共同作業者ダイアログの対象 File (step2 Phase 1)。null なら閉じている */
  const [invitationFileId, setInvitationFileId] = useState<FileId | null>(null);
  const [participateOpen, setParticipateOpen] = useState(false);
  /** 空の状態の「import」が開くファイル選択 */
  const emptyImportRef = useRef<HTMLInputElement>(null);
  /** 参加履歴を開いている DID (step2)。参加者一覧の上に重ねて出す */
  const [historyDid, setHistoryDid] = useState<Did | null>(null);

  // batch の操作主体 `<did>#<deviceId>`。端末まで一意にすることで、受信時に因果順序と
  // 重複排除の単位を識別できる (Phase 4d-2)
  const actor = useActor(atprotoSession);

  // 名簿の供給元 (step2 Phase 2 S1)。**ダイアログと同期サイクルで共有する** —
  // 別々に作ると読みが畳まれず、起点の修復も二重に走る
  const roster = useRosterSource(actor);

  // テキスト編集中の検出 (Phase 4e-3, 4e 設計 §3.3)。受信の activeFile 差し替えは
  // 入力中のテキストを巻き込むため、フォーカスが入力要素 (ノードの inline textarea /
  // エッジラベルの input / 各ダイアログ) にある間は保留する。ドラッグ中の検出は
  // §7 未解決点 (実機で問題になれば React Flow の drag 状態を足す)。
  const isEditingActive = useCallback(() => {
    const el = document.activeElement;
    return (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable)
    );
  }, []);

  // File & sheet operations
  const fileOps = useFileSheetOperations({
    setConfirmState,
    setAlertState,
    setConflictNotice: showConflicts,
    onOverwrites: handleOverwrites,
    onForksArrived: handleForksArrived,
    remoteQueue,
    actor,
    // 多アクタ同期は名簿を先に読む (step2 Phase 2 S2)。ダイアログと同じ供給元である
    roster,
    isEditingActive,
    // 未ログインの編集を出し直すか訊くときに見せる (FPR 前 L-1)
    accountLabel: atprotoSession?.handle,
  });

  /**
   * File を開いたら、まだ決着していない fork を op-log から出す (step3 Phase 6 S6-1b)。
   * 到着の知らせは受信の瞬間にしか出ないので、閉じる前に再読み込みすると消えていた。
   * 既読のものと、競合の通知に出ているものは `handleForksArrived` が落とす
   */
  const openFileId = fileOps.activeFile?.id;
  useEffect(() => {
    if (openFileId === undefined) return;
    let cancelled = false;
    void fetchBatches(openFileId).then((batches) => {
      if (!cancelled) handleForksArrived(openForksOf(batches, openFileId));
    });
    return () => {
      cancelled = true;
    };
  }, [openFileId, handleForksArrived]);

  // Branch operations
  /**
   * explicit merge で人の判断が要る競合があったときに merger を開く (step3 Phase 5)。タブは
   * この後で作るので、ref で後から繋ぐ
   */
  const openMergerRef = useRef<((branch: BranchMeta) => void) | null>(null);
  const handleOpenMerger = useCallback(
    (branch: BranchMeta) => openMergerRef.current?.(branch),
    [],
  );

  const branchOps = useBranchOperations({
    onOpenMerger: handleOpenMerger,
    activeFile: fileOps.activeFile,
    activeSheetId: fileOps.activeSheetId,
    onSetActiveFile: fileOps.setActiveFile,
    setConfirmState,
    setInputState,
    setAlertState,
    setConflictNotice: showConflicts,
    actor,
    // branch の tap と merge の写しは trunk の因果の発番器を共有する (step3 Phase 1)
    trunkCausal: fileOps.trunkCausal,
    // branch / commit のメタは trunk の op-log に記録する (step2 Phase 3 T7-1)
    trunkRecord: fileOps.syncRecord,
    // branch の編集も remote へ出す (step2 Phase 3 T7-2)
    remoteQueue,
    // 参加者の branch を引き、trunk の受信で branch 一覧を読み直す (T7-3)
    roster,
    receiveEpoch: fileOps.receiveEpoch,
  });

  // Cross-domain wired callbacks
  //
  // Phase 6 p6-3 / p6-5b: **autosave は trunk・branch とも消えた**。content の編集は
  // op-log tap (GraphEditor → syncRecord、branch 表示中は branch 専用 tap) が編集ごとに
  // 書いており、debounce して別の永続先へ書き戻す経路がもう無い (設計 §3.6 / §3.7)。
  // ここに残るのは画面 state の更新だけである。
  //
  // `GraphEditor` はシートを返す (step3 Phase 3 S3-2)。開いている File の state の
  // 該当シートを置き換える
  const { setActiveFile } = fileOps;
  const handleSheetChange = useCallback(
    (sheet: Sheet) => {
      setActiveFile((file) =>
        file
          ? {
              ...file,
              sheets: file.sheets.map((s) => (s.id === sheet.id ? sheet : s)),
            }
          : file,
      );
    },
    [setActiveFile],
  );

  const handleSelectSheet = useCallback(
    (sheetId: SheetId) => {
      fileOps.setActiveSheetId(sheetId);
      branchOps.resetBranchState();
    },
    [fileOps.setActiveSheetId, branchOps.resetBranchState],
  );

  // タブ (step3 Phase 3 S3-3)。サイドバーから開く・タブを切り替える・閉じるは、すべて
  // 「アドレスを開く」になる。画面をそのアドレスへ持っていくのは useTabNavigation
  const tabs = useTabs();
  /**
   * merger を新しいタブで開く (仕様: 進行中の作業を邪魔しないように)。merge 元の姿は**開いた時点で
   * 固定する** (Q4) — 開いた時点の手元の知識 (trunk と branch の全 actor の vector) を切断面にする
   */
  openMergerRef.current = (branch: BranchMeta) => {
    void Promise.all([
      fetchBatches(branch.trunkFileId),
      fetchBatches(branch.branchFileId),
    ]).then(([trunk, branchBatches]) =>
      tabs.openMerger({
        fileId: branch.trunkFileId,
        sheetId: branch.sheetId,
        branchId: branch.id,
        startedAt: heldMaxima([...trunk, ...branchBatches]),
      }),
    );
  };
  const currentTab = activeTab(tabs.state);
  const { open: openTab } = tabs;

  /**
   * シートを足す。`templateIds` は当てる template、`properties` は作成時に置くシートのプロパティ
   * (特殊なグラフの種別, step3 Phase 4 S4-0)。名前を省くと `Sheet N`
   */
  const addSheet = useCallback(
    ({
      name,
      templateIds,
      properties,
      content,
      open = true,
    }: {
      /** 足したシートを開く (新しいタブ)。metagraph から足すときは開かない (metagraph に留まる) */
      open?: boolean;
      name?: string;
      templateIds?: TemplateRef[];
      properties?: Record<PropertyName, unknown>;
      /** 作るときに置く中身 (template graph の種の複製, step3 Phase 4 S4-1c) */
      content?: TemplateGraphContent;
    } = {}): SheetId | undefined => {
      const trunkFile = fileOps.activeFile;
      if (!trunkFile) return undefined;
      // branch は per-sheet なので、シートを増やす操作は branch を抜けてから行う
      // (シート切替 `handleSelectSheet` が branch を抜けるのと同じ扱い)。`activeFile` は
      // trunk の姿だけを持つので、そのまま土台にしてよい (step3 Phase 3 S3-2)
      if (!branchOps.isTrunk) branchOps.resetBranchState();
      const newSheet: Sheet = {
        id: generateId() as SheetId,
        // 既定の名前は「ふつうのシートの何枚目か」で付ける。index などの特殊なグラフは数えない
        name:
          name ??
          `Sheet ${trunkFile.sheets.filter((s) => sheetKindOf(s) === undefined).length + 1}`,
        nodes: content?.nodes ?? [],
        edges: content?.edges ?? [],
        ...(content && {
          layouts: content.layouts,
          edgeLayouts: content.edgeLayouts,
        }),
        // 紐づけは作成時にしか持たない (Phase 5 D1)。空配列は「無し」と区別しないので落とす
        ...(templateIds?.length ? { templateIds } : {}),
        ...(properties && { properties }),
      };
      const updated: GraphFile = {
        ...trunkFile,
        sheets: [...trunkFile.sheets, newSheet],
      };
      // op-log へ sheet.create を emit する (dual-write, W3c1)
      fileOps.syncRecord({
        ...makeEventBase('file'),
        type: 'SHEET_CREATED',
        sheetId: newSheet.id,
        name: newSheet.name,
        ...(templateIds?.length ? { templateIds } : {}),
        ...(properties && { properties }),
      });
      // 中身は content の op としてシートに積む (canvas で置いたのと同じ形)。layout も同じ batch に載せる
      for (const node of content?.nodes ?? []) {
        fileOps.syncRecord(
          {
            ...makeEventBase('structure'),
            type: 'NODE_ADDED',
            nodeId: node.id,
            data: node,
            layout: content?.layouts.find((l) => l.nodeId === node.id),
          },
          newSheet.id,
        );
      }
      for (const edge of content?.edges ?? []) {
        fileOps.syncRecord(
          {
            ...makeEventBase('structure'),
            type: 'EDGE_ADDED',
            edgeId: edge.id,
            data: edge,
            edgeLayout: content?.edgeLayouts.find((l) => l.edgeId === edge.id),
          },
          newSheet.id,
        );
      }
      fileOps.updateFileState(updated);
      if (open) {
        fileOps.setActiveSheetId(newSheet.id);
        // 足したシートは新しいタブで開く。画面の state と同じ更新で足すので、移動は起きない
        openTab({
          fileId: trunkFile.id,
          sheetId: newSheet.id,
          branchId: null,
          cut: HEAD_CUT,
        });
      }
      return newSheet.id;
    },
    [
      openTab,
      fileOps.activeFile,
      fileOps.setActiveSheetId,
      fileOps.updateFileState,
      fileOps.syncRecord,
      branchOps.isTrunk,
      branchOps.resetBranchState,
    ],
  );
  /** File の中の template graph (step3 Phase 4)。「シートを追加」で当てる候補になる */
  const templateGraphs = (fileOps.activeFile?.sheets ?? []).filter(
    (s) => sheetKindOf(s) === TEMPLATE_SHEET_KIND,
  );
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);

  /**
   * サイドバーの「シートを追加」。File に template graph があれば当てるものを選ばせる (Q7)。
   * 無ければ 1 クリックのまま足す
   */
  const handleAddSheet = useCallback(() => {
    if (templateGraphs.length > 0) setTemplateDialogOpen(true);
    else addSheet();
  }, [addSheet, templateGraphs.length]);

  /** template graph の種を File に複製する (Q1)。複製した template graph はふつうの template graph */
  const handleAddSeedTemplate = useCallback(
    (seed: Template) =>
      addSheet({
        name: seed.name,
        properties: { [SHEET_KIND_PROPERTY]: TEMPLATE_SHEET_KIND },
        content: templateGraphOf(seed, generateId),
      }),
    [addSheet],
  );

  /**
   * template graph を当ててシートを足す。**当てる内容は、いまの姿 (切断面) で固定する** (仕様:
   * 適用先グラフの生成時に決まる)。切断面は手元の trunk の op-log の vector で、直前の template graph の
   * 編集が漏れないよう、書き込みが落ち切ってから読む
   */
  const { trunkSettled } = fileOps;
  const applyTemplateGraphs = useCallback(
    async (templateSheetIds: string[]) => {
      setTemplateDialogOpen(false);
      const fileId = fileOps.activeFile?.id;
      if (!fileId) return;
      if (templateSheetIds.length === 0) {
        addSheet();
        return;
      }
      await trunkSettled();
      const at = heldMaxima(await fetchBatches(fileId));
      addSheet({
        templateIds: templateSheetIds.map((sheet) => ({
          sheet: sheet as SheetId,
          at,
        })),
      });
    },
    [fileOps.activeFile?.id, addSheet, trunkSettled],
  );

  /** 特殊なグラフのシート (template graph・metagraph) を足す */
  const handleAddKindSheet = useCallback(
    (kind: SheetKind) => {
      const count =
        (fileOps.activeFile?.sheets ?? []).filter(
          (s) => sheetKindOf(s) === kind,
        ).length + 1;
      addSheet({
        name: SPECIAL_SHEET_NAMES[kind]?.(count) ?? `Sheet ${count}`,
        properties: { [SHEET_KIND_PROPERTY]: kind },
      });
    },
    [fileOps.activeFile?.sheets, addSheet],
  );

  // Phase 6 p6-4: セッション確立後の PDS legacy file レコード同期 (`loadAtprotoFiles`)
  /**
   * 名簿の操作 (step2 Phase 1)。
   *
   * **発番器は `fileOps.trunkCausal` を渡す。**判断ログとグラフの op-log は同じ clock 空間を
   * 共有しなければならない — pre 条件が「この操作より前」を含むので、別空間にすると
   * 承認が済んでいるのに正当な再 merge が落ちる (U6-P2 スパイク)。
   */
  const participation = useParticipation({
    actor,
    clock: fileOps.trunkCausal,
    // clock 空間は File ごと。開いている File のときだけ tap の clock を使う
    activeFileId: fileOps.activeFile?.id ?? null,
    // **同期サイクルと同じ供給元**を渡す (step2 Phase 2 S1)
    roster,
  });

  // は撤去した。リモートのファイル発見は `useFileSheetOperations` 内の
  // `discoverRemoteFiles` (op-log 経路) に一本化されている (設計 §3.8)。

  /** 左サイドバーの Folder (step3 Phase 6 S6-2c) */
  const fileIds = useMemo(
    () => fileOps.files.map((f) => f.id as FileId),
    [fileOps.files],
  );
  const folders = useFolders(atprotoSession?.did ?? null, fileIds);
  const { syncFolders } = folders;
  const askName = useCallback(
    (message: string) =>
      new Promise<string>((resolve) => setInputState({ message, resolve })),
    [],
  );
  const showAlert = useCallback(
    (message: string) =>
      new Promise<void>((resolve) => setAlertState({ message, resolve })),
    [],
  );
  /**
   * Folder の名前を訊いて検査する。空なら取り消し、同じ階層に同じ名前があれば断る
   * (仕様: Folder の名前は同じ階層で重ならない)。`except` は改名する Folder 自身
   */
  const askFolderName = useCallback(
    async (
      message: string,
      parent: FolderId | undefined,
      except?: FolderId,
    ): Promise<string | null> => {
      const name = (await askName(message)).trim();
      if (name === '') return null;
      if (siblingNameTaken(folders.tree, parent, name, except)) {
        await showAlert(`同じ階層に「${name}」という Folder があります`);
        return null;
      }
      return name;
    },
    [askName, showAlert, folders.tree],
  );
  const folderProps = {
    tree: folders.tree,
    collapsed: folders.collapsed,
    onToggle: folders.toggleFolder,
    onCreate: async (parent: FolderId | undefined) => {
      const name = await askFolderName('Folder の名前:', parent);
      if (name !== null) folders.createFolder(name, parent);
    },
    onRename: async (node: FolderNode) => {
      const name = await askFolderName(
        `「${node.name}」の新しい名前:`,
        node.folder.parent,
        node.folder.id,
      );
      if (name !== null) folders.renameFolder(node.folder.id, name);
    },
    onDelete: folders.deleteFolder,
    onMoveFile: folders.moveFile,
  };

  /**
   * 「今すぐ同期」。**trunk と、開いている branch の両方を引く** — branch の tap は
   * trunk とは別なので、trunk だけを引くと branch を開いたまま押しても相手の
   * branch の編集が来ない。trunk を先にするのは、名簿と branch の一覧が trunk の
   * 受信で更新されるからである
   */
  const { syncNow: syncTrunkNow } = fileOps;
  const { syncBranchNow } = branchOps;
  const syncNow = useCallback(async () => {
    await syncTrunkNow();
    await syncBranchNow();
    await syncFolders();
  }, [syncTrunkNow, syncBranchNow, syncFolders]);

  const branch = branchOps.activeBranch;
  // fork (保留した競合) は空で始まるのでコミットが無いが、merger を開いて決める入口として押せる
  // (step3 Phase 5 S5-3)。merger の merge が未コミットの解決の編集をコミットしてから取り込む
  const canMerge =
    branchOps.diffState === BRANCH_DIFF_STATE.COMMITTED ||
    (branch !== null && isFork(branch));
  /**
   * 画面に出すシート (step3 Phase 3 S3-2)。branch を開いていれば branch の中身、
   * そうでなければ trunk の姿。編集の宛先 (`syncRecord` / `onSheetChange`) と
   * 再 seed の契機 (`receiveEpoch`) も同じ分かれ目で切り替える
   */
  const viewingBranch = !branchOps.isTrunk && branchOps.branchSheet !== null;
  const shownSheet = viewingBranch
    ? branchOps.branchSheet
    : fileOps.activeSheet;
  /**
   * metagraph なら、graph node を**いまの sheet の一覧**で導き直し、置き場所の無いものを並べる
   * (step3 Phase 4 S4-2b)。自分でシートを足す・消す・名前を変えても、自分の書き込みでは
   * projection し直さないので、読み込んだ時点の graph node のままでは古い
   */
  const isMetagraphView =
    shownSheet !== null &&
    shownSheet !== undefined &&
    sheetKindOf(shownSheet) === METAGRAPH_SHEET_KIND;
  const fileSheets = fileOps.activeFile?.sheets;
  const viewSheet = useMemo(
    () =>
      isMetagraphView && shownSheet && fileSheets
        ? placeDerivedNodes(refreshDerivedNodes(shownSheet, fileSheets))
        : shownSheet,
    [isMetagraphView, shownSheet, fileSheets],
  );
  /**
   * metagraph の描き直しの合図。sheet の一覧 (id と名前) が変わったら canvas を seed し直す —
   * `GraphEditor` は props のシートが変わっただけでは React Flow の state を入れ替えない
   */
  const sheetListKey = (fileSheets ?? [])
    .map((s) => `${s.id}:${s.name}`)
    .join('|');
  const metagraphEpoch = useChangeCounter(isMetagraphView ? sheetListKey : '');
  /**
   * 表示している branch。**開いている File とシートのものに限る** — File を開き替えた直後の
   * 1 回の描画では、branch の state はまだ前の File のものが残っている (リセットは effect)。
   * それをアドレスに入れると、タブが「別の File の branch」を指してしまう
   */
  const viewedBranchId: BranchId | null =
    viewingBranch &&
    branch &&
    branch.trunkFileId === fileOps.activeFile?.id &&
    branch.sheetId === fileOps.activeSheetId
      ? branch.id
      : null;
  /**
   * いま見ているもののアドレス (step3 Phase 3 S3-2)。タブはこれを並べて持つ。
   * `GraphEditor` の作り直しと undo の履歴の置き場は、このアドレスの同一性 (`addressKey`) で決める
   */
  const viewAddress: GraphViewAddress | null =
    fileOps.activeFile && fileOps.activeSheetId
      ? {
          fileId: fileOps.activeFile.id,
          sheetId: fileOps.activeSheetId,
          branchId: viewedBranchId,
          cut: HEAD_CUT,
        }
      : null;

  const viewKey = viewAddress ? addressKey(viewAddress) : null;

  // merger (step3 Phase 5)。merge 後の pane は branch を開いた画面の仕組みの上で、描くシートだけを
  // 「trunk の最新 + branch」に差し替える。編集は branch の tap が branch の op-log に積む (Q1)
  const mergerTab = currentTab?.merger;
  const mergerBranch = mergerTab
    ? [...branchOps.sheetBranches.values()]
        .flat()
        .find((b) => b.id === mergerTab.branchId)
    : undefined;
  const merger = useMergerSnapshot(mergerBranch, mergerTab?.startedAt);
  const isMergerResult =
    mergerTab !== undefined && viewedBranchId === mergerTab.branchId;
  const editorSheet =
    isMergerResult && merger?.snapshot.result ? merger.snapshot.result : null;
  // merger の merge 後から branch 自身の表示に戻ったら、branch を op-log から組み直す。merger と
  // branch のタブは同じ branch を指すので、タブを移っても branch は選び直されず、merge 後で積んだ
  // 解決の編集 (と merge の後の状態) が branch の画面に出ない (step3 Phase 5 の実機で発覚)
  const wasMergerResult = useRef(false);
  const { reloadBranch } = branchOps;
  useEffect(() => {
    if (wasMergerResult.current && !isMergerResult) reloadBranch();
    wasMergerResult.current = isMergerResult;
  }, [isMergerResult, reloadBranch]);
  /** いまの競合に残っているチェックだけを見せる (merge 先が進んで消えた競合のチェックは捨てる, S5-2) */
  const mergerChecked = carryChecks(
    mergerTab?.checked ?? [],
    merger?.snapshot.conflicts ?? [],
  );
  const [mergerBusy, setMergerBusy] = useState(false);
  const { mergeResolved } = branchOps;
  /** merger の merge (Q3)。済んだらタブを閉じる */
  const mergeFromMerger = useCallback(
    async (comment: string) => {
      if (!mergerBranch || !currentTab) return;
      setMergerBusy(true);
      try {
        await mergeResolved(mergerBranch, comment);
        tabs.close(currentTab.id);
      } finally {
        setMergerBusy(false);
      }
    },
    [mergerBranch, currentTab, mergeResolved, tabs],
  );

  /**
   * metagraph の graph node への操作をシートの操作に回す (step3 Phase 4 S4-2b)。シートの削除は
   * 中身ごと消えて undo で戻せないので、確認を挟む
   */
  const {
    handleDeleteSheet,
    handleSaveSheetSettings,
    setActiveFile: setFileState,
  } = fileOps;
  const metagraphTransform = useCallback(
    (event: GraphEvent): GraphEvent | null => {
      const sheetOf = (nodeId: NodeId) => {
        const value = viewSheet?.nodes.find((n) => n.id === nodeId)
          ?.properties?.[DERIVED_FROM_SHEET_PROPERTY];
        return typeof value === 'string' ? (value as SheetId) : undefined;
      };
      const { rest, intents } = splitMetagraphEvent(event, sheetOf);
      for (const intent of intents) {
        const target = fileSheets?.find((s) => s.id === intent.sheetId);
        if (!target) continue;
        if (intent.kind === 'renameSheet') {
          handleSaveSheetSettings(
            target.id,
            intent.name,
            target.description ?? '',
          );
          continue;
        }
        void new Promise<boolean>((resolve) =>
          setConfirmState({
            message: `Sheet「${target.name}」を削除しますか？\n中身もすべて削除されます。`,
            resolve,
            confirmLabel: '削除',
            danger: true,
          }),
        ).then((ok) => {
          if (ok) void handleDeleteSheet(target.id);
        });
      }
      return rest;
    },
    [viewSheet, fileSheets, handleDeleteSheet, handleSaveSheetSettings],
  );
  /** metagraph の graph node の口: 開く (Q6) と、足す (シートを作り、その graph node を置いた所に置く) */
  const metagraphSheetId = isMetagraphView ? shownSheet?.id : undefined;
  const metagraphFileId = fileOps.activeFile?.id;
  const { syncRecord: trunkRecord } = fileOps;
  const metagraphGraphNodes = useMemo(
    () => ({
      onOpen: (sheetId: SheetId) => {
        if (!metagraphFileId) return;
        openTab({
          fileId: metagraphFileId,
          sheetId,
          branchId: null,
          cut: HEAD_CUT,
        });
      },
      onAdd: (position: { x: number; y: number }) => {
        const sheetId = addSheet({ open: false });
        if (!sheetId || !metagraphSheetId) return;
        const nodeId = derivedNodeIdOf(sheetId);
        // 置いた所を graph node の位置として積む (導出 node への node.setLayout は畳み込みが受ける)
        trunkRecord(
          {
            ...makeEventBase('layout'),
            type: 'NODE_MOVED',
            nodeId,
            from: position,
            to: position,
          },
          metagraphSheetId,
        );
        setFileState((file) =>
          file
            ? {
                ...file,
                sheets: file.sheets.map((s) =>
                  s.id === metagraphSheetId
                    ? {
                        ...s,
                        layouts: [
                          ...(s.layouts ?? []),
                          { nodeId, x: position.x, y: position.y },
                        ],
                      }
                    : s,
                ),
              }
            : file,
        );
      },
    }),
    [
      metagraphFileId,
      openTab,
      addSheet,
      metagraphSheetId,
      trunkRecord,
      setFileState,
    ],
  );
  // 描いているシートに当てた template の実体 (step3 Phase 4 S4-1b)。template graph の切断面は
  // op-log を読んで解決する
  const viewTemplates = useResolvedTemplates(
    fileOps.activeFile?.id ?? null,
    viewSheet?.templateIds,
  );
  // 左右のサイドバーの幅と開閉 (S3-4b)。端末ごとの好みなので localStorage に置く
  // 画面の幅の段 (visual language §9.2)。狭い段ではサイドバーを重ね、ヘッダを記号だけにする
  const viewportTier = useViewportTier();
  const sidePanels = useSidePanels(viewportTier);
  // 狭い画面で左サイドバーからグラフを選んだら、重ねていた左サイドバーを退ける。
  // 選んだものを見るために開いたのだから、覆ったままにしない
  const closeLeftOnPick = sidePanels.left.presentation.dismissOnOutside;
  const { close: closeSidePanel } = sidePanels;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 開いたグラフが変わったときだけ退ける
  useEffect(() => {
    if (closeLeftOnPick) closeSidePanel('left');
  }, [viewKey]);
  // ヘッダが開閉する窓と、canvas の口・選択の写し (step3 Phase 3 S3-4a)
  const panels = useGraphPanels(viewKey);
  /**
   * merger の選択の連動 (S5-1b)。選択の正は merge 後の canvas (React Flow) で、見るだけの pane で押した
   * 要素はそこへも選ばせる。merge 後に居ない要素 (消された) を押したときは、押した id を覚えて印にする
   */
  const [mergerPicks, setMergerPicks] = useState<readonly string[]>([]);
  const mergerSelected = new Set<string>([
    ...(panels.selection ? [panels.selection.id] : []),
    ...mergerPicks,
  ]);
  /** 押した要素を選ぶ。⌘ / Ctrl / Shift を押しながらなら足し引きする (複数を一斉に取り込む, 仕様) */
  const pickInMerger = (id: string, additive: boolean) => {
    const next = additive
      ? mergerPicks.includes(id)
        ? mergerPicks.filter((p) => p !== id)
        : [...mergerPicks, id]
      : [id];
    setMergerPicks(next);
    panels.controls?.select(next);
  };
  /**
   * 「取り込む」のメニュー (S5-1c)。右クリックした要素が選ばれていれば選んだもの全部、そうでなければ
   * その要素だけを対象にする
   */
  const [takeMenu, setTakeMenu] = useState<{
    at: { x: number; y: number };
    from: 'source' | 'target';
    ids: readonly string[];
  } | null>(null);
  const openTakeMenu =
    (from: 'source' | 'target') => (id: string, at: { x: number; y: number }) =>
      setTakeMenu({
        at,
        from,
        ids: mergerPicks.includes(id) ? mergerPicks : [id],
      });
  /** merge 後を、元 / 先の pane の姿に揃える (Q9)。merge 後の canvas で dispatch するので undo できる */
  const takeIntoResult = () => {
    const pane = takeMenu ? merger?.snapshot[takeMenu.from] : undefined;
    const result = merger?.snapshot.result;
    if (takeMenu && pane && result) {
      panels.controls?.apply(alignToPane(result, pane, takeMenu.ids));
    }
    setTakeMenu(null);
  };
  const mergerConflictTargets = conflictTargets(
    merger?.snapshot.conflicts ?? [],
  );
  /** 見るだけの pane の印。差分は互いとの差分 (元は先と、先は元と比べる) */
  const mergerMarksFor =
    (other: Sheet | undefined) =>
    (sheet: Sheet): PreviewMarks => ({
      ...(other
        ? diffMarks(other, sheet)
        : {
            addedNodes: new Set(),
            updatedNodes: new Set(),
            addedEdges: new Set(),
            updatedEdges: new Set(),
          }),
      conflicts: mergerConflictTargets,
      selected: mergerSelected,
    });
  /** merge 後の差分の色は merge 先との差分 (branch 自身の分岐点との差分ではない) */
  const mergerResultMarks =
    isMergerResult && merger?.snapshot.target && merger.snapshot.result
      ? diffMarks(merger.snapshot.target, merger.snapshot.result)
      : null;
  const readOnly = fileOps.obligation?.fileId === fileOps.activeFile?.id;
  /**
   * 開いている branch の状態と操作 (ヘッダに出す)。merge 済みでも出す — 続けて編集・コミット
   * できる (merge 後の差分の起点は ANA-119 S6)
   */
  const headerBranch: HeaderBranch | null =
    // merger のタブでは出さない — merge は conflict list から行う
    !currentTab?.merger &&
    !branchOps.isTrunk &&
    branch &&
    (branch.status === BRANCH_STATUS.OPEN ||
      branch.status === BRANCH_STATUS.MERGED)
      ? {
          name: branch.name,
          merged: branch.status === BRANCH_STATUS.MERGED,
          pendingCount: branchOps.pendingChanges.length,
          canMerge,
          onCommit: () => branchOps.setCommitDialogOpen(true),
          onMerge: () => branchOps.handleMergeBranch(branch),
        }
      : null;

  const { close: closeTab, closeWhere, retarget } = tabs;
  const tabControls = useMemo(
    () => ({ open: openTab, close: closeTab, closeWhere, retarget }),
    [openTab, closeTab, closeWhere, retarget],
  );
  useTabNavigation({
    tab: currentTab,
    viewed: {
      fileId: fileOps.activeFile?.id ?? null,
      sheetId: fileOps.activeSheetId,
      branchId: viewedBranchId,
    },
    activeFile: fileOps.activeFile,
    sheetBranches: branchOps.sheetBranches,
    openFile: fileOps.openFile,
    selectSheet: handleSelectSheet,
    selectBranch: branchOps.handleSelectBranch,
    tabs: tabControls,
  });

  /**
   * 背後のタブの File も同期を続ける (Q4)。前に出ている File は tap が持つので除く。
   * 並びが変わるたびに丸ごと宣言し直す (置き場は宣言の差だけを動かす)
   */
  const { holdBackground } = fileOps;
  const backgroundFileIds = openFileIds(tabs.state).filter(
    (id) => id !== fileOps.activeFile?.id,
  );
  const backgroundKey = backgroundFileIds.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: 並びの中身 (backgroundKey) が変わったときだけ宣言し直す
  useEffect(
    () => holdBackground(backgroundFileIds),
    [holdBackground, backgroundKey],
  );

  /**
   * サイドバーでシート・branch を選ぶ = そのアドレスを開く (同じアドレスのタブがあればそこへ, Q2)。
   * サイドバーに並ぶシートは開いている File のものだけである
   */
  const activeFileId = fileOps.activeFile?.id ?? null;
  const openSheetTab = useCallback(
    (sheetId: SheetId, branchId: BranchId | null, { newTab }: OpenOptions) => {
      if (!activeFileId) return;
      // ⌘ / Ctrl で選んだときだけ、同じアドレスのタブがあっても新しく足す (Q2 の明示の操作)
      openTab(
        { fileId: activeFileId, sheetId, branchId, cut: HEAD_CUT },
        { forceNew: newTab },
      );
    },
    [activeFileId, openTab],
  );

  /**
   * タブの名前。File の名前は一覧から、シートと branch の名前は**見たことのあるもの**から引く —
   * 背後のタブの File は開いていないので、シートの名前が手元に無い。見たことが無ければ出さない
   */
  const seenNamesRef = useRef(new Map<string, string>());
  for (const s of fileOps.activeFile?.sheets ?? [])
    seenNamesRef.current.set(s.id, s.name);
  for (const list of branchOps.sheetBranches.values())
    for (const b of list) seenNamesRef.current.set(b.id, b.name);
  const addressLabelOf = (address: GraphViewAddress) => {
    const { fileId, sheetId, branchId } = address;
    const names = seenNamesRef.current;
    const fileName = fileOps.files.find((f) => f.id === fileId)?.name ?? '';
    const sheetName = names.get(sheetId);
    const base = sheetName ? `${fileName} / ${sheetName}` : fileName;
    return branchId ? `${base} (⎇ ${names.get(branchId) ?? ''})` : base;
  };
  /** multiple のタブは pane の名前を並べる */
  const tabLabelOf = (tab: Tab) =>
    tab.merger
      ? `merge: ${addressLabelOf(tab.panes[MERGER_PANE.result] as GraphViewAddress)}`
      : tab.panes.map(addressLabelOf).join(' | ');

  /**
   * 並べられるもの (multiple モードの開発用の入口, Q6)。開いている**他のタブ**のアクティブな
   * pane のアドレス。開発ビルドのときだけ出す
   */
  const paneCandidates = devPanesEnabled()
    ? tabs.state.tabs
        .filter((t) => t.id !== currentTab?.id)
        .map((t) => {
          const address = tabAddress(t);
          return {
            label: addressLabelOf(address),
            onAdd: () => tabs.addPane(address),
          };
        })
    : undefined;

  /** アクティブな pane の中身 (single ならボディそのもの) */
  const activeBody = (
    <>
      {fileOps.activeFile && viewSheet && viewAddress ? (
        // 画像 blob の由来を降ろす (step2 Phase 2 S5)。**`GraphEditor` の props には
        // 足さない** — `ImageNode` は React Flow が描くので props が届かず、
        // 途中の層はこの値に用が無い (`blobOriginContext`)
        // 再参加した後は, 同期が済むまで読み取り専用にする (step2 Phase 2 S6)。
        // 頼んで守られなかった場合に壊れるのは相手なので, 頼まずに止める
        // 描画の例外はグラフの中に留める (#290)。グラフを替えたら知らせも消える (key)
        <ErrorBoundary
          key={addressKey(viewAddress)}
          label={BOUNDARY_LABELS.graph}
        >
          <ReadOnlyProvider value={readOnly}>
            <BlobOriginProvider value={fileOps.originOf}>
              <GraphEditor
                key={addressKey(viewAddress)}
                graphKey={addressKey(viewAddress)}
                undoStateMap={undoStateMapRef}
                sheet={editorSheet ?? viewSheet}
                fileId={fileOps.activeFile.id}
                fileName={fileOps.activeFile.name}
                onSheetChange={
                  isMergerResult
                    ? // merger の後の姿は「trunk + branch」なので branch 自身の表示に戻さない。
                      // 編集そのものは branch の tap が op-log に積む
                      ignoreSheetChange
                    : viewingBranch
                      ? branchOps.onBranchSheetChange
                      : handleSheetChange
                }
                // branch 表示中の編集は branch 専用 op-log へ (p5-4)。trunk 用の tap に
                // 流すと branch の編集が trunk のログに混ざる。
                syncRecord={branchOps.branchSyncRecord ?? fileOps.syncRecord}
                addedNodeIds={
                  mergerResultMarks?.addedNodes ?? branchOps.addedNodeIds
                }
                updatedNodeIds={
                  mergerResultMarks?.updatedNodes ?? branchOps.updatedNodeIds
                }
                addedEdgeIds={
                  mergerResultMarks?.addedEdges ?? branchOps.addedEdgeIds
                }
                updatedEdgeIds={
                  mergerResultMarks?.updatedEdges ?? branchOps.updatedEdgeIds
                }
                deletedNodes={branchOps.deletedNodes}
                deletedEdges={branchOps.deletedEdges}
                deletedNodeLayouts={branchOps.deletedNodeLayouts}
                deletedEdgeLayouts={branchOps.deletedEdgeLayouts}
                // 受信による差し替えの契機。描いている方 (trunk / branch) の受信だけを見る —
                // branch を開いている間の trunk の受信は branch の画面を変えない
                receiveEpoch={
                  (viewingBranch
                    ? branchOps.branchReceiveEpoch
                    : fileOps.receiveEpoch) +
                  metagraphEpoch +
                  // merge 先が進んだら merge 後を seed し直す (O3)。自分の解決の編集では変わらない
                  (isMergerResult ? (merger?.trunkVersion ?? 0) : 0)
                }
                {...(isMetagraphView && {
                  transformEvent: metagraphTransform,
                  graphNodes: metagraphGraphNodes,
                })}
                templates={viewTemplates}
                onControls={panels.setControls}
                onSelectionChange={panels.setSelection}
                onGroupAbilityChange={panels.setGroupAbility}
              />
            </BlobOriginProvider>
          </ReadOnlyProvider>
        </ErrorBoundary>
      ) : fileOps.filesLoaded && fileOps.files.length === 0 ? (
        // 空の状態 (visual language §9.1, #279): 何が無いかと、次に何をすればよいか
        <EmptyState
          icon={Files}
          title="File がありません"
          actions={
            <>
              <Button
                variant="primary"
                icon={FilePlus}
                onClick={() => void fileOps.handleCreate()}
              >
                File を作る
              </Button>
              <Button
                icon={FileUp}
                onClick={() => emptyImportRef.current?.click()}
              >
                import
              </Button>
              {atprotoSession && (
                <Button
                  icon={UserPlus}
                  onClick={() => setParticipateOpen(true)}
                >
                  参加コードで参加する
                </Button>
              )}
              <input
                ref={emptyImportRef}
                type="file"
                accept=".conversensus"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  const result = await readImportFile(file);
                  if (result.ok) fileOps.handleImportFile(result.data);
                  else
                    await new Promise<void>((resolve) =>
                      setAlertState({ message: result.message, resolve }),
                    );
                }}
              />
            </>
          }
        >
          {EMPTY_FILES_NOTE}
        </EmptyState>
      ) : (
        <EmptyState icon={PanelLeft} title="File を開いてください">
          左のサイドバーで File を選ぶと、その Sheet が開きます。
        </EmptyState>
      )}
      {/* ボディ内の property editor (仕様: ヘッダで on にしていれば、選択している要素に
              対して出す)。右サイドバーのものと併用する */}
      {viewAddress && panels.propertyOpen && panels.selection && (
        <PropertyEditor
          title={panels.selection.title}
          rows={propertyRows(panels.selection.properties)}
          addable={panels.selection.addable}
          onSet={(name, value) => panels.controls?.setProperty(name, value)}
          onRemove={(name) => panels.controls?.setProperty(name, undefined)}
          readOnly={readOnly}
          onClose={panels.closeProperty}
        />
      )}
      {viewSheet && panels.searchOpen && (
        <SearchPanel
          onSearch={(query, caseSensitive) =>
            panels.search(viewSheet, query, caseSensitive)
          }
          hits={panels.searchHits}
          searched={panels.searched}
          onReveal={(hit) => panels.controls?.reveal(hit)}
          onClose={panels.closeSearch}
        />
      )}
    </>
  );

  return (
    // 重ねて出すサイドバー (狭い画面) の基準にするので position を持たせる
    <div style={{ display: 'flex', height: '100vh', position: 'relative' }}>
      <SidePanel
        side="left"
        label={BOUNDARY_LABELS.leftSidebar}
        state={sidePanels.left.state}
        mode={sidePanels.left.presentation.mode}
        onDismiss={
          sidePanels.left.presentation.dismissOnOutside
            ? () => sidePanels.close('left')
            : undefined
        }
        onResize={(width) => sidePanels.setWidth('left', width)}
        onToggle={() => sidePanels.toggle('left')}
      >
        <ErrorBoundary label={BOUNDARY_LABELS.leftSidebar}>
          <Sidebar
            files={fileOps.files}
            folders={folderProps}
            activeFile={fileOps.activeFile}
            activeSheetId={fileOps.activeSheetId}
            expandedFileIds={fileOps.expandedFileIds}
            newFileName={fileOps.newFileName}
            popupTarget={fileOps.popupTarget}
            sharing={fileOps.sharing}
            onNewFileNameChange={fileOps.setNewFileName}
            onCreateFile={fileOps.handleCreate}
            onImportFile={fileOps.handleImportFile}
            onToggleExpand={fileOps.toggleExpand}
            onOpenFile={fileOps.openFile}
            onSelectSheet={(sheetId, options) =>
              openSheetTab(sheetId, null, options)
            }
            onAddSheet={handleAddSheet}
            onAddKindSheet={handleAddKindSheet}
            onAddSeedTemplate={handleAddSeedTemplate}
            onSetPopupTarget={fileOps.setPopupTarget}
            onSaveFileSettings={fileOps.handleSaveFileSettings}
            onDeleteFile={fileOps.handleDeleteFile}
            onExportFile={fileOps.handleExportFile}
            onSaveSheetSettings={fileOps.handleSaveSheetSettings}
            onDeleteSheet={fileOps.handleDeleteSheet}
            sheetBranches={branchOps.sheetBranches}
            activeBranchId={branchOps.activeBranch?.id ?? null}
            onSelectBranch={(sheetId, selected, options) =>
              openSheetTab(sheetId, selected?.id ?? null, options)
            }
            onCreateBranch={branchOps.handleCreateBranch}
            onMergeBranch={branchOps.handleMergeBranch}
            onCloseBranch={branchOps.handleCloseBranch}
            onDeleteBranch={branchOps.handleDeleteBranch}
            atprotoSession={atprotoSession}
            localOnlyCount={localOnlyCount}
            onAtprotoLogin={() => setLoginDialogOpen(true)}
            onAtprotoLogout={() => void handleLogout()}
            remoteQueue={remoteQueue}
            onSyncNow={syncNow}
            // 名簿は DID 単位なので、ログイン中でなければ何も出せない
            onOpenInvitation={
              atprotoSession
                ? (fileId) => {
                    setInvitationFileId(fileId as FileId);
                    participation.refresh(fileId as FileId);
                  }
                : undefined
            }
            onOpenParticipate={
              atprotoSession ? () => setParticipateOpen(true) : undefined
            }
          />
        </ErrorBoundary>
      </SidePanel>
      {invitationFileId && (
        <InvitationDialog
          fileName={
            fileOps.files.find((f) => f.id === invitationFileId)?.name ?? ''
          }
          rows={participation.state.rows}
          unreadable={participation.state.unreadable}
          rejectedNote={participation.state.rejectedNote}
          labelOf={participation.state.labelOf}
          onOpenHistory={setHistoryDid}
          busy={participation.state.busy}
          error={participation.state.error}
          codeFor={(did) => participation.codeFor(invitationFileId, did)}
          onGenerate={(handles) =>
            participation.invite(invitationFileId, handles)
          }
          onAction={(action, did) =>
            participation.act(invitationFileId, action, did)
          }
          onClose={() => {
            setInvitationFileId(null);
            participation.reset();
          }}
        />
      )}
      {historyDid && (
        <ParticipationHistoryDialog
          label={participation.state.labelOf(historyDid)}
          rounds={participationRounds(
            participation.state.history.get(historyDid) ?? [],
          )}
          labelOf={participation.state.labelOf}
          onClose={() => setHistoryDid(null)}
        />
      )}
      {/* 参加コードを検めるまでは入力、検めたら承認の確認 (仕様の 2 枚の図) */}
      {participateOpen && participation.state.preview && (
        <AcceptInvitationDialog
          preview={participation.state.preview}
          busy={participation.state.busy}
          error={participation.state.error}
          onAccept={() => {
            const preview = participation.state.preview;
            if (!preview) return;
            participation.acceptPreviewed(preview).then((fileId) => {
              // **書けなかったらダイアログを閉じない。**閉じて reset すると
              // エラーが表示される前に消える (2026-09-05 実機で発覚)
              if (!fileId) return;
              setParticipateOpen(false);
              participation.reset();
              // 承認しただけでは手元に File は無い (グラフの batch は 1 件も自分の
              // repo に無い)。ここで立ち上げないと次に開き直すまで出てこない
              void fileOps.discoverParticipating();
            });
          }}
          onClose={participation.clearPreview}
        />
      )}
      {participateOpen && !participation.state.preview && (
        <ParticipateDialog
          busy={participation.state.busy}
          error={participation.state.error}
          onSubmit={(code) => {
            participation.previewCode(code);
          }}
          onCancel={() => {
            setParticipateOpen(false);
            participation.reset();
          }}
        />
      )}
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <TabBar
          tabs={tabs.state.tabs}
          activeId={tabs.state.activeId}
          labelOf={tabLabelOf}
          onActivate={tabs.activate}
          onClose={tabs.close}
        />
        {viewAddress && (
          <GraphHeader
            controls={panels.controls}
            groupAbility={panels.groupAbility}
            searchOpen={panels.searchOpen}
            onToggleSearch={panels.toggleSearch}
            propertyOpen={panels.propertyOpen}
            onToggleProperty={panels.toggleProperty}
            branch={headerBranch}
            paneCandidates={paneCandidates}
            compact={compactHeader(viewportTier)}
          />
        )}
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {currentTab?.merger ? (
            // merger (step3 Phase 5): 上に merge 元・先 (見るだけ)、下に merge 後 (編集)・conflict list (Q7)
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gridTemplateRows: '1fr 1fr',
              }}
            >
              <PaneFrame
                label={`merge 元: ${addressLabelOf(currentTab.panes[MERGER_PANE.source] as GraphViewAddress)} (開いた時点)`}
                active={false}
              >
                <PassivePane
                  address={
                    currentTab.panes[MERGER_PANE.source] as GraphViewAddress
                  }
                  marksFor={mergerMarksFor(merger?.snapshot.target)}
                  onElementClick={pickInMerger}
                  onElementContextMenu={openTakeMenu('source')}
                />
              </PaneFrame>
              <PaneFrame
                label={`merge 先: ${addressLabelOf(currentTab.panes[MERGER_PANE.target] as GraphViewAddress)}`}
                active={false}
              >
                <PassivePane
                  address={
                    currentTab.panes[MERGER_PANE.target] as GraphViewAddress
                  }
                  marksFor={mergerMarksFor(merger?.snapshot.source)}
                  onElementClick={pickInMerger}
                  onElementContextMenu={openTakeMenu('target')}
                />
              </PaneFrame>
              <PaneFrame label="merge 後" active>
                {activeBody}
              </PaneFrame>
              {takeMenu && (
                // 取り込むメニュー。外を押せば閉じる
                // biome-ignore lint/a11y/useKeyWithClickEvents: 外を押して閉じるための幕。Escape はメニュー側で受ける
                // biome-ignore lint/a11y/noStaticElementInteractions: 同上
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 900 }}
                  onClick={() => setTakeMenu(null)}
                >
                  <div
                    role="menu"
                    aria-label="取り込む"
                    style={{
                      position: 'fixed',
                      left: takeMenu.at.x,
                      top: takeMenu.at.y,
                      background: color.bg,
                      border: `1px solid ${color.border}`,
                      borderRadius: radius.md,
                      boxShadow: shadow.dialog,
                      padding: 4,
                      fontSize: font.body,
                    }}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={(e) => {
                        e.stopPropagation();
                        takeIntoResult();
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '4px 8px',
                      }}
                    >
                      merge 後に取り込む ({takeMenu.ids.length})
                    </button>
                  </div>
                </div>
              )}
              <ConflictList
                conflicts={merger?.snapshot.conflicts ?? []}
                labelOf={(target) =>
                  merger?.snapshot.labels.get(target) ?? target
                }
                checked={mergerChecked}
                onToggle={(key) =>
                  tabs.setMergerChecks(
                    currentTab.id,
                    mergerChecked.includes(key)
                      ? mergerChecked.filter((k) => k !== key)
                      : [...mergerChecked, key],
                  )
                }
                busy={mergerBusy}
                {...(mergerBranch &&
                  isFork(mergerBranch) && {
                    sideLabels: forkSideLabels(
                      mergerBranch,
                      participation.state.labelOf,
                    ),
                  })}
                onMerge={(comment) => void mergeFromMerger(comment)}
              />
            </div>
          ) : currentTab && isMultiple(currentTab) ? (
            // multiple モード (S3-5)。編集できるのはアクティブな pane だけで、ほかは見るだけ
            currentTab.panes.map((pane, i) => {
              const label = addressLabelOf(pane);
              const isActive = i === currentTab.active;
              return (
                <PaneFrame
                  // biome-ignore lint/suspicious/noArrayIndexKey: 同じアドレスの pane を並べられるので、位置が識別子になる
                  key={i}
                  label={label}
                  active={isActive}
                  onActivate={() => tabs.activatePane(i)}
                  onClose={() => tabs.closePane(currentTab.id, i)}
                >
                  {isActive ? activeBody : <PassivePane address={pane} />}
                </PaneFrame>
              );
            })
          ) : (
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              {activeBody}
            </div>
          )}
        </div>
      </main>
      <SidePanel
        side="right"
        label={BOUNDARY_LABELS.rightSidebar}
        state={sidePanels.right.state}
        mode={sidePanels.right.presentation.mode}
        onDismiss={
          sidePanels.right.presentation.dismissOnOutside
            ? () => sidePanels.close('right')
            : undefined
        }
        onResize={(width) => sidePanels.setWidth('right', width)}
        onToggle={() => sidePanels.toggle('right')}
      >
        <ErrorBoundary label={BOUNDARY_LABELS.rightSidebar}>
          <RightSidebar
            selection={viewAddress ? panels.selection : undefined}
            onSetProperty={(name, value) =>
              panels.controls?.setProperty(name, value)
            }
            readOnly={readOnly}
          />
        </ErrorBoundary>
      </SidePanel>
      {templateDialogOpen && (
        <TemplateApplyDialog
          templateGraphs={templateGraphs}
          onSubmit={(selected) => void applyTemplateGraphs(selected)}
          onCancel={() => setTemplateDialogOpen(false)}
        />
      )}
      {branchOps.commitDialogOpen && (
        <CommitDialog
          changes={branchOps.pendingChanges}
          onCommit={branchOps.handleCommit}
          onCancel={() => branchOps.setCommitDialogOpen(false)}
        />
      )}
      {confirmState && (
        <ConfirmDialog
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          cancelLabel={confirmState.cancelLabel}
          danger={confirmState.danger}
          onConfirm={() => {
            confirmState.resolve(true);
            setConfirmState(null);
          }}
          onCancel={() => {
            confirmState.resolve(false);
            setConfirmState(null);
          }}
        />
      )}
      {inputState && (
        <InputDialog
          message={inputState.message}
          onSubmit={(value) => {
            inputState.resolve(value);
            setInputState(null);
          }}
          onCancel={() => {
            inputState.resolve('');
            setInputState(null);
          }}
        />
      )}
      {alertState && (
        <AlertDialog
          message={alertState.message}
          onClose={() => {
            alertState.resolve();
            setAlertState(null);
          }}
        />
      )}
      {/*
        通知は 2 系列ある (競合 / 上書きの報告, Phase 3 T8)。**同じ隅に出るので
        積む** — どちらも自分では位置を持たず、重ならないことはここで保証する。
        中身が無ければ両方 null なので、この箱は 0 の大きさになる
      */}
      <div
        style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          zIndex: NOTICE_Z_INDEX,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 8,
        }}
      >
        <ConflictNotice
          conflicts={conflictNotice.conflicts}
          labelOf={conflictLabelOf}
          forkCount={conflictNotice.forkCount ?? 0}
          arrivedForks={arrivedForks}
          onOpenMerger={handleOpenMerger}
          onClose={closeConflictNotice}
        />
        <OverwriteNotice
          reports={overwriteNotice.reports}
          labelOf={overwriteLabelOf}
          actorLabelOf={participation.state.labelOf}
          onDismiss={dismissOverwrites}
        />
      </div>
      {loginDialogOpen && (
        <AtprotoLoginDialog
          needsPassword={authNeedsPassword()}
          onLogin={async (handle, password) => {
            await atprotoLogin(handle, password);
            setLoginDialogOpen(false);
          }}
          onCancel={() => setLoginDialogOpen(false)}
        />
      )}
    </div>
  );
}
