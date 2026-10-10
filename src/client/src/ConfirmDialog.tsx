import { useEffect, useRef } from 'react';
import { color, font, overlay, radius, shadow } from './theme';

export const DIALOG_Z_INDEX = 1000;
export const DIALOG_WIDTH = 380;

type Props = {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
};

export function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'OK',
  cancelLabel = 'キャンセル',
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

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
        aria-label="確認"
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
        <p
          style={{
            margin: '0 0 20px',
            fontSize: font.body,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
          }}
        >
          {message}
        </p>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button
            type="button"
            ref={cancelRef}
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
            onClick={onConfirm}
            style={{
              padding: '6px 16px',
              fontSize: font.body,
              cursor: 'pointer',
              background: color.primary,
              color: color.textOnPrimary,
              border: 'none',
              borderRadius: radius.sm,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
