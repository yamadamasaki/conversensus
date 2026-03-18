import type { GraphFile, GraphFileListItem } from '@conversensus/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createFile, fetchFile, fetchFiles, removeFile, saveFile } from './api';
import { GraphEditor } from './GraphEditor';

const AUTOSAVE_DELAY = 1000; // ms

export default function App() {
  const [files, setFiles] = useState<GraphFileListItem[]>([]);
  const [activeFile, setActiveFile] = useState<GraphFile | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchFiles().then(setFiles).catch(console.error);
  }, []);

  // アンマウント時にオートセーブタイマーをキャンセルする
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const openFile = useCallback(async (id: string) => {
    try {
      const file = await fetchFile(id);
      setActiveFile(file);
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    try {
      const name = newFileName.trim() || '無題';
      const file = await createFile(name);
      setFiles((fs) => [
        ...fs,
        { id: file.id, name: file.name, description: file.description },
      ]);
      setActiveFile(file);
      setNewFileName('');
    } catch (err) {
      console.error('Failed to create file:', err);
    }
  }, [newFileName]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await removeFile(id);
        setFiles((fs) => fs.filter((f) => f.id !== id));
        if (activeFile?.id === id) setActiveFile(null);
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
          {files.map((f) => (
            <li
              key={f.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 6px',
                borderRadius: 4,
                background: activeFile?.id === f.id ? '#e8f0fe' : 'transparent',
                cursor: 'pointer',
              }}
            >
              <button
                type="button"
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 13,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  padding: 0,
                }}
                onClick={() => openFile(f.id)}
              >
                {f.name}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(f.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#999',
                  fontSize: 12,
                }}
              >
                x
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* メインエリア */}
      <main style={{ flex: 1 }}>
        {activeFile ? (
          <GraphEditor file={activeFile} onChange={handleChange} />
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
