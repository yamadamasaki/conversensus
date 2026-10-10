import {
  BRANCH_STATUS,
  type BranchMeta,
  type ConversensusFile,
  type FileId,
  type FolderId,
  type GraphFile,
  type GraphFileListItem,
  METAGRAPH_SHEET_KIND,
  parseConversensusFile,
  SEED_TEMPLATES,
  type SheetId,
  type SheetKind,
  sheetKindOf,
  TEMPLATE_SHEET_KIND,
  type Template,
} from '@conversensus/shared';
import { useRef, useState } from 'react';
import { AlertDialog } from './AlertDialog';
import { TRUNK_PREFIX } from './atproto';
import type { RemoteSyncQueue } from './atproto/remoteSyncQueue';
import {
  type FolderNode,
  type FolderTree,
  folderPaths,
  isEmptyFolder,
} from './folders/folderTree';
import { LocalOnlyBanner } from './LocalOnlyBanner';
import type { PopupTarget } from './SettingsPopup';
import { SettingsPopup } from './SettingsPopup';
import { ShareStatusIcon } from './ShareStatusIcon';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import type { FileSharing } from './sync/rosterView';
import { color, font, radius } from './theme';

/** 特殊なグラフのシートの印 (step3 Phase 4)。名前の後ろに出す */
const SHEET_KIND_MARK: Record<SheetKind, { mark: string; title: string }> = {
  [TEMPLATE_SHEET_KIND]: { mark: '◇', title: 'template graph' },
  [METAGRAPH_SHEET_KIND]: { mark: '⌘', title: 'metagraph' },
};

/** 「シートを追加 ▾」から作れる特殊なグラフ */
const SPECIAL_SHEETS: readonly { kind: SheetKind; label: string }[] = [
  { kind: TEMPLATE_SHEET_KIND, label: 'template graph' },
  // 仕様: 複数の metagraph が存在しても構わない (それぞれが File に対する視点)
  { kind: METAGRAPH_SHEET_KIND, label: 'metagraph' },
];

const MENU_ITEM = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '3px 4px 3px 36px',
  fontSize: font.caption,
  color: color.primary,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
} as const;

/** サイドバーから開くときの指定 (step3 Phase 3 S3-4c) */
export type OpenOptions = { newTab: boolean };

/** ⌘ (mac) / Ctrl を押しながら選んだら別のタブで開く。ブラウザのリンクと同じ約束 */
function openOptionsOf(e: { metaKey: boolean; ctrlKey: boolean }): OpenOptions {
  return { newTab: e.metaKey || e.ctrlKey };
}

/** File を整理する Folder (step3 Phase 6 S6-2c)。渡さなければ平らな一覧 */
type FolderProps = {
  tree: FolderTree;
  /** 折り畳んだ Folder (端末ごと) */
  collapsed: ReadonlySet<FolderId>;
  onToggle: (id: FolderId) => void;
  /** Folder を作る。`parent` が無ければトップ・レベル。名前を訊くのは App */
  onCreate: (parent: FolderId | undefined) => void;
  onRename: (node: FolderNode) => void;
  onDelete: (id: FolderId) => void;
  /** File を Folder へ移す。`undefined` ならトップ・レベルに戻す */
  onMoveFile: (fileId: FileId, folder: FolderId | undefined) => void;
};

