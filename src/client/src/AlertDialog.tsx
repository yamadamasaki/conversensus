import { useEffect, useRef } from 'react';
import { DIALOG_WIDTH, DIALOG_Z_INDEX } from './ConfirmDialog';
import { color, font, overlay, radius, shadow } from './theme';

type Props = {
  message: string;
  onClose: () => void;
  closeLabel?: string;
};

export function AlertDialog({ message, onClose, closeLabel = 'OK' }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
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
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="通知"
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
          if (e.key === 'Escape') onClose();
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
          }}
        >
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
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
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
