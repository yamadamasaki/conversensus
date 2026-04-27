import type {
  ConversensusFile,
  GraphFile,
  GraphFileListItem,
  Sheet,
  SheetId,
} from '@conversensus/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertDialog } from './AlertDialog';
import {
  createFile,
  exportFile,
  fetchFile,
  fetchFiles,
  importFile,
  removeFile,
  saveFile,
} from './api';
import {
  files as atprotoFilesColl,
  type Branch,
  computeOperations,
  createBranch,
  createCommit,
  createMergeRecord,
  deleteBranchWithRecords,
  fetchBranchesForSheet,
  fetchBranchSheetFromPds,
  fetchCommitsForBranch,
  fetchFileFromAtproto,
  fetchFilesFromAtproto,
  login,
  mergeBranchToTrunk,
  sheets,
  syncBranchSheetToAtproto,
  syncFileToAtproto,
  TRUNK_PREFIX,
  updateBranchStatus,
} from './atproto';
import { CommitDialog } from './CommitDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { GraphEditor } from './GraphEditor';
import { InputDialog } from './InputDialog';
import type { PopupTarget } from './SettingsPopup';
import { Sidebar } from './Sidebar';
import { generateId } from './uuid';

const AUTOSAVE_DELAY = 1000; // ms

/**
 * ローカル開発専用: VITE_ATPROTO_* は Vite がビルド時にバンドルへ展開するため
 * 本番ビルドでは絶対に使用しないこと。import.meta.env.DEV でガード済み。
 * 本番環境ではログイン UI を実装すること。
 */
async function tryAtprotoAutoLogin(): Promise<void> {
  if (!import.meta.env.DEV) return;
  const handle = import.meta.env.VITE_ATPROTO_HANDLE;
  const password = import.meta.env.VITE_ATPROTO_PASSWORD;
  if (!handle || !password) return;
  try {
    await login(handle, password);
    console.info('[atproto] auto-login:', handle);
  } catch (err) {
    console.warn('[atproto] auto-login failed (sync disabled):', err);
  }
}