type Props = {
  files: GraphFileListItem[];
  folders?: FolderProps;
  activeFile: GraphFile | null;
  activeSheetId: SheetId | null;
  expandedFileIds: Set<string>;
  newFileName: string;
  popupTarget: PopupTarget | null;
  sheetBranches: Map<string, BranchMeta[]>;
  activeBranchId: string | null;
  onNewFileNameChange: (name: string) => void;
  onCreateFile: () => void;
  onImportFile: (data: ConversensusFile) => void;
  onToggleExpand: (id: string) => void;
  onOpenFile: (id: string) => void;
  /** シートを開く。`newTab` は ⌘ / Ctrl を押しながら選んだ (別のタブで開く, Q2) */
  onSelectSheet: (sheetId: SheetId, options: OpenOptions) => void;
  /** template を当てずに作るなら省略する (Phase 5 D1: 紐づけは作成時のみ) */
  /** シートを足す。File に template graph があれば、当てるものを選ばせるのは App */
  onAddSheet: () => void;
  /** template graph の種 (`SEED_TEMPLATES`) を File に複製する (step3 Phase 4 Q1) */
  onAddSeedTemplate: (seed: Template) => void;
  /** 特殊なグラフのシートを足す (step3 Phase 4)。`kind` はシートの種別 */
  onAddKindSheet: (kind: SheetKind) => void;
  onSetPopupTarget: (target: PopupTarget | null) => void;
  onSaveFileSettings: (fileId: string, name: string, desc: string) => void;
  onDeleteFile: (id: string) => void;
  onExportFile: (fileId: string) => void;
  onSaveSheetSettings: (sheetId: string, name: string, desc: string) => void;
  onDeleteSheet: (sheetId: string) => void;
  onSelectBranch: (
    sheetId: SheetId,
    branch: BranchMeta | null,
    options: OpenOptions,
  ) => void;
  onCreateBranch: (sheetId: SheetId) => void;
  onMergeBranch: (branch: BranchMeta) => void;
  onCloseBranch: (branch: BranchMeta) => void;
  onDeleteBranch: (branch: BranchMeta) => void;
  atprotoSession: { handle: string } | null;
  onAtprotoLogin: () => void;
  onAtprotoLogout: () => void;
  /** 未ログインの間に、この端末にだけある編集の数 (FPR 前 L-3)。0 なら知らせない */
  localOnlyCount?: number;
  /** remote 送信キュー (W3d5-6)。null なら同期ステータスは表示しない */
  remoteQueue: RemoteSyncQueue | null;
  /** 「今すぐ同期」で走らせる送受信 (#202)。送信だけでは他所の変更が取れない */
  onSyncNow: () => Promise<void>;
  /**
   * 参加者一覧ダイアログを開く (step2 Phase 1)。
   * **ログイン中でなければ渡さない** — 名簿は DID 単位なので、DID が無いと何も出せない
   */
  onOpenInvitation?: (fileId: string) => void;
  /**
   * 開いている File の共有状態 (step2 Phase 2)。**開いている File の分しか無い** —
   * 同期するのは開いている File だけなので、それ以外の共有状態は分からない。
   */
  sharing?: { fileId: string; state: FileSharing } | null;
  /** 参加コードを貼るダイアログを開く (step2 Phase 1) */
  onOpenParticipate?: () => void;
};

/**
 * 参加者ボタンの説明。**共有が切れていることはここにしか書かれていない** —
 * 絵は 2 値しか表せないので、何が起きているかは title が引き受ける
 */
function shareTitle(share: FileSharing | null): string {
  if (share?.isDetached)
    return (
      '共有が切れています。この File の参加者ではないので, ほかの参加者の編集は届きません' +
      ' (ここまでの内容は手元に残っています)。押すと参加者一覧'
    );
  if (share && share.participants > 1)
    return `参加者一覧 (共有中: ${share.participants} 人)`;
  return '参加者一覧';
}

const gearBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: color.textMuted,
  fontSize: font.body,
  padding: '0 2px',
  lineHeight: 1,
  flexShrink: 0,
};

