import type {
  ConversensusFile,
  GraphFile,
  GraphFileListItem,
  SheetId,
} from '@conversensus/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createFile,
  exportFile,
  fetchFile,
  fetchFiles,
  importFile,
  removeFile,
  saveFile,
} from '../api';
import {
  files as atprotoFilesColl,
  fetchFileFromAtproto,
  fetchFilesFromAtproto,
  login,
  syncFileToAtproto,
} from '../atproto';
import type { PopupTarget } from '../SettingsPopup';

type ConfirmState = {
  message: string;
  resolve: (ok: boolean) => void;
};

type AlertState = {
  message: string;
  resolve: () => void;
};

interface UseFileSheetOperationsParams {
  setConfirmState: (s: ConfirmState | null) => void;
  setAlertState: (s: AlertState | null) => void;
}

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

export function useFileSheetOperations({
  setConfirmState,
  setAlertState,
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

  const openFile = useCallback(async (id: string) => {
    try {
      let file: GraphFile;
      try {
        file = await fetchFileFromAtproto(id);
        saveFile(file).catch((err) =>
          console.warn('[cache] save failed:', err),
        );
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
    [activeFile, files, setConfirmState],
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
    [activeFile, activeSheetId, persistFile, setAlertState],
  );

  const handleImportFile = useCallback(
    async (data: ConversensusFile) => {
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
            message:
              'インポートに失敗しました。ファイル形式を確認してください。',
            resolve,
          });
        });
      }
    },
    [setAlertState],
  );

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

  // 初期ファイル読み込み + ATProto 同期
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

  return {
    files,
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
    persistFile,
    handleSaveFileSettings,
    handleDeleteFile,
    handleSaveSheetSettings,
    handleDeleteSheet,
    handleImportFile,
    handleExportFile,
  };
}
