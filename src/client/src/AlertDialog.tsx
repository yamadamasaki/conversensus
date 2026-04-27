import { useEffect, useRef } from 'react';

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
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
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
          background: '#fff',
          borderRadius: 8,
          padding: 24,
          width: 380,
          maxWidth: '90vw',
          boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <p
          style={{
            margin: '0 0 20px',
            fontSize: 14,
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
              fontSize: 13,
              cursor: 'pointer',
              background: '#4f6ef7',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
            }}
          >
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
