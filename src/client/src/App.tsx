import type {
  GraphFile,
  GraphFileListItem,
  Sheet,
  SheetId,
} from '@conversensus/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createFile, fetchFile, fetchFiles, removeFile, saveFile } from './api';
import { GraphEditor } from './GraphEditor';

const AUTOSAVE_DELAY = 1000; // ms

// ---- ポップアップコンポーネント ----

type PopupTarget =
  | { type: 'file'; id: string }
  | { type: 'sheet'; fileId: string; sheetId: string };

function SettingsPopup({
  name,
  description,
  onSave,
  onDelete,
  onClose,
  deleteLabel,
}: {
  name: string;
  description: string;
  onSave: (name: string, description: string) => void;
  onDelete: () => void;
  onClose: () => void;
  deleteLabel: string;
}) {
  const [draftName, setDraftName] = useState(name);
  const [draftDesc, setDraftDesc] = useState(description);
  const popupRef = useRef<HTMLDivElement>(null);
  const nameComposingRef = useRef(false);
  const descComposingRef = useRef(false);

  // クリック外でポップアップを閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onSave(draftName.trim() || name, draftDesc);
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [draftName, draftDesc, name, onSave, onClose]);

  const handleSave = () => {
    onSave(draftName.trim() || name, draftDesc);
    onClose();
  };

  return (
    <div
      ref={popupRef}
      style={{
        position: 'absolute',
        right: 8,
        top: 0,
        zIndex: 100,
        background: '#fff',
        border: '1px solid #ccc',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        padding: 12,
        width: 220,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label htmlFor="popup-name" style={{ fontSize: 11, color: '#666' }}>
          名前
        </label>
        <input
          id="popup-name"
          // biome-ignore lint/a11y/noAutofocus: ポップアップ表示時に即座に編集できるよう必要
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onCompositionStart={() => {
            nameComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            nameComposingRef.current = false;
          }}
          onKeyDown={(e) => {
            if (nameComposingRef.current) return;
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') onClose();
          }}
          style={{
            fontSize: 13,
            padding: '4px 6px',
            borderRadius: 4,
            border: '1px solid #ccc',
          }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label htmlFor="popup-desc" style={{ fontSize: 11, color: '#666' }}>
          概要
        </label>
        <textarea
          id="popup-desc"
          value={draftDesc}
          onChange={(e) => setDraftDesc(e.target.value)}
          onCompositionStart={() => {
            descComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            descComposingRef.current = false;
          }}
          onKeyDown={(e) => {
            if (descComposingRef.current) return;
            if (e.key === 'Escape') onClose();
          }}
          placeholder="概要を入力…"
          rows={3}
          style={{
            fontSize: 12,
            padding: '4px 6px',
            borderRadius: 4,
            border: '1px solid #ccc',
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
        <button
          type="button"
          onClick={onDelete}
          style={{
            fontSize: 12,
            padding: '4px 8px',
            borderRadius: 4,
            border: '1px solid #f44',
            background: 'none',
            color: '#f44',
            cursor: 'pointer',
          }}
        >
          {deleteLabel}
        </button>
        <button
          type="button"
          onClick={handleSave}
          style={{
            fontSize: 12,
            padding: '4px 12px',
            borderRadius: 4,
            border: 'none',
            background: '#4f6ef7',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          保存
        </button>
      </div>
    </div>
  );
}

// ---- メインコンポーネント ----

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
  const newFileComposingRef = useRef(false);

  useEffect(() => {
    fetchFiles().then(setFiles).catch(console.error);
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

  // ファイル設定を保存
  const handleSaveFileSettings = useCallback(
    async (fileId: string, name: string, description: string) => {
      if (!activeFile || activeFile.id !== fileId) return;
      const updated = {
        ...activeFile,
        name,
        description: description || undefined,
      };
      await persistFile(updated);
    },
    [activeFile, persistFile],
  );

  // ファイル削除
  const handleDeleteFile = useCallback(
    async (id: string) => {
      const target = files.find((f) => f.id === id);
      if (
        target &&
        activeFile?.id === id &&
        activeFile.sheets.length > 0 &&
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

  // シート設定を保存
  const handleSaveSheetSettings = useCallback(
    async (sheetId: string, name: string, description: string) => {
      if (!activeFile) return;
      const updated: GraphFile = {
        ...activeFile,
        sheets: activeFile.sheets.map((s) =>
          s.id === sheetId
            ? { ...s, name, description: description || undefined }
            : s,
        ),
      };
      await persistFile(updated);
    },
    [activeFile, persistFile],
  );

  // シート削除
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

  // シート追加
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

  const gearBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#aaa',
    fontSize: 13,
    padding: '0 2px',
    lineHeight: 1,
    flexShrink: 0,
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      {/* サイドバー */}
      <aside
        style={{
          width: 240,
          borderRight: '1px solid #ddd',
          display: 'flex',
          flexDirection: 'column',
          padding: 12,
          gap: 8,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16 }}>conversensus</h2>

        {/* 新規ファイル作成 */}
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onCompositionStart={() => {
              newFileComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              newFileComposingRef.current = false;
            }}
            onKeyDown={(e) => {
              if (newFileComposingRef.current) return;
              if (e.key === 'Enter') handleCreate();
            }}
            placeholder="ファイル名"
            style={{ flex: 1, padding: '4px 6px', fontSize: 13 }}
          />
          <button
            type="button"
            onClick={handleCreate}
            style={{ padding: '4px 8px', fontSize: 13 }}
          >
            +
          </button>
        </div>

        {/* ファイル一覧 */}
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            flex: 1,
            overflowY: 'auto',
          }}
        >
          {files.map((f) => {
            const isExpanded = expandedFileIds.has(f.id);
            const isActiveFile = activeFile?.id === f.id;
            const fileData = isActiveFile ? activeFile : null;
            const fileDesc = fileData?.description ?? f.description;
            const isFilePopupOpen =
              popupTarget?.type === 'file' && popupTarget.id === f.id;

            return (
              <li key={f.id}>
                {/* ファイル行 */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    padding: '4px 4px',
                    borderRadius: 4,
                    background: isActiveFile ? '#e8f0fe' : 'transparent',
                    position: 'relative',
                  }}
                >
                  {/* 展開トグル */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(f.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#555',
                      fontSize: 10,
                      padding: '0 2px',
                      flexShrink: 0,
                    }}
                  >
                    {isExpanded ? '▼' : '▶'}
                  </button>

                  {/* ファイル名 (hover で description を表示) */}
                  <button
                    type="button"
                    title={fileDesc ?? undefined}
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 13,
                      fontWeight: 600,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      padding: 0,
                    }}
                    onClick={() => toggleExpand(f.id)}
                  >
                    {f.name}
                  </button>

                  {/* ギアボタン */}
                  <button
                    type="button"
                    title="設定"
                    style={gearBtnStyle}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPopupTarget(
                        isFilePopupOpen ? null : { type: 'file', id: f.id },
                      );
                      if (!isActiveFile) openFile(f.id);
                    }}
                  >
                    ⚙
                  </button>

                  {/* ファイル設定ポップアップ */}
                  {isFilePopupOpen && fileData && (
                    <SettingsPopup
                      name={fileData.name}
                      description={fileData.description ?? ''}
                      onSave={(name, desc) =>
                        handleSaveFileSettings(f.id, name, desc)
                      }
                      onDelete={() => handleDeleteFile(f.id)}
                      onClose={() => setPopupTarget(null)}
                      deleteLabel="ファイルを削除"
                    />
                  )}
                </div>

                {/* シート一覧 (展開時) */}
                {isExpanded && fileData && (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {fileData.sheets.map((s) => {
                      const isActiveSheet = activeSheetId === s.id;
                      const isSheetPopupOpen =
                        popupTarget?.type === 'sheet' &&
                        popupTarget.sheetId === s.id;

                      return (
                        <li key={s.id}>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 2,
                              padding: '3px 4px 3px 20px',
                              borderRadius: 4,
                              background: isActiveSheet
                                ? '#c8dcfe'
                                : 'transparent',
                              position: 'relative',
                            }}
                          >
                            {/* シート名 (hover で description を表示) */}
                            <button
                              type="button"
                              title={s.description ?? undefined}
                              style={{
                                flex: 1,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                fontSize: 12,
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                textAlign: 'left',
                                padding: 0,
                              }}
                              onClick={() => setActiveSheetId(s.id)}
                            >
                              {s.name}
                            </button>

                            {/* ギアボタン */}
                            <button
                              type="button"
                              title="設定"
                              style={{ ...gearBtnStyle, fontSize: 12 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setPopupTarget(
                                  isSheetPopupOpen
                                    ? null
                                    : {
                                        type: 'sheet',
                                        fileId: f.id,
                                        sheetId: s.id,
                                      },
                                );
                              }}
                            >
                              ⚙
                            </button>

                            {/* シート設定ポップアップ */}
                            {isSheetPopupOpen && (
                              <SettingsPopup
                                name={s.name}
                                description={s.description ?? ''}
                                onSave={(name, desc) =>
                                  handleSaveSheetSettings(s.id, name, desc)
                                }
                                onDelete={() => handleDeleteSheet(s.id)}
                                onClose={() => setPopupTarget(null)}
                                deleteLabel="シートを削除"
                              />
                            )}
                          </div>
                        </li>
                      );
                    })}

                    {/* シート追加 */}
                    <li>
                      <button
                        type="button"
                        onClick={handleAddSheet}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '3px 4px 3px 20px',
                          fontSize: 12,
                          color: '#4f6ef7',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        + シートを追加
                      </button>
                    </li>
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </aside>

      {/* メインエリア */}
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
