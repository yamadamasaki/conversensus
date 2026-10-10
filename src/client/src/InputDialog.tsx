import { useEffect, useRef, useState } from 'react';
import { DIALOG_WIDTH, DIALOG_Z_INDEX } from './ConfirmDialog';
import { color, font, overlay, radius, shadow } from './theme';

type Props = {
  message: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  initialValue?: string;
  submitLabel?: string;
  cancelLabel?: string;
};

export function InputDialog({
  message,
  onSubmit,
  onCancel,
  initialValue = '',
  submitLabel = 'OK',
  cancelLabel = 'キャンセル',
}: Props) {
  const [value, setValue] = useState(initialValue);
  const composingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = () => {
    if (!value.trim()) return;
    onSubmit(value.trim());
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: モーダル背景のクリック閉じ
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: overlay,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: DIALOG_Z_INDEX,
      }}
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="入力"
        style={{
          background: color.bg,
          borderRadius: radius.md,
          padding: 24,
          width: DIALOG_WIDTH,
          maxWidth: '90vw',
          boxShadow: shadow.dialog,
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
      >
        <label
          htmlFor="input-dialog-field"
          style={{
            display: 'block',
            margin: '0 0 12px',
            fontSize: font.body,
            lineHeight: 1.6,
          }}
        >
          {message}
        </label>
        <input
          id="input-dialog-field"
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={(e) => {
            if (composingRef.current) return;
            if (e.key !== 'Enter') return;
            // **既定の動作を止める。**送信の後に別のダイアログ (検査の断りなど) が出て
            // ボタンにフォーカスが移ると、同じ打鍵の keypress がそのボタンに届いて押してしまい、
            // 出たダイアログが一瞬で閉じる (step3 Phase 6 の実機確認で見つかった)
            e.preventDefault();
            handleSubmit();
          }}
          style={{
            width: '100%',
            padding: '8px',
            fontSize: font.body,
            borderRadius: radius.sm,
            border: `1px solid ${color.border}`,
            boxSizing: 'border-box',
          }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '6px 16px',
              fontSize: font.body,
              cursor: 'pointer',
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!value.trim()}
            style={{
              padding: '6px 16px',
              fontSize: font.body,
              cursor: value.trim() ? 'pointer' : 'not-allowed',
              background: value.trim() ? color.primary : color.border,
              color: color.textOnPrimary,
              border: 'none',
              borderRadius: radius.sm,
            }}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
