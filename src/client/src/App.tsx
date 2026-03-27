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

// インライン編集用のユーティリティコンポーネント
function InlineEditField({
  value,
  onCommit,
  onCancel,
  style,
}: {
  value: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
  style?: React.CSSProperties;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: インライン編集開始時に即座に入力できるよう必要
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(draft.trim() || value);
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={() => onCommit(draft.trim() || value)}
      style={{ fontSize: 13, padding: '0 2px', width: '100%', ...style }}
    />
  );
}

export default function App() {
  const [files, setFiles] = useState<GraphFileListItem[]>([]);
  const [activeFile, setActiveFile] = useState<GraphFile | null>(null);
  const [activeSheetId, setActiveSheetId] = useState<SheetId | null>(null);
  const [expandedFileIds, setExpandedFileIds] = useState<Set<string>>(
    new Set(),
  );
  const [newFileName, setNewFileName] = useState('');

  // 編集中の項目 (type: 'file' | 'sheet', id, field: 'name' | 'description')
  const [editing, setEditing] = useState<{
    type: 'file' | 'sheet';
    id: string;
    field: 'name' | 'description';
  } | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const handleDeleteFile = useCallback(
    async (id: string) => {
      const target = activeFile?.id === id ? activeFile : null;
      if (target && target.sheets.length > 0) {
        if (
          !window.confirm(
            `「${target.name}」を削除しますか？\nシートも全て削除されます。`,
          )
        )
          return;
      }
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
      } catch (err) {
        console.error('Failed to delete file:', err);
      }
    },
    [activeFile],
  );

  const handleChange = useCallback((updated: GraphFile) => {
    setActiveFile(updated);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await saveFile(updated);
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
      } catch (err) {
        console.error('Failed to save file:', err);
      }
    }, AUTOSAVE_DELAY);
  }, []);

  // ファイルのフィールドを更新して即時保存
  const updateFileField = useCallback(
    async (field: 'name' | 'description', value: string) => {
      if (!activeFile) return;
      const updated = { ...activeFile, [field]: value || undefined };
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
    },
    [activeFile],
  );

  // シートのフィールドを更新して即時保存
  const updateSheetField = useCallback(
    async (sheetId: string, field: 'name' | 'description', value: string) => {
      if (!activeFile) return;
      const updated: GraphFile = {
        ...activeFile,
        sheets: activeFile.sheets.map((s) =>
          s.id === sheetId ? { ...s, [field]: value || undefined } : s,
        ),
      };
      setActiveFile(updated);
      try {
        await saveFile(updated);
      } catch (err) {
        console.error('Failed to save file:', err);
      }
    },
    [activeFile],
  );

  // シートを追加
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
    setActiveFile(updated);
    setActiveSheetId(newSheet.id);
    try {
      await saveFile(updated);
    } catch (err) {
      console.error('Failed to add sheet:', err);
    }
  }, [activeFile]);

  // シートを削除
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
      setActiveFile(updated);
      if (activeSheetId === sheetId) {
        setActiveSheetId((updated.sheets[0]?.id ?? null) as SheetId | null);
      }
      try {
        await saveFile(updated);
      } catch (err) {
        console.error('Failed to delete sheet:', err);
      }
    },
    [activeFile, activeSheetId],
  );

  const btnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#999',
    fontSize: 11,
    padding: '0 2px',
    lineHeight: 1,
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

        <div style={{ display: 'flex', gap: 4 }}>
          <input
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
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
                  }}
                >
                  {/* 展開トグル */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(f.id)}
                    style={{ ...btnStyle, color: '#555', fontSize: 10 }}
                  >
                    {isExpanded ? '▼' : '▶'}
                  </button>

                  {/* ファイル名 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {editing?.type === 'file' &&
                    editing.id === f.id &&
                    editing.field === 'name' ? (
                      <InlineEditField
                        value={fileData?.name ?? f.name}
                        onCommit={(v) => {
                          setEditing(null);
                          updateFileField('name', v);
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <button
                        type="button"
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
                          width: '100%',
                        }}
                        onClick={() => toggleExpand(f.id)}
                        onDoubleClick={() =>
                          setEditing({ type: 'file', id: f.id, field: 'name' })
                        }
                      >
                        {f.name}
                      </button>
                    )}
                    {/* ファイル概要 */}
                    {editing?.type === 'file' &&
                    editing.id === f.id &&
                    editing.field === 'description' ? (
                      <InlineEditField
                        value={fileData?.description ?? f.description ?? ''}
                        onCommit={(v) => {
                          setEditing(null);
                          updateFileField('description', v);
                        }}
                        onCancel={() => setEditing(null)}
                        style={{ fontSize: 11, color: '#666' }}
                      />
                    ) : (
                      <button
                        type="button"
                        style={{
                          fontSize: 11,
                          color: '#888',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          cursor: isActiveFile ? 'text' : 'default',
                          minHeight: 14,
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          textAlign: 'left',
                          width: '100%',
                        }}
                        onClick={() =>
                          isActiveFile &&
                          setEditing({
                            type: 'file',
                            id: f.id,
                            field: 'description',
                          })
                        }
                      >
                        {(fileData?.description ?? f.description) ||
                          (isActiveFile ? '概要を追加…' : '')}
                      </button>
                    )}
                  </div>

                  {/* ファイル削除ボタン */}
                  <button
                    type="button"
                    onClick={() => handleDeleteFile(f.id)}
                    style={btnStyle}
                    title="ファイルを削除"
                  >
                    ×
                  </button>
                </div>

                {/* シート一覧 (展開時) */}
                {isExpanded && fileData && (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {fileData.sheets.map((s) => {
                      const isActiveSheet = activeSheetId === s.id;
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
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {editing?.type === 'sheet' &&
                              editing.id === s.id &&
                              editing.field === 'name' ? (
                                <InlineEditField
                                  value={s.name}
                                  onCommit={(v) => {
                                    setEditing(null);
                                    updateSheetField(s.id, 'name', v);
                                  }}
                                  onCancel={() => setEditing(null)}
                                />
                              ) : (
                                <button
                                  type="button"
                                  style={{
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    fontSize: 12,
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    padding: 0,
                                    width: '100%',
                                  }}
                                  onClick={() => setActiveSheetId(s.id)}
                                  onDoubleClick={() =>
                                    setEditing({
                                      type: 'sheet',
                                      id: s.id,
                                      field: 'name',
                                    })
                                  }
                                >
                                  {s.name}
                                </button>
                              )}
                              {/* シート概要 */}
                              {editing?.type === 'sheet' &&
                              editing.id === s.id &&
                              editing.field === 'description' ? (
                                <InlineEditField
                                  value={s.description ?? ''}
                                  onCommit={(v) => {
                                    setEditing(null);
                                    updateSheetField(s.id, 'description', v);
                                  }}
                                  onCancel={() => setEditing(null)}
                                  style={{ fontSize: 10, color: '#666' }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  style={{
                                    fontSize: 10,
                                    color: '#999',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    cursor: 'text',
                                    minHeight: 12,
                                    background: 'none',
                                    border: 'none',
                                    padding: 0,
                                    textAlign: 'left',
                                    width: '100%',
                                  }}
                                  onClick={() =>
                                    setEditing({
                                      type: 'sheet',
                                      id: s.id,
                                      field: 'description',
                                    })
                                  }
                                >
                                  {s.description || '概要を追加…'}
                                </button>
                              )}
                            </div>
                            {/* シート削除ボタン */}
                            <button
                              type="button"
                              onClick={() => handleDeleteSheet(s.id)}
                              style={btnStyle}
                              title="シートを削除"
                            >
                              ×
                            </button>
                          </div>
                        </li>
                      );
                    })}
                    {/* シート追加ボタン */}
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
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
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
