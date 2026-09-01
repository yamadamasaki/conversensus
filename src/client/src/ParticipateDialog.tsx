import { useEffect, useRef, useState } from 'react';
import { DIALOG_WIDTH, DIALOG_Z_INDEX } from './ConfirmDialog';

/**
 * 参加ダイアログ (step2 Phase 1)
 *
 * 仕様: `deepse/requirements/spec/participation.md`「UI の例」— 受け取った参加コードを
 * 貼って承認する。
 *
 * **貼られた文字列を検証するのは呼び出し側**である。ここは入力と、返ってきた理由の
 * 表示に徹する — 「貼り間違い」と「古いコード」でユーザにしてもらうことが違うので、
 * 理由をそのまま出せるようにしてある。
 */

type Props = {
  onSubmit: (code: string) => void;
  onCancel: () => void;
  busy?: boolean;
  error?: string | null;
};

export function ParticipateDialog({
  onSubmit,
  onCancel,
  busy = false,
  error = null,
}: Props) {
  const [code, setCode] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    onSubmit(trimmed);
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
        aria-label="共同作業に参加"
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: 24,
          width: DIALOG_WIDTH,
          maxWidth: '90vw',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>共同作業に参加</h2>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: '#666' }}>
          受け取った参加コードを貼り付けてほしい。
        </p>
        <textarea
          ref={inputRef}
          value={code}
          aria-label="参加コード"
          disabled={busy}
          rows={4}
          onChange={(e) => setCode(e.target.value)}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: 6,
            fontSize: 12,
            fontFamily: 'monospace',
            resize: 'vertical',
          }}
        />
        {error && (
          <p
            role="alert"
            style={{ margin: '8px 0 0', fontSize: 12, color: '#c00' }}
          >
            {error}
          </p>
        )}
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <button type="button" disabled={busy} onClick={submit}>
            参加する
          </button>
        </div>
      </div>
    </div>
  );
}
