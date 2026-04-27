import { useEffect, useRef, useState } from 'react';

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
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
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
          background: '#fff',
          borderRadius: 8,
          padding: 24,
          width: 380,
          maxWidth: '90vw',
          boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
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
            fontSize: 14,
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
            if (e.key === 'Enter') handleSubmit();
          }}
          style={{
            width: '100%',
            padding: '8px',
            fontSize: 13,
            borderRadius: 4,
            border: '1px solid #ccc',
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
            style={{ padding: '6px 16px', fontSize: 13, cursor: 'pointer' }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!value.trim()}
            style={{
              padding: '6px 16px',
              fontSize: 13,
              cursor: value.trim() ? 'pointer' : 'not-allowed',
              background: value.trim() ? '#4f6ef7' : '#ccc',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
            }}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
