import type { GraphFile, Sheet, SheetId } from '@conversensus/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertDialog } from './AlertDialog';
import { AtprotoLoginDialog } from './AtprotoLoginDialog';
import {
  BRANCH_STATUS,
  sheets,
  syncBranchSheetToAtproto,
  TRUNK_PREFIX,
} from './atproto';
import { CommitDialog } from './CommitDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { makeEventBase } from './events/GraphEvent';
import { GraphEditor } from './GraphEditor';
import { useActor } from './hooks/useActor';
import { useAtprotoSession } from './hooks/useAtprotoSession';
import { useBranchOperations } from './hooks/useBranchOperations';
import type { UndoState } from './hooks/useEventStore';
import { useFileSheetOperations } from './hooks/useFileSheetOperations';
import { useRemoteSyncQueue } from './hooks/useRemoteSyncQueue';
import { InputDialog } from './InputDialog';
import { FLOATING_UI_Z_INDEX } from './SettingsPopup';
import { Sidebar } from './Sidebar';
import { generateId } from './uuid';

const AUTOSAVE_DELAY = 1000; // ms

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

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // File & sheet operations
  const fileOps = useFileSheetOperations({
    setConfirmState,
    setAlertState,
    remoteQueue,
    actor,
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
  });

  // Cross-domain wired callbacks
  const handleChange = useCallback(
    (updated: GraphFile) => {
      fileOps.setActiveFile(updated);
      if (saveTimer.current) clearTimeout(saveTimer.current);

      const branch = branchOps.activeBranch;
      const sheetId = fileOps.activeSheetId;

      saveTimer.current = setTimeout(async () => {
        if (
          branch &&
          branch.name !== TRUNK_PREFIX &&
          sheetId &&
          (branch.status === BRANCH_STATUS.OPEN ||
            branch.status === BRANCH_STATUS.MERGED)
        ) {
          const sheet = updated.sheets.find((s) => s.id === sheetId);
          if (!sheet) return;
          try {
            const sheetRef = await sheets.ref(sheetId);
            await syncBranchSheetToAtproto(sheet, sheetRef, branch.id);
          } catch (err) {
            console.warn('[branch] auto-save failed:', err);
          }
        } else {
          await fileOps.persistFile(updated);
        }
      }, AUTOSAVE_DELAY);
    },
    [
      fileOps.setActiveFile,
      fileOps.persistFile,
      fileOps.activeSheetId,
      branchOps.activeBranch,
    ],
  );

  const handleSelectSheet = useCallback(
    (sheetId: SheetId) => {
      fileOps.setActiveSheetId(sheetId);
      branchOps.resetBranchState();
    },
    [fileOps.setActiveSheetId, branchOps.resetBranchState],
  );

  const handleAddSheet = useCallback(async () => {
    if (!fileOps.activeFile) return;
    const newSheet: Sheet = {
      id: generateId() as SheetId,
      name: `Sheet ${fileOps.activeFile.sheets.length + 1}`,
      nodes: [],
      edges: [],
    };
    const updated: GraphFile = {
      ...fileOps.activeFile,
      sheets: [...fileOps.activeFile.sheets, newSheet],
    };
    // op-log へ sheet.create を emit する (dual-write, W3c1)
    fileOps.syncRecord({
      ...makeEventBase('file'),
      type: 'SHEET_CREATED',
      sheetId: newSheet.id,
      name: newSheet.name,
    });
    fileOps.setActiveSheetId(newSheet.id);
    if (!branchOps.isTrunk) branchOps.setBranchBases(newSheet);
    await fileOps.persistFile(updated);
  }, [
    fileOps.activeFile,
    fileOps.setActiveSheetId,
    fileOps.persistFile,
    fileOps.syncRecord,
    branchOps.isTrunk,
    branchOps.setBranchBases,
  ]);

  // ATProto セッション確立後にファイル一覧を同期
  const { loadAtprotoFiles } = fileOps;
  useEffect(() => {
    if (atprotoSession) {
      loadAtprotoFiles();
    }
  }, [atprotoSession, loadAtprotoFiles]);

  // Save timer cleanup
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const branch = branchOps.activeBranch;

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
            syncRecord={fileOps.syncRecord}
            addedNodeIds={branchOps.addedNodeIds}
            updatedNodeIds={branchOps.updatedNodeIds}
            addedEdgeIds={branchOps.addedEdgeIds}
            updatedEdgeIds={branchOps.updatedEdgeIds}
            deletedNodes={branchOps.deletedNodes}
            deletedEdges={branchOps.deletedEdges}
            deletedNodeLayouts={branchOps.deletedNodeLayouts}
            deletedEdgeLayouts={branchOps.deletedEdgeLayouts}
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
              {branchOps.pendingOps.length > 0
                ? ` (${branchOps.pendingOps.length} 変更)`
                : ''}
            </span>
            <button
              type="button"
              onClick={() => branchOps.setCommitDialogOpen(true)}
              disabled={branchOps.pendingOps.length === 0}
              style={{
                padding: '6px 16px',
                fontSize: 13,
                background:
                  branchOps.pendingOps.length > 0 ? '#4f6ef7' : '#ccc',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor:
                  branchOps.pendingOps.length > 0 ? 'pointer' : 'not-allowed',
              }}
            >
              コミット
            </button>
            <button
              type="button"
              onClick={() => branchOps.handleMergeBranch(branch)}
              disabled={
                branchOps.pendingOps.length > 0 ||
                branchOps.newCommitsSinceMerge === 0
              }
              style={{
                padding: '6px 16px',
                fontSize: 13,
                background:
                  branchOps.pendingOps.length === 0 &&
                  branchOps.newCommitsSinceMerge > 0
                    ? '#f97316'
                    : '#ccc',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor:
                  branchOps.pendingOps.length === 0 &&
                  branchOps.newCommitsSinceMerge > 0
                    ? 'pointer'
                    : 'not-allowed',
              }}
            >
              merge ↑
            </button>
          </div>
        )}
      {branchOps.commitDialogOpen && (
        <CommitDialog
          operations={branchOps.pendingOps}
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
