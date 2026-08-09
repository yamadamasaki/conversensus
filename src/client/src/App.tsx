import {
  BRANCH_STATUS,
  type GraphFile,
  type Sheet,
  type SheetId,
} from '@conversensus/shared';
import { useCallback, useRef, useState } from 'react';
import { AlertDialog } from './AlertDialog';
import { AtprotoLoginDialog } from './AtprotoLoginDialog';
import { TRUNK_PREFIX } from './atproto';
import { CommitDialog } from './CommitDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { makeEventBase } from './events/GraphEvent';
import { GraphEditor } from './GraphEditor';
import { useActor } from './hooks/useActor';
import { useAtprotoSession } from './hooks/useAtprotoSession';
import {
  BRANCH_DIFF_STATE,
  useBranchOperations,
} from './hooks/useBranchOperations';
import type { UndoState } from './hooks/useEventStore';
import { useFileSheetOperations } from './hooks/useFileSheetOperations';
import { useRemoteSyncQueue } from './hooks/useRemoteSyncQueue';
import { InputDialog } from './InputDialog';
import { FLOATING_UI_Z_INDEX } from './SettingsPopup';
import { Sidebar } from './Sidebar';
import { generateId } from './uuid';

export default function App() {
  // Dialog state (UI only)
  const [confirmState, setConfirmState] = useState<{
    message: string;
    resolve: (ok: boolean) => void;
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
    login: atprotoLogin,
    logout: atprotoLogout,
  } = useAtprotoSession();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);

  // remote (ATProto) 送信キュー。未ログイン時は null → tap は local-only (W3d5-5)
  const remoteQueue = useRemoteSyncQueue(atprotoSession);

  // batch の操作主体 `<did>#<deviceId>`。端末まで一意にすることで、受信時に因果順序と
  // 重複排除の単位を識別できる (Phase 4d-2)
  const actor = useActor(atprotoSession);

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
    remoteQueue,
    actor,
    isEditingActive,
  });

  // Branch operations
  const branchOps = useBranchOperations({
    activeFile: fileOps.activeFile,
    activeSheetId: fileOps.activeSheetId,
    activeSheet: fileOps.activeSheet,
    onSetActiveFile: fileOps.setActiveFile,
    setConfirmState,
    setInputState,
    setAlertState,
    actor,
    // merge の再スタンプは trunk と同じ発番器で行う (p5-4)
    trunkClock: fileOps.trunkClock,
  });

  // Cross-domain wired callbacks
  //
  // Phase 6 p6-3 / p6-5b: **autosave は trunk・branch とも消えた**。content の編集は
  // op-log tap (GraphEditor → syncRecord、branch 表示中は branch 専用 tap) が編集ごとに
  // 書いており、debounce して別の永続先へ書き戻す経路がもう無い (設計 §3.6 / §3.7)。
  // ここに残るのは画面 state の更新だけである。
  const handleChange = useCallback(
    (updated: GraphFile) => {
      fileOps.setActiveFile(updated);
    },
    [fileOps.setActiveFile],
  );

  const handleSelectSheet = useCallback(
    (sheetId: SheetId) => {
      fileOps.setActiveSheetId(sheetId);
      branchOps.resetBranchState();
    },
    [fileOps.setActiveSheetId, branchOps.resetBranchState],
  );

  const handleAddSheet = useCallback(() => {
    if (!fileOps.activeFile) return;
    // 🔴 シート追加は **trunk のファイルを土台に**行う。branch 表示中の activeFile は
    // 該当シートが branch の内容なので、それを土台にすると branch の内容が trunk へ移る。
    // branch は per-sheet なので、シートを増やす操作は branch を抜けてから行うのが筋
    // (シート切替 `handleSelectSheet` が branch を抜けるのと同じ扱い)。
    const trunkFile = branchOps.isTrunk
      ? fileOps.activeFile
      : (branchOps.resetBranchState() ?? fileOps.activeFile);
    const newSheet: Sheet = {
      id: generateId() as SheetId,
      name: `Sheet ${trunkFile.sheets.length + 1}`,
      nodes: [],
      edges: [],
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
    });
    fileOps.setActiveSheetId(newSheet.id);
    fileOps.updateFileState(updated);
  }, [
    fileOps.activeFile,
    fileOps.setActiveSheetId,
    fileOps.updateFileState,
    fileOps.syncRecord,
    branchOps.isTrunk,
    branchOps.resetBranchState,
  ]);

  // Phase 6 p6-4: セッション確立後の PDS legacy file レコード同期 (`loadAtprotoFiles`)
  // は撤去した。リモートのファイル発見は `useFileSheetOperations` 内の
  // `discoverRemoteFiles` (op-log 経路) に一本化されている (設計 §3.8)。

  const branch = branchOps.activeBranch;
  const canMerge = branchOps.diffState === BRANCH_DIFF_STATE.COMMITTED;

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      <Sidebar
        files={fileOps.files}
        activeFile={fileOps.activeFile}
        activeSheetId={fileOps.activeSheetId}
        expandedFileIds={fileOps.expandedFileIds}
        newFileName={fileOps.newFileName}
        popupTarget={fileOps.popupTarget}
        onNewFileNameChange={fileOps.setNewFileName}
        onCreateFile={fileOps.handleCreate}
        onImportFile={fileOps.handleImportFile}
        onToggleExpand={fileOps.toggleExpand}
        onOpenFile={fileOps.openFile}
        onSelectSheet={handleSelectSheet}
        onAddSheet={handleAddSheet}
        onSetPopupTarget={fileOps.setPopupTarget}
        onSaveFileSettings={fileOps.handleSaveFileSettings}
        onDeleteFile={fileOps.handleDeleteFile}
        onExportFile={fileOps.handleExportFile}
        onSaveSheetSettings={fileOps.handleSaveSheetSettings}
        onDeleteSheet={fileOps.handleDeleteSheet}
        sheetBranches={branchOps.sheetBranches}
        activeBranchId={branchOps.activeBranch?.id ?? null}
        onSelectBranch={branchOps.handleSelectBranch}
        onCreateBranch={branchOps.handleCreateBranch}
        onMergeBranch={branchOps.handleMergeBranch}
        onCloseBranch={branchOps.handleCloseBranch}
        onDeleteBranch={branchOps.handleDeleteBranch}
        atprotoSession={atprotoSession}
        onAtprotoLogin={() => setLoginDialogOpen(true)}
        onAtprotoLogout={atprotoLogout}
        remoteQueue={remoteQueue}
      />
      <main style={{ flex: 1 }}>
        {fileOps.activeFile && fileOps.activeSheetId ? (
          <GraphEditor
            key={`${fileOps.activeSheetId}/${branchOps.activeBranch?.id ?? TRUNK_PREFIX}`}
            graphKey={`${fileOps.activeSheetId}/${branchOps.activeBranch?.id ?? TRUNK_PREFIX}`}
            undoStateMap={undoStateMapRef}
            file={fileOps.activeFile}
            activeSheetId={fileOps.activeSheetId}
            onChange={handleChange}
            // branch 表示中の編集は branch 専用 op-log へ (p5-4)。trunk 用の tap に
            // 流すと branch の編集が trunk のログに混ざる。
            syncRecord={branchOps.branchSyncRecord ?? fileOps.syncRecord}
            addedNodeIds={branchOps.addedNodeIds}
            updatedNodeIds={branchOps.updatedNodeIds}
            addedEdgeIds={branchOps.addedEdgeIds}
            updatedEdgeIds={branchOps.updatedEdgeIds}
            deletedNodes={branchOps.deletedNodes}
            deletedEdges={branchOps.deletedEdges}
            deletedNodeLayouts={branchOps.deletedNodeLayouts}
            deletedEdgeLayouts={branchOps.deletedEdgeLayouts}
            receiveEpoch={fileOps.receiveEpoch}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#999',
            }}
          >
            ファイルを選択するか, 新規作成してください
          </div>
        )}
      </main>
      {!branchOps.isTrunk &&
        branch &&
        (branch.status === BRANCH_STATUS.OPEN ||
          branch.status === BRANCH_STATUS.MERGED) && (
          <div
            style={{
              position: 'fixed',
              bottom: 24,
              right: 24,
              zIndex: FLOATING_UI_Z_INDEX,
              display: 'flex',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: '#555',
                background: '#fff',
                padding: '4px 8px',
                borderRadius: 4,
                border: '1px solid #ddd',
              }}
            >
              ⎇ {branch.name}
              {branch.status === BRANCH_STATUS.MERGED && ' (merged)'}
              {branchOps.pendingChanges.length > 0
                ? ` (${branchOps.pendingChanges.length} 変更)`
                : ''}
            </span>
            <button
              type="button"
              onClick={() => branchOps.setCommitDialogOpen(true)}
              disabled={branchOps.pendingChanges.length === 0}
              style={{
                padding: '6px 16px',
                fontSize: 13,
                background:
                  branchOps.pendingChanges.length > 0 ? '#4f6ef7' : '#ccc',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor:
                  branchOps.pendingChanges.length > 0
                    ? 'pointer'
                    : 'not-allowed',
              }}
            >
              コミット
            </button>
            <button
              type="button"
              onClick={() => branchOps.handleMergeBranch(branch)}
              // merge できるのは「commit 済み」= 未コミットの編集が無く commit が
              // 1 件以上ある状態だけ。画面に出ている差分がそのまま merge の対象になる。
              disabled={!canMerge}
              style={{
                padding: '6px 16px',
                fontSize: 13,
                background: canMerge ? '#f97316' : '#ccc',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: canMerge ? 'pointer' : 'not-allowed',
              }}
            >
              merge ↑
            </button>
          </div>
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
      {loginDialogOpen && (
        <AtprotoLoginDialog
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
