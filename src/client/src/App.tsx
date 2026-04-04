import type {
  ConversensusFile,
  GraphFile,
  GraphFileListItem,
  Sheet,
  SheetId,
} from '@conversensus/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createFile,
  exportFile,
  fetchFile,
  fetchFiles,
  importFile,
  removeFile,
  saveFile,
} from './api';
import { login, syncFileToAtproto } from './atproto';
import { GraphEditor } from './GraphEditor';
import type { PopupTarget } from './SettingsPopup';
import { Sidebar } from './Sidebar';

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

  useEffect(() => {
    fetchFiles().then(setFiles).catch(console.error);
    tryAtprotoAutoLogin();
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const openFile = useCallback(async (id: string) => {
    try {
      const file = await fetchFile(id);
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
      await saveFile(updated);
      // ATProto sync: ログイン済みの場合のみバックグラウンドで同期
      syncFileToAtproto(updated).catch((err) =>
        console.warn('[atproto] sync failed:', err),
      );
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  }, []);

  const handleChange = useCallback(
    (updated: GraphFile) => {
      setActiveFile(updated);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(
        () => persistFile(updated),
        AUTOSAVE_DELAY,
      );
    },
    [persistFile],
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
      if (
        target &&
        !window.confirm(
          `「${target.name}」を削除しますか？\nシートも全て削除されます。`,
        )
      )
        return;
      try {
        await removeFile(id);
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
        alert('最後のシートは削除できません');
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
      alert('インポートに失敗しました。ファイル形式を確認してください。');
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
      id: crypto.randomUUID() as SheetId,
      name: `Sheet ${activeFile.sheets.length + 1}`,
      nodes: [],
      edges: [],
    };
    const updated: GraphFile = {
      ...activeFile,
      sheets: [...activeFile.sheets, newSheet],
    };
    setActiveSheetId(newSheet.id);
    await persistFile(updated);
  }, [activeFile, persistFile]);

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
        onSelectSheet={setActiveSheetId}
        onAddSheet={handleAddSheet}
        onSetPopupTarget={setPopupTarget}
        onSaveFileSettings={handleSaveFileSettings}
        onDeleteFile={handleDeleteFile}
        onExportFile={handleExportFile}
        onSaveSheetSettings={handleSaveSheetSettings}
        onDeleteSheet={handleDeleteSheet}
      />
      <main style={{ flex: 1 }}>
        {activeFile && activeSheetId ? (
          <GraphEditor
            file={activeFile}
            activeSheetId={activeSheetId}
            onChange={handleChange}
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
    </div>
  );
}