export function Sidebar({
  files,
  folders,
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
  onAddKindSheet,
  onAddSeedTemplate,
  onSetPopupTarget,
  onSaveFileSettings,
  onDeleteFile,
  onExportFile,
  onSaveSheetSettings,
  onDeleteSheet,
  onSelectBranch,
  onCreateBranch,
  onMergeBranch,
  onCloseBranch,
  onDeleteBranch,
  atprotoSession,
  onAtprotoLogin,
  onAtprotoLogout,
  localOnlyCount = 0,
  remoteQueue,
  onSyncNow,
  onOpenInvitation,
  sharing = null,
  onOpenParticipate,
}: Props) {
  const newFileComposingRef = useRef(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  // どのファイルの「▾」を開いているか。ファイル単位で持つのは、一覧に複数の
  // ファイルが並ぶため (1 つ開くと全部開く、を避ける)
  const [templateMenuFileId, setTemplateMenuFileId] = useState<string | null>(
    null,
  );
  /** どの File の「Folder へ移す」を開いているか */
  const [moveMenuFileId, setMoveMenuFileId] = useState<string | null>(null);
  const [alertState, setAlertState] = useState<{
    message: string;
    resolve: () => void;
  } | null>(null);

  const showAlert = (message: string) =>
    new Promise<void>((resolve) => setAlertState({ message, resolve }));

  const handleImportChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        // 旧版の移行を含めた解釈は shared に 1 本化してある (server も同じ関数を使う)
        const parsed = parseConversensusFile(json);
        if (parsed.success) {
          onImportFile(parsed.data);
          return;
        }
        const messages = parsed.error.errors
          .map((err) => `${err.path.join('.')}: ${err.message}`)
          .join('\n');
        showAlert(`ファイル形式が不正です:\n${messages}`);
      } catch {
        showAlert('ファイルの読み込みに失敗しました');
      }
    };
    reader.onerror = () => {
      showAlert('ファイルの読み込みに失敗しました');
    };
    reader.readAsText(file);
    // 同じファイルを再選択できるようリセット
    e.target.value = '';
  };

  const renderFile = (f: GraphFileListItem) => {
    const isExpanded = expandedFileIds.has(f.id);
    const isActiveFile = activeFile?.id === f.id;
    // 共有状態は開いている File の分しか無い (同期するのはそれだけ)
    const fileShare = sharing?.fileId === f.id ? sharing.state : null;
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
            borderRadius: radius.sm,
            background: isActiveFile ? color.selectionBg : 'transparent',
            position: 'relative',
          }}
        >
          {/* 展開トグル */}
          <button
            type="button"
            onClick={() => {
              if (!isActiveFile) onOpenFile(f.id);
              onToggleExpand(f.id);
            }}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: color.textMuted,
              fontSize: font.caption,
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
              fontSize: font.body,
              fontWeight: 600,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              padding: 0,
            }}
            onClick={() => {
              if (!isActiveFile) onOpenFile(f.id);
              onToggleExpand(f.id);
            }}
          >
            {f.name}
          </button>

          {/* 参加者一覧 (step2 Phase 1)。ログイン中のファイル行にだけ出す。
                    共有中なら人数を添える — 「誰かと共有している」ことが
                    ダイアログを開かずに分かるようにする。

                    **共有が切れた印もこのボタンが兼ねる** (step2 Phase 2)。
                    取り消されても File は手元に残るので、何も出さないと
                    「もう同期されない File」が普通の File に見える。以前は
                    「同期していません」の札を File 名の隣に出していたが、
                    **幅を食って File 名が読めなくなった** ので絵に畳んだ。
                    押したときの働きは変わらない (名簿を見せる)。
                    **開いている File の分しか分からない** (同期するのはそれだけ) */}
          {onOpenInvitation && (
            <button
              type="button"
              title={shareTitle(fileShare)}
              style={gearBtnStyle}
              onClick={(e) => {
                e.stopPropagation();
                if (!isActiveFile) onOpenFile(f.id);
                onOpenInvitation(f.id);
              }}
            >
              <ShareStatusIcon detached={fileShare?.isDetached ?? false} />
              {/* 切れていても人数は出す — 「自分以外の N 人はまだ
                        共有している」ことが、離脱の意味そのものである */}
              {fileShare && fileShare.participants > 1 && (
                <span style={{ fontSize: font.caption, marginLeft: 1 }}>
                  {fileShare.participants}
                </span>
              )}
            </button>
          )}

          {/* Folder へ移す (step3 Phase 6 S6-2c)。移し先は File 行の下に出す */}
          {folders && (
            <button
              type="button"
              title="Folder へ移す"
              aria-label={`${f.name} を Folder へ移す`}
              aria-expanded={moveMenuFileId === f.id}
              style={gearBtnStyle}
              onClick={(e) => {
                e.stopPropagation();
                setMoveMenuFileId(moveMenuFileId === f.id ? null : f.id);
              }}
            >
              📁
            </button>
          )}

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
              onSave={(name, desc) => onSaveFileSettings(f.id, name, desc)}
              onDelete={() => onDeleteFile(f.id)}
              onClose={() => onSetPopupTarget(null)}
              deleteLabel="ファイルを削除"
              onExport={() => onExportFile(f.id)}
            />
          )}
        </div>

        {folders && moveMenuFileId === f.id && (
          <ul
            aria-label={`${f.name} の移し先`}
            style={{ listStyle: 'none', margin: 0, padding: 0 }}
          >
            {[
              { id: undefined, path: 'トップ・レベル' },
              ...folderPaths(folders.tree),
            ].map((dest) => (
              <li key={dest.id ?? 'top'}>
                <button
                  type="button"
                  style={MENU_ITEM}
                  onClick={() => {
                    setMoveMenuFileId(null);
                    folders.onMoveFile(f.id as FileId, dest.id);
                  }}
                >
                  → {dest.path}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* シート一覧 (展開時) */}
        {isExpanded && fileData && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {fileData.sheets.map((s) => {
              const isActiveSheet = activeSheetId === s.id;
              const kind = sheetKindOf(s);
              // template graph と metagraph は branch を切れない (仕様。versioning の対象ではない)
              const versioned =
                kind !== TEMPLATE_SHEET_KIND && kind !== METAGRAPH_SHEET_KIND;
              const isSheetPopupOpen =
                popupTarget?.type === 'sheet' && popupTarget.sheetId === s.id;

              return (
                <li key={s.id}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      padding: '3px 4px 3px 20px',
                      borderRadius: radius.sm,
                      background: isActiveSheet
                        ? color.selectionBg
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
                        fontSize: font.body,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        padding: 0,
                      }}
                      onClick={(e) => onSelectSheet(s.id, openOptionsOf(e))}
                    >
                      {s.name}
                      {kind && SHEET_KIND_MARK[kind] && (
                        <span
                          title={SHEET_KIND_MARK[kind].title}
                          style={{ marginLeft: 4, color: color.textMuted }}
                        >
                          {SHEET_KIND_MARK[kind].mark}
                        </span>
                      )}
                    </button>

                    {/* ギアボタン */}
                    <button
                      type="button"
                      title="設定"
                      style={{ ...gearBtnStyle, fontSize: font.body }}
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
                      const bs = (sheetBranches.get(s.id) ?? []).filter(
                        (b) => b.name !== TRUNK_PREFIX,
                      );
                      return (
                        <ul
                          style={{
                            listStyle: 'none',
                            margin: 0,
                            padding: 0,
                          }}
                        >
                          {bs.map((branch) => {
                            const isActiveBranch = activeBranchId === branch.id;
                            const isMerged =
                              branch.status === BRANCH_STATUS.MERGED;
                            const isClosed =
                              branch.status === BRANCH_STATUS.CLOSED;
                            const bgColor = isActiveBranch
                              ? color.selectionBg
                              : isMerged
                                ? color.diffUpdateBg
                                : 'transparent';
                            const textColor = isMerged
                              ? color.diffUpdateText
                              : isClosed
                                ? color.textMuted
                                : color.text;
                            return (
                              <li key={branch.id}>
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 2,
                                    padding: '2px 4px 2px 36px',
                                    borderRadius: radius.sm,
                                    background: bgColor,
                                  }}
                                >
                                  <button
                                    type="button"
                                    style={{
                                      flex: 1,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                      fontSize: font.caption,
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      textAlign: 'left',
                                      padding: 0,
                                      color: textColor,
                                    }}
                                    onClick={(e) => {
                                      const options = openOptionsOf(e);
                                      // 開いている branch の行を押すと trunk に戻る。別のタブで
                                      // 開くときは戻らず、その branch を開く
                                      onSelectBranch(
                                        s.id,
                                        isActiveBranch && !options.newTab
                                          ? null
                                          : branch,
                                        options,
                                      );
                                    }}
                                  >
                                    {'⎇ '}
                                    {branch.name}
                                    {isMerged ? ' (merged)' : ''}
                                    {isClosed ? ' (closed)' : ''}
                                  </button>
                                  {/* open + active: merge ↑ / close ✕ */}
                                  {isActiveBranch && !isMerged && !isClosed && (
                                    <>
                                      <button
                                        type="button"
                                        title="trunk に merge"
                                        style={{
                                          ...gearBtnStyle,
                                          fontSize: font.caption,
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onMergeBranch(branch);
                                        }}
                                      >
                                        ↑
                                      </button>
                                      <button
                                        type="button"
                                        title="close"
                                        style={{
                                          ...gearBtnStyle,
                                          fontSize: font.caption,
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onCloseBranch(branch);
                                        }}
                                      >
                                        ✕
                                      </button>
                                    </>
                                  )}
                                  {/* open + not active: delete 🗑 */}
                                  {!isActiveBranch &&
                                    !isMerged &&
                                    !isClosed && (
                                      <button
                                        type="button"
                                        title="削除"
                                        style={{
                                          ...gearBtnStyle,
                                          fontSize: font.caption,
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onDeleteBranch(branch);
                                        }}
                                      >
                                        🗑
                                      </button>
                                    )}
                                  {/* merged: close ✕ */}
                                  {isMerged && (
                                    <button
                                      type="button"
                                      title="close"
                                      style={{
                                        ...gearBtnStyle,
                                        fontSize: font.caption,
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onCloseBranch(branch);
                                      }}
                                    >
                                      ✕
                                    </button>
                                  )}
                                  {/* closed: delete 🗑 */}
                                  {isClosed && (
                                    <button
                                      type="button"
                                      title="削除"
                                      style={{
                                        ...gearBtnStyle,
                                        fontSize: font.caption,
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onDeleteBranch(branch);
                                      }}
                                    >
                                      🗑
                                    </button>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                          {/* 新しい branch を作成 */}
                          {versioned && (
                            <li>
                              <button
                                type="button"
                                onClick={() => onCreateBranch(s.id)}
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  textAlign: 'left',
                                  padding: '2px 4px 2px 36px',
                                  fontSize: font.caption,
                                  color: color.primary,
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                }}
                              >
                                + branch
                              </button>
                            </li>
                          )}
                        </ul>
                      );
                    })()}
                </li>
              );
            })}

            {/* シート追加。template 付きは別口にして、素の追加は 1 クリックのまま残す */}
            <li style={{ display: 'flex', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => onAddSheet()}
                style={{
                  flex: 1,
                  textAlign: 'left',
                  padding: '3px 4px 3px 20px',
                  fontSize: font.body,
                  color: color.primary,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                + シートを追加
              </button>
              <button
                type="button"
                aria-label="template 付きでシートを追加"
                aria-expanded={templateMenuFileId === f.id}
                onClick={() =>
                  setTemplateMenuFileId(
                    templateMenuFileId === f.id ? null : f.id,
                  )
                }
                style={{
                  padding: '3px 8px',
                  fontSize: font.body,
                  color: color.primary,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                ▾
              </button>
            </li>
            {templateMenuFileId === f.id &&
              SPECIAL_SHEETS.map((special) => (
                <li key={special.kind}>
                  <button
                    type="button"
                    onClick={() => {
                      setTemplateMenuFileId(null);
                      onAddKindSheet(special.kind);
                    }}
                    style={MENU_ITEM}
                  >
                    + {special.label}
                  </button>
                </li>
              ))}
            {templateMenuFileId === f.id &&
              // 種を File の template graph に複製する (step3 Phase 4 Q1)
              SEED_TEMPLATES.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setTemplateMenuFileId(null);
                      onAddSeedTemplate(t);
                    }}
                    style={MENU_ITEM}
                  >
                    + {t.name} を追加
                  </button>
                </li>
              ))}
          </ul>
        )}
      </li>
    );
  };

  const fileById = new Map(files.map((f) => [f.id, f]));

  /** Folder の行と、その中身 (下位の Folder → File)。折り畳めば中身を出さない */
  const renderFolder = (
    node: FolderNode,
    ops: FolderProps,
  ): React.ReactElement => {
    const { id } = node.folder;
    const open = !ops.collapsed.has(id);
    const empty = isEmptyFolder(node);
    return (
      <li key={id}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            padding: '4px 4px',
          }}
        >
          <button
            type="button"
            aria-label={`${node.name} を${open ? '畳む' : '開く'}`}
            aria-expanded={open}
            onClick={() => ops.onToggle(id)}
            style={{
              ...gearBtnStyle,
              color: color.textMuted,
              fontSize: font.caption,
            }}
          >
            {open ? '▼' : '▶'}
          </button>
          <span
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: font.body,
            }}
          >
            📁 {node.name}
          </span>
          <button
            type="button"
            title="この中に Folder を作る"
            aria-label={`${node.name} の中に Folder を作る`}
            style={gearBtnStyle}
            onClick={() => ops.onCreate(id)}
          >
            ＋
          </button>
          <button
            type="button"
            title="名前を変える"
            aria-label={`${node.name} の名前を変える`}
            style={gearBtnStyle}
            onClick={() => ops.onRename(node)}
          >
            ✎
          </button>
          <button
            type="button"
            // 空のときだけ削除できる (仕様)
            title={empty ? '削除' : '空でない Folder は削除できません'}
            aria-label={`${node.name} を削除`}
            disabled={!empty}
            style={{ ...gearBtnStyle, opacity: empty ? 1 : 0.3 }}
            onClick={() => ops.onDelete(id)}
          >
            🗑
          </button>
        </div>
        {open && (node.folders.length > 0 || node.files.length > 0) && (
          <ul style={{ listStyle: 'none', margin: 0, padding: '0 0 0 12px' }}>
            {node.folders.map((child) => renderFolder(child, ops))}
            {node.files.map((fileId) => {
              const f = fileById.get(fileId);
              return f === undefined ? null : renderFile(f);
            })}
          </ul>
        )}
      </li>
    );
  };

  return (
    <aside
      style={{
        // 幅と境の線は外枠 (`SidePanel`) が持つ (step3 Phase 3 S3-4b)
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        padding: 12,
        gap: 8,
      }}
    >
      <h2 style={{ margin: 0, fontSize: font.heading }}>conversensus</h2>

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
          // **`minWidth: 0` が要る** (GitHub #51)。flex アイテムの `min-width` は既定が
          // `auto` で, `<input>` は `size` 属性由来の固有幅より細くならない。その固有幅は
          // エンジンごとに違うので, WebKit では行が溢れて import ボタンがサイドバーの外へ
          // 押し出され, 見えているのに押せなくなっていた。
          // 同じ行の他のボタンは `overflow: hidden` を持つため既に縮む (自動最小サイズが
          // 効かない) — 縮まないのはこの入力欄だけである
          style={{
            flex: 1,
            minWidth: 0,
            padding: '4px 6px',
            fontSize: font.body,
          }}
        />
        <button
          type="button"
          onClick={onCreateFile}
          style={{ padding: '4px 8px', fontSize: font.body }}
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
          style={{ padding: '4px 8px', fontSize: font.body }}
        >
          ↑
        </button>
        {/* 参加コードを貼って共同作業に加わる (step2 Phase 1) */}
        {onOpenParticipate && (
          <button
            type="button"
            title="参加コードで参加する"
            onClick={onOpenParticipate}
            style={{ padding: '4px 8px', fontSize: font.body }}
          >
            ⇥
          </button>
        )}
        {folders && (
          <button
            type="button"
            title="Folder を作る"
            aria-label="Folder を作る"
            onClick={() => folders.onCreate(undefined)}
            style={{ padding: '4px 8px', fontSize: font.body }}
          >
            📁
          </button>
        )}
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
        {folders ? (
          <>
            {folders.tree.folders.map((node) => renderFolder(node, folders))}
            {folders.tree.folders.length > 0 &&
              folders.tree.files.length > 0 && (
                // トップ・レベルの File はまとめて出し、Folder とは区切る (仕様)
                <li aria-hidden="true">
                  <hr
                    style={{
                      border: 'none',
                      borderTop: `1px solid ${color.borderSubtle}`,
                      margin: '4px 0',
                    }}
                  />
                </li>
              )}
            {folders.tree.files.map((id) => {
              const f = fileById.get(id);
              return f === undefined ? null : renderFile(f);
            })}
          </>
        ) : (
          files.map(renderFile)
        )}
      </ul>
      {/* ATProto セッション */}
      <div
        style={{
          borderTop: `1px solid ${color.borderSubtle}`,
          paddingTop: 8,
          fontSize: font.body,
        }}
      >
        {atprotoSession ? (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 4,
              }}
            >
              <span
                style={{
                  color: color.textMuted,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                @{atprotoSession.handle}
              </span>
              <button
                type="button"
                onClick={onAtprotoLogout}
                style={{
                  flexShrink: 0,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: color.textMuted,
                  fontSize: font.caption,
                  padding: '2px 4px',
                }}
              >
                ログアウト
              </button>
            </div>
            {/* remote 同期ステータス (§3.7)。ログイン時のみ意味を持つ */}
            <SyncStatusIndicator
              remoteQueue={remoteQueue}
              onSyncNow={onSyncNow}
            />
          </>
        ) : (
          <>
            {/* この端末にだけある編集を知らせる (FPR 前 L-3)。押すとログイン */}
            <LocalOnlyBanner count={localOnlyCount} onLogin={onAtprotoLogin} />
            <button
              type="button"
              onClick={onAtprotoLogin}
              style={{
                width: '100%',
                textAlign: 'left',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: color.primary,
                fontSize: font.body,
                padding: '2px 0',
              }}
            >
              ATProto ログイン
            </button>
          </>
        )}
      </div>
      {alertState && (
        <AlertDialog
          message={alertState.message}
          onClose={() => {
            alertState.resolve();
            setAlertState(null);
          }}
        />
      )}
    </aside>
  );
}