export default function App() {
  const [files, setFiles] = useState<GraphFileListItem[]>([]);
  const [activeFile, setActiveFile] = useState<GraphFile | null>(null);
  const [activeSheetId, setActiveSheetId] = useState<SheetId | null>(null);
  const [expandedFileIds, setExpandedFileIds] = useState<Set<string>>(
    new Set(),
  );
  const [newFileName, setNewFileName] = useState('');
  const [popupTarget, setPopupTarget] = useState<PopupTarget | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Branch / Commit state
  const [activeBranch, setActiveBranch] = useState<Branch | null>(null);
  const [sheetBranches, setSheetBranches] = useState<Map<string, Branch[]>>(
    new Map(),
  );
  const [newCommitsSinceMerge, setNewCommitsSinceMerge] = useState(0);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);

  // ブラウザ API 代替ダイアログの state
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

  // branch の "commit 前の状態" (pending ops 表示用)
  const [lastCommitBase, setLastCommitBase] = useState<Sheet | null>(null);
  // branch の "作成時点の状態" (diff ハイライト用)
  const [branchOriginalBase, setBranchOriginalBase] = useState<Sheet | null>(
    null,
  );
  // branch URI → 最初に入ったときの状態 (trunk↔branch を行き来しても diff 基点を保持)
  const branchOriginalBaseMap = useRef<Map<string, Sheet>>(new Map());
  // branch 開始前の activeFile (branch 離脱時に trunk 状態を復元するため)
  const preBranchFile = useRef<GraphFile | null>(null);
  // 最新 commit ref (parentCommit チェーン用)
  const latestCommitRef = useRef<{ uri: string; cid: string } | null>(null);

  const isTrunk = !activeBranch || activeBranch.name === 'trunk';

  const activeSheet = useMemo(
    () => activeFile?.sheets.find((s) => s.id === activeSheetId) ?? null,
    [activeFile, activeSheetId],
  );

  // branch モード時: 作成時点との差分ノード/エッジをハイライト
  const [branchDiffNodeIds, branchDiffEdgeIds] = useMemo(() => {
    if (isTrunk || !branchOriginalBase || !activeSheet) {
      return [new Set<string>(), new Set<string>()] as const;
    }
    const ops = computeOperations(branchOriginalBase, activeSheet);
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    for (const op of ops) {
      if ('nodeId' in op) nodeIds.add(op.nodeId);
      else if ('edgeId' in op) edgeIds.add(op.edgeId);
    }
    return [nodeIds, edgeIds] as const;
  }, [isTrunk, branchOriginalBase, activeSheet]);

  const conflictedNodeIds = branchDiffNodeIds;
  const conflictedEdgeIds = branchDiffEdgeIds;

  // 現在の branch での pending operations (前回 commit 以降の未コミット変更)
  const pendingOps = useMemo(() => {
    if (isTrunk || !lastCommitBase || !activeSheet) return [];
    return computeOperations(lastCommitBase, activeSheet);
  }, [isTrunk, lastCommitBase, activeSheet]);

  const handleSelectBranch = useCallback(
    async (sheetId: SheetId, branch: Branch | null) => {
      latestCommitRef.current = null;

      if (!branch || branch.name === 'trunk') {
        // trunk に戻る
        setActiveBranch(branch);
        setLastCommitBase(null);
        setBranchOriginalBase(null);
        setNewCommitsSinceMerge(0);
        if (preBranchFile.current) {
          setActiveFile(preBranchFile.current);
          preBranchFile.current = null;
        }
        return;
      }

      try {
        // branch の状態を PDS から取得
        const branchSheet = await fetchBranchSheetFromPds(branch.id, sheetId);
        const cs = await fetchCommitsForBranch(branch.uri);

        // trunk 状態を保存 (branch 離脱時に復元)
        preBranchFile.current = activeFile ?? null;

        // diff baseline の設定:
        // merged branch は trunk が変わっている可能性があるため現在の trunk を使用
        // open branch は初回入場時の状態を記憶し trunk↔branch を行き来しても保持
        let originalBase: typeof branchSheet;
        if (branch.status === 'merged') {
          originalBase = await fetchBranchSheetFromPds(TRUNK_PREFIX, sheetId);
        } else {
          const storedOriginal = branchOriginalBaseMap.current.get(branch.uri);
          originalBase = storedOriginal ?? branchSheet;
          if (!storedOriginal) {
            branchOriginalBaseMap.current.set(branch.uri, originalBase);
          }
        }
        setBranchOriginalBase(originalBase);

        // pending ops の基点を設定
        setLastCommitBase(branchSheet);

        // 最新 commit の ref を設定
        if (cs.length > 0) {
          const last = cs[cs.length - 1];
          latestCommitRef.current = { uri: last.uri, cid: last.cid };
        }

        // activeFile を branch 状態に更新
        if (activeFile) {
          setActiveFile({
            ...activeFile,
            sheets: activeFile.sheets.map((s) =>
              s.id === sheetId ? branchSheet : s,
            ),
          });
        }

        // merged branch に入ったとき: 新しいコミットはまだないので 0 に初期化
        // open branch に入ったとき: 既存コミット数が「未 merge のコミット数」
        setNewCommitsSinceMerge(branch.status === 'merged' ? 0 : cs.length);
        setActiveBranch(branch);
      } catch (err) {
        console.warn('[branch] select failed:', err);
      }
    },
    [activeFile],
  );

  const handleSelectSheet = useCallback((sheetId: SheetId) => {
    setActiveSheetId(sheetId);
    setActiveBranch(null);
    setLastCommitBase(null);
    setBranchOriginalBase(null);
    setNewCommitsSinceMerge(0);
    if (preBranchFile.current) {
      setActiveFile(preBranchFile.current);
      preBranchFile.current = null;
    }
  }, []);

  const handleCreateBranch = useCallback(async (sheetId: SheetId) => {
    const name = await new Promise<string>((resolve) => {
      setInputState({ message: 'branch 名を入力してください:', resolve });
    });
    if (!name?.trim()) return;
    try {
      const sheetRef = await sheets.ref(sheetId);
      const branch = await createBranch(name.trim(), sheetId, sheetRef);
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
          message:
            'branch の作成に失敗しました。ATProto にログインしているか確認してください。',
          resolve,
        });
      });
    }
  }, []);

  const handleMergeBranch = useCallback(
    async (branch: Branch) => {
      if (!activeSheetId || !activeFile) return;
      const ok = await new Promise<boolean>((resolve) => {
        setConfirmState({
          message: `branch "${branch.name}" を trunk に merge しますか？`,
          resolve,
        });
      });
      if (!ok) return;
      try {
        const sheetRef = await sheets.ref(activeSheetId);
        const branchRef = { uri: branch.uri, cid: branch.cid };
        const latestCommit = latestCommitRef.current ?? undefined;

        await mergeBranchToTrunk(branch, activeSheetId, sheetRef);
        await createMergeRecord(branch, sheetRef, branchRef, latestCommit);
        const mergedBranch = await updateBranchStatus(branch, 'merged');

        // branch 一覧を更新
        setSheetBranches((prev) => {
          const next = new Map(prev);
          const existing = next.get(activeSheetId) ?? [];
          next.set(
            activeSheetId,
            existing.map((b) => (b.id === branch.id ? mergedBranch : b)),
          );
          return next;
        });

        // trunk を同期 (preBranchFile を merge 後の状態に更新)
        if (activeFile && activeSheet) {
          preBranchFile.current = {
            ...activeFile,
            sheets: activeFile.sheets.map((s) =>
              s.id === activeSheetId ? activeSheet : s,
            ),
          };
        }

        // merge 後もブランチモードを維持: close するまで commit/merge を続けられる
        setActiveBranch(mergedBranch);
        setBranchOriginalBase(activeSheet ?? null);
        setLastCommitBase(activeSheet ?? null);
        setNewCommitsSinceMerge(0);
      } catch (err) {
        console.warn('[branch] merge failed:', err);
        await new Promise<void>((resolve) => {
          setAlertState({ message: 'merge に失敗しました。', resolve });
        });
      }
    },
    [activeSheetId, activeFile, activeSheet],
  );

  const handleCloseBranch = useCallback(
    async (branch: Branch) => {
      const ok = await new Promise<boolean>((resolve) => {
        setConfirmState({
          message: `branch "${branch.name}" を close しますか？`,
          resolve,
        });
      });
      if (!ok) return;
      try {
        const closedBranch = await updateBranchStatus(branch, 'closed');
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
        // 現在このブランチにいる場合は trunk に戻る
        if (activeBranch?.id === branch.id) {
          setActiveBranch(null);
          setLastCommitBase(null);
          setBranchOriginalBase(null);
          if (preBranchFile.current) {
            setActiveFile(preBranchFile.current);
            preBranchFile.current = null;
          }
        }
      } catch (err) {
        console.warn('[branch] close failed:', err);
        await new Promise<void>((resolve) => {
          setAlertState({ message: 'close に失敗しました。', resolve });
        });
      }
    },
    [activeBranch],
  );

  const handleDeleteBranch = useCallback(
    async (branch: Branch) => {
      const ok = await new Promise<boolean>((resolve) => {
        setConfirmState({
          message: `branch "${branch.name}" を削除しますか？\nこの操作は取り消せません。`,
          resolve,
        });
      });
      if (!ok) return;
      try {
        await deleteBranchWithRecords(branch);
        setSheetBranches((prev) => {
          const next = new Map(prev);
          const sheetId = branch.sheetId;
          next.set(
            sheetId,
            (next.get(sheetId) ?? []).filter((b) => b.id !== branch.id),
          );
          return next;
        });
        // 現在このブランチにいる場合は trunk に戻る
        if (activeBranch?.id === branch.id) {
          setActiveBranch(null);
          setLastCommitBase(null);
          setBranchOriginalBase(null);
          if (preBranchFile.current) {
            setActiveFile(preBranchFile.current);
            preBranchFile.current = null;
          }
        }
      } catch (err) {
        console.warn('[branch] delete failed:', err);
        await new Promise<void>((resolve) => {
          setAlertState({ message: '削除に失敗しました。', resolve });
        });
      }
    },
    [activeBranch],
  );

  const handleCommit = useCallback(
    async (message: string) => {
      if (!activeBranch || !activeSheetId || !activeSheet) return;
      if (pendingOps.length === 0) return;

      try {
        const sheetRef = await sheets.ref(activeSheetId);
        const branchRef = { uri: activeBranch.uri, cid: activeBranch.cid };
        const parentRef = latestCommitRef.current ?? undefined;

        const commit = await createCommit(
          message,
          pendingOps,
          sheetRef,
          branchRef,
          parentRef,
        );
        latestCommitRef.current = { uri: commit.uri, cid: commit.cid };

        // pending ops の基点を現在の状態に更新
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
    [activeBranch, activeSheetId, activeSheet, pendingOps],
  );

  useEffect(() => {
    fetchFiles().then(setFiles).catch(console.error);
    tryAtprotoAutoLogin().then(async () => {
      try {
        const atprotoFiles = await fetchFilesFromAtproto();
        setFiles((local) => {
          const localIds = new Set(local.map((f) => f.id));
          const newFromAtproto = atprotoFiles.filter(
            (f) => !localIds.has(f.id),
          );
          const updated = local.map(
            (f) => atprotoFiles.find((a) => a.id === f.id) ?? f,
          );
          return [...updated, ...newFromAtproto];
        });
      } catch {
        // ATProto 未設定時はサイレントにスキップ
      }
    });
    return () => {};
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // activeSheetId が変わったら branches を fetch
  useEffect(() => {
    if (!activeSheetId) return;
    fetchBranchesForSheet(activeSheetId)
      .then((bs) => {
        setSheetBranches((prev) => {
          const next = new Map(prev);
          next.set(activeSheetId, bs);
          return next;
        });
      })
      .catch(() => {
        // ATProto 未ログイン時はサイレントスキップ
      });
  }, [activeSheetId]);

  const openFile = useCallback(async (id: string) => {
    try {
      let file: GraphFile;
      try {
        file = await fetchFileFromAtproto(id);
        saveFile(file).catch(() => {});
      } catch {
        file = await fetchFile(id);
      }
      setActiveFile(file);
      setActiveSheetId((file.sheets[0]?.id ?? null) as SheetId | null);
      setExpandedFileIds((prev) => new Set([...prev, id]));
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }, []);

  const toggleExpand = useCallback(
    (id: string) => {
      setExpandedFileIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
          if (!activeFile || activeFile.id !== id) {
            openFile(id);
          }
        }
        return next;
      });
    },
    [activeFile, openFile],
  );

  const handleCreate = useCallback(async () => {
    try {
      const name = newFileName.trim() || '無題';
      const file = await createFile(name);
      setFiles((fs) => [
        ...fs,
        { id: file.id, name: file.name, description: file.description },
      ]);
      setActiveFile(file);
      setActiveSheetId((file.sheets[0]?.id ?? null) as SheetId | null);
      setExpandedFileIds((prev) => new Set([...prev, file.id]));
      setNewFileName('');
    } catch (err) {
      console.error('Failed to create file:', err);
    }
  }, [newFileName]);

  const persistFile = useCallback(async (updated: GraphFile) => {
    setActiveFile(updated);
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
    try {
      await syncFileToAtproto(updated);
    } catch (err) {
      console.warn('[atproto] sync failed (falling back to local):', err);
    }
    saveFile(updated).catch((err) =>
      console.warn('[cache] local save failed:', err),
    );
  }, []);

  const handleChange = useCallback(
    (updated: GraphFile) => {
      setActiveFile(updated);
      if (saveTimer.current) clearTimeout(saveTimer.current);

      const branch = activeBranch;
      const sheetId = activeSheetId;

      saveTimer.current = setTimeout(async () => {
        if (branch && branch.name !== 'trunk' && sheetId) {
          // branch モード: branch prefix で PDS に即時保存
          const sheet = updated.sheets.find((s) => s.id === sheetId);
          if (!sheet) return;
          try {
            const sheetRef = await sheets.ref(sheetId);
            await syncBranchSheetToAtproto(sheet, sheetRef, branch.id);
          } catch (err) {
            console.warn('[branch] auto-save failed:', err);
          }
        } else {
          // trunk モード: 通常の永続化
          await persistFile(updated);
        }
      }, AUTOSAVE_DELAY);
    },
    [persistFile, activeBranch, activeSheetId],
  );

  const handleSaveFileSettings = useCallback(
    async (fileId: string, name: string, description: string) => {
      if (!activeFile || activeFile.id !== fileId) return;
      await persistFile({
        ...activeFile,
        name,
        description: description || undefined,
      });
    },
    [activeFile, persistFile],
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
        await removeFile(id);
        try {
          await atprotoFilesColl.delete(id);
        } catch (err) {
          console.warn('[atproto] file delete failed:', err);
        }
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
    [activeFile, files],
  );

  const handleSaveSheetSettings = useCallback(
    async (sheetId: string, name: string, description: string) => {
      if (!activeFile) return;
      await persistFile({
        ...activeFile,
        sheets: activeFile.sheets.map((s) =>
          s.id === sheetId
            ? { ...s, name, description: description || undefined }
            : s,
        ),
      });
    },
    [activeFile, persistFile],
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
      if (activeSheetId === sheetId) {
        setActiveSheetId((updated.sheets[0]?.id ?? null) as SheetId | null);
      }
      setPopupTarget(null);
      await persistFile(updated);
    },
    [activeFile, activeSheetId, persistFile],
  );

  const handleImportFile = useCallback(async (data: ConversensusFile) => {
    try {
      const file = await importFile(data);
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
          message: 'インポートに失敗しました。ファイル形式を確認してください。',
          resolve,
        });
      });
    }
  }, []);

  const handleExportFile = useCallback(
    async (fileId: string) => {
      try {
        const file =
          activeFile?.id === fileId ? activeFile : await fetchFile(fileId);
        exportFile(file);
      } catch (err) {
        console.error('Failed to export file:', err);
      }
    },
    [activeFile],
  );

  const handleAddSheet = useCallback(async () => {
    if (!activeFile) return;
    const newSheet: Sheet = {
      id: generateId() as SheetId,
      name: `Sheet ${activeFile.sheets.length + 1}`,
      nodes: [],
      edges: [],
    };
    const updated: GraphFile = {
      ...activeFile,
      sheets: [...activeFile.sheets, newSheet],
    };
    setActiveSheetId(newSheet.id);
    if (!isTrunk) {
      // ブランチモードで新シートを追加: 空シートを基点に設定し古いシートのベースが残るのを防ぐ
      setBranchOriginalBase(newSheet);
      setLastCommitBase(newSheet);
    }
    await persistFile(updated);
  }, [activeFile, persistFile, isTrunk]);

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      <Sidebar
        files={files}
        activeFile={activeFile}
        activeSheetId={activeSheetId}
        expandedFileIds={expandedFileIds}
        newFileName={newFileName}
        popupTarget={popupTarget}
        onNewFileNameChange={setNewFileName}
        onCreateFile={handleCreate}
        onImportFile={handleImportFile}
        onToggleExpand={toggleExpand}
        onOpenFile={openFile}
        onSelectSheet={handleSelectSheet}
        onAddSheet={handleAddSheet}
        onSetPopupTarget={setPopupTarget}
        onSaveFileSettings={handleSaveFileSettings}
        onDeleteFile={handleDeleteFile}
        onExportFile={handleExportFile}
        onSaveSheetSettings={handleSaveSheetSettings}
        onDeleteSheet={handleDeleteSheet}
        sheetBranches={sheetBranches}
        activeBranchId={activeBranch?.id ?? null}
        onSelectBranch={handleSelectBranch}
        onCreateBranch={handleCreateBranch}
        onMergeBranch={handleMergeBranch}
        onCloseBranch={handleCloseBranch}
        onDeleteBranch={handleDeleteBranch}
      />
      <main style={{ flex: 1 }}>
        {activeFile && activeSheetId ? (
          <GraphEditor
            key={`${activeSheetId}/${activeBranch?.id ?? 'trunk'}`}
            file={activeFile}
            activeSheetId={activeSheetId}
            onChange={handleChange}
            conflictedNodeIds={conflictedNodeIds}
            conflictedEdgeIds={conflictedEdgeIds}
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
      {!isTrunk && activeBranch && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 100,
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
            ⎇ {activeBranch.name}{' '}
            {pendingOps.length > 0 ? `(${pendingOps.length} 変更)` : ''}
          </span>
          <button
            type="button"
            onClick={() => setCommitDialogOpen(true)}
            disabled={pendingOps.length === 0}
            style={{
              padding: '6px 16px',
              fontSize: 13,
              background: pendingOps.length > 0 ? '#4f6ef7' : '#ccc',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: pendingOps.length > 0 ? 'pointer' : 'not-allowed',
            }}
          >
            コミット
          </button>
          <button
            type="button"
            onClick={() => handleMergeBranch(activeBranch)}
            disabled={
              pendingOps.length > 0 ||
              newCommitsSinceMerge === 0 ||
              activeBranch.status === 'closed'
            }
            style={{
              padding: '6px 16px',
              fontSize: 13,
              background:
                pendingOps.length === 0 &&
                newCommitsSinceMerge > 0 &&
                activeBranch.status !== 'closed'
                  ? '#f97316'
                  : '#ccc',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor:
                pendingOps.length === 0 &&
                newCommitsSinceMerge > 0 &&
                activeBranch.status !== 'closed'
                  ? 'pointer'
                  : 'not-allowed',
            }}
          >
            merge ↑
          </button>
        </div>
      )}
      {commitDialogOpen && (
        <CommitDialog
          operations={pendingOps}
          onCommit={handleCommit}
          onCancel={() => setCommitDialogOpen(false)}
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
    </div>
  );
}
