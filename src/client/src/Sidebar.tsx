import {
  type ConversensusFile,
  ConversensusFileSchema,
  ConversensusFileV1Schema,
  ConversensusFileV2Schema,
  type GraphFile,
  type GraphFileListItem,
  migrateV1toV2,
  migrateV2toV3,
  type SheetId,
} from '@conversensus/shared';
import { useRef } from 'react';
import type { Branch } from './atproto';
import type { PopupTarget } from './SettingsPopup';
import { SettingsPopup } from './SettingsPopup';

type Props = {
  files: GraphFileListItem[];
  activeFile: GraphFile | null;
  activeSheetId: SheetId | null;
  expandedFileIds: Set<string>;
  newFileName: string;
  popupTarget: PopupTarget | null;
  sheetBranches: Map<string, Branch[]>;
  activeBranchId: string | null;
  onNewFileNameChange: (name: string) => void;
  onCreateFile: () => void;
  onImportFile: (data: ConversensusFile) => void;
  onToggleExpand: (id: string) => void;
  onOpenFile: (id: string) => void;
  onSelectSheet: (sheetId: SheetId) => void;
  onAddSheet: () => void;
  onSetPopupTarget: (target: PopupTarget | null) => void;
  onSaveFileSettings: (fileId: string, name: string, desc: string) => void;
  onDeleteFile: (id: string) => void;
  onExportFile: (fileId: string) => void;
  onSaveSheetSettings: (sheetId: string, name: string, desc: string) => void;
  onDeleteSheet: (sheetId: string) => void;
  onSelectBranch: (sheetId: SheetId, branch: Branch | null) => void;
  onCreateBranch: (sheetId: SheetId) => void;
};

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

export function Sidebar({
  files,
  activeFile,
  activeSheetId,
  expandedFileIds,
  newFileName,
  popupTarget,
  sheetBranches,
  activeBranchId,
  onNewFileNameChange,
  onCreateFile,
  onImportFile,
  onToggleExpand,
  onOpenFile,
  onSelectSheet,
  onAddSheet,
  onSetPopupTarget,
  onSaveFileSettings,
  onDeleteFile,
  onExportFile,
  onSaveSheetSettings,
  onDeleteSheet,
  onSelectBranch,
  onCreateBranch,
}: Props) {
  const newFileComposingRef = useRef(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleImportChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        const parsed = ConversensusFileSchema.safeParse(json);
        if (parsed.success) {
          onImportFile(parsed.data);
          return;
        }
        // v2 ファイルの場合はマイグレーションを試みる
        const parsedV2 = ConversensusFileV2Schema.safeParse(json);
        if (parsedV2.success) {
          onImportFile(migrateV2toV3(parsedV2.data));
          return;
        }
        // v1 ファイルの場合はマイグレーションを試みる
        const parsedV1 = ConversensusFileV1Schema.safeParse(json);
        if (parsedV1.success) {
          onImportFile(migrateV2toV3(migrateV1toV2(parsedV1.data)));
          return;
        }
        const messages = parsed.error.errors
          .map((err) => `${err.path.join('.')}: ${err.message}`)
          .join('\n');
        alert(`ファイル形式が不正です:\n${messages}`);
      } catch {
        alert('ファイルの読み込みに失敗しました');
      }
    };
    reader.onerror = () => {
      alert('ファイルの読み込みに失敗しました');
    };
    reader.readAsText(file);
    // 同じファイルを再選択できるようリセット
    e.target.value = '';
  };

  return (
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
          onChange={(e) => onNewFileNameChange(e.target.value)}
          onCompositionStart={() => {
            newFileComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            newFileComposingRef.current = false;
          }}
          onKeyDown={(e) => {
            if (newFileComposingRef.current) return;
            if (e.key === 'Enter') onCreateFile();
          }}
          placeholder="ファイル名"
          style={{ flex: 1, padding: '4px 6px', fontSize: 13 }}
        />
        <button
          type="button"
          onClick={onCreateFile}
          style={{ padding: '4px 8px', fontSize: 13 }}
        >
          +
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept=".conversensus"
          style={{ display: 'none' }}
          onChange={handleImportChange}
        />
        <button
          type="button"
          title="インポート (.conversensus)"
          onClick={() => importInputRef.current?.click()}
          style={{ padding: '4px 8px', fontSize: 13 }}
        >
          ↑
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
                  onClick={() => onToggleExpand(f.id)}
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
                  onClick={() => onToggleExpand(f.id)}
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
                    onSetPopupTarget(
                      isFilePopupOpen ? null : { type: 'file', id: f.id },
                    );
                    if (!isActiveFile) onOpenFile(f.id);
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
                      onSaveFileSettings(f.id, name, desc)
                    }
                    onDelete={() => onDeleteFile(f.id)}
                    onClose={() => onSetPopupTarget(null)}
                    deleteLabel="ファイルを削除"
                    onExport={() => onExportFile(f.id)}
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
                            onClick={() => onSelectSheet(s.id)}
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
                              onSetPopupTarget(
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
                                onSaveSheetSettings(s.id, name, desc)
                              }
                              onDelete={() => onDeleteSheet(s.id)}
                              onClose={() => onSetPopupTarget(null)}
                              deleteLabel="シートを削除"
                            />
                          )}
                        </div>

                        {/* Branch 一覧 (シート選択時に表示) */}
                        {isActiveSheet &&
                          (() => {
                            const bs = sheetBranches.get(s.id) ?? [];
                            return (
                              <ul
                                style={{
                                  listStyle: 'none',
                                  margin: 0,
                                  padding: 0,
                                }}
                              >
                                {bs.map((branch) => {
                                  const isActiveBranch =
                                    activeBranchId === branch.id;
                                  return (
                                    <li key={branch.id}>
                                      <div
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 2,
                                          padding: '2px 4px 2px 36px',
                                          borderRadius: 4,
                                          background: isActiveBranch
                                            ? '#dde8ff'
                                            : 'transparent',
                                        }}
                                      >
                                        <button
                                          type="button"
                                          style={{
                                            flex: 1,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            fontSize: 11,
                                            fontFamily: 'monospace',
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            textAlign: 'left',
                                            padding: 0,
                                            color:
                                              branch.name === 'main'
                                                ? '#888'
                                                : '#333',
                                          }}
                                          onClick={() =>
                                            onSelectBranch(
                                              s.id,
                                              isActiveBranch &&
                                                branch.name !== 'main'
                                                ? null
                                                : branch,
                                            )
                                          }
                                        >
                                          {branch.name === 'main'
                                            ? '⎇ main'
                                            : `⎇ ${branch.name}`}
                                        </button>
                                      </div>
                                    </li>
                                  );
                                })}
                                {/* 新しい branch を作成 */}
                                <li>
                                  <button
                                    type="button"
                                    onClick={() => onCreateBranch(s.id)}
                                    style={{
                                      display: 'block',
                                      width: '100%',
                                      textAlign: 'left',
                                      padding: '2px 4px 2px 36px',
                                      fontSize: 11,
                                      color: '#4f6ef7',
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    + branch
                                  </button>
                                </li>
                              </ul>
                            );
                          })()}
                      </li>
                    );
                  })}

                  {/* シート追加 */}
                  <li>
                    <button
                      type="button"
                      onClick={onAddSheet}
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
  );
}
