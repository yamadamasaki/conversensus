import type { FileId, SheetId } from '@conversensus/shared';
import {
  FileDown,
  RefreshCw,
  Shapes,
  Trash2,
  Unlink,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMessages } from './i18n/messages';
import { color, font, radius, shadow, space } from './theme';
import { Button } from './ui/Button';

export const FLOATING_UI_Z_INDEX = 100;

/** 当てている template に新しい版があるもの 1 つ (template-update D2) */
export type TemplateUpdate = {
  /** template graph の名前 */
  name: string;
  /** 最新の版にする */
  pull: () => void;
};

/** 後から当てた template で、外せるもの 1 つ (template-update D6) */
export type TemplateDetach = {
  /** template graph の名前 */
  name: string;
  /** 外す */
  detach: () => void;
};

export type PopupTarget =
  | { type: 'file'; id: FileId }
  | { type: 'sheet'; fileId: FileId; sheetId: SheetId };

type Props = {
  name: string;
  description: string;
  onSave: (name: string, description: string) => void;
  onDelete: () => void;
  onClose: () => void;
  deleteLabel: string;
  onExport?: () => void;
  /** この端末だけの File をアカウントに保存する (#253)。渡したときだけ出す */
  onSaveToAccount?: () => void;
  /** 既にあるシートに template を後から当てる (#355)。当てられるものがあるときだけ渡す */
  onApplyTemplate?: () => void;
  /**
   * 当てている template のうち、新しい版があるものを求める (template-update D2)。開いたときに 1 度だけ呼ぶ。
   * op-log を読むので非同期。新しい版が無ければ入口を出さない
   */
  templateUpdates?: () => Promise<TemplateUpdate[]>;
  /**
   * 外せる template (後から当てたもの、template-update D6・K4)。作るときに当てたものは入らない
   * (外せないので入口を出さない)
   */
  templateDetaches?: readonly TemplateDetach[];
};

export function SettingsPopup({
  name,
  description,
  onSave,
  onDelete,
  onClose,
  deleteLabel,
  onExport,
  onSaveToAccount,
  onApplyTemplate,
  templateUpdates,
  templateDetaches = [],
}: Props) {
  const t = useMessages();
  const [updates, setUpdates] = useState<TemplateUpdate[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 開いたときに 1 度だけ求める
  useEffect(() => {
    if (!templateUpdates) return;
    let cancelled = false;
    templateUpdates()
      .then((found) => {
        if (!cancelled) setUpdates(found);
      })
      .catch((error) =>
        console.warn('[template] 新しい版を確かめられなかった:', error),
      );
    return () => {
      cancelled = true;
    };
  }, []);
  const [draftName, setDraftName] = useState(name);
  const [draftDesc, setDraftDesc] = useState(description);
  const popupRef = useRef<HTMLDivElement>(null);
  const nameComposingRef = useRef(false);
  const descComposingRef = useRef(false);

  // 最新の draft/callback を ref で保持し, outside-click ハンドラの再登録を防ぐ
  const draftNameRef = useRef(draftName);
  draftNameRef.current = draftName;
  const draftDescRef = useRef(draftDesc);
  draftDescRef.current = draftDesc;
  const nameRef = useRef(name);
  nameRef.current = name;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // ポップオーバーの型 (visual language §6.1)。確定は「OK」(design language「保存 → OK」, #271) —
  // local first なので、利用者から見て「保存」という別の手順は無い。
  //
  // 外クリック / Escape はどちらも**破棄して閉じる** (ANA-126, マウント時に1回だけ登録)。
  //
  // 以前は外クリックが「保存して閉じる」だった。保存の口が 3 つ (ボタン・Enter・外クリック)
  // で破棄が Escape だけという非対称が「保存ボタンは何のためにあるのか」を分からなく
  // していた原因である (設計 `step1-refinement-ana118-file-deletion.md` D4)。
  // 保存 = ボタン / Enter、破棄 = 外クリック / Escape の 2 対 2 に揃える。
  // 操作マニュアル (`operation-manual-for-dev.md` のファイル管理) は元からこの仕様で,
  // 実装だけがずれていた。
  useEffect(() => {
    const mouseHandler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onCloseRef.current();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('mousedown', mouseHandler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', mouseHandler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, []);

  const handleSave = useCallback(() => {
    onSaveRef.current(
      draftNameRef.current.trim() || nameRef.current,
      draftDescRef.current,
    );
    onCloseRef.current();
  }, []);

  return (
    <div
      ref={popupRef}
      style={{
        position: 'absolute',
        right: 8,
        top: 0,
        zIndex: FLOATING_UI_Z_INDEX,
        background: color.bg,
        border: `1px solid ${color.border}`,
        borderRadius: radius.md,
        boxShadow: shadow.pop,
        padding: 12,
        width: 220,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label
          htmlFor="popup-name"
          style={{ fontSize: font.caption, color: color.textMuted }}
        >
          {t.settings.name}
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
          }}
          style={{
            fontSize: font.body,
            padding: '4px 6px',
            borderRadius: radius.sm,
            border: `1px solid ${color.border}`,
          }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label
          htmlFor="popup-desc"
          style={{ fontSize: font.caption, color: color.textMuted }}
        >
          {t.settings.description}
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
          placeholder={t.settings.descriptionPlaceholder}
          rows={3}
          style={{
            fontSize: font.body,
            padding: '4px 6px',
            borderRadius: radius.sm,
            border: `1px solid ${color.border}`,
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
      </div>
      {onApplyTemplate && (
        <Button icon={Shapes} onClick={onApplyTemplate}>
          {t.settings.applyTemplate}
        </Button>
      )}
      {updates.map((update) => (
        <Button key={update.name} icon={RefreshCw} onClick={update.pull}>
          {t.settings.pullTemplate(update.name)}
        </Button>
      ))}
      {templateDetaches.map((d) => (
        <Button key={d.name} icon={Unlink} onClick={d.detach}>
          {t.settings.detachTemplate(d.name)}
        </Button>
      ))}
      {onSaveToAccount && (
        // この端末だけの File を後から送る口 (#253)。ログインのときに「この端末に残す」と答えた File
        <Button icon={Upload} onClick={onSaveToAccount}>
          {t.settings.saveToAccount}
        </Button>
      )}
      {onExport && (
        <Button icon={FileDown} onClick={onExport}>
          {t.settings.export}
        </Button>
      )}
      {/* 破壊的な操作は「OK」から最も離す (visual language §6.2, #271)。
          間に区切りを置き、左端と右端に分ける */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: space[2],
          paddingTop: space[2],
          borderTop: `1px solid ${color.borderSubtle}`,
        }}
      >
        <Button variant="danger" icon={Trash2} onClick={onDelete}>
          {deleteLabel}
        </Button>
        <Button variant="primary" onClick={handleSave}>
          {t.settings.ok}
        </Button>
      </div>
    </div>
  );
}
