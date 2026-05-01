import type { FileId, SheetId } from '@conversensus/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

export const FLOATING_UI_Z_INDEX = 100;

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
};

export function SettingsPopup({
  name,
  description,
  onSave,
  onDelete,
  onClose,
  deleteLabel,
  onExport,
}: Props) {
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

  // クリック外で保存 / Escape で破棄してポップアップを閉じる (マウント時に1回だけ登録)
  useEffect(() => {
    const mouseHandler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onSaveRef.current(
          draftNameRef.current.trim() || nameRef.current,
          draftDescRef.current,
        );
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
      {onExport && (
        <button
          type="button"
          onClick={onExport}
          style={{
            fontSize: 12,
            padding: '4px 8px',
            borderRadius: 4,
            border: '1px solid #888',
            background: 'none',
            color: '#555',
            cursor: 'pointer',
            width: '100%',
          }}
        >
          エクスポート (.conversensus)
        </button>
      )}
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
