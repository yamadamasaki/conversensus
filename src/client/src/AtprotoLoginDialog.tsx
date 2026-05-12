import { useEffect, useRef, useState } from 'react';
import { DIALOG_WIDTH, DIALOG_Z_INDEX } from './ConfirmDialog';

type Props = {
  onLogin: (handle: string, password: string) => Promise<void>;
  onCancel: () => void;
};

export function AtprotoLoginDialog({ onLogin, onCancel }: Props) {
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const handleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    handleRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handle || !password) return;
    setError('');
    setSubmitting(true);
    try {
      await onLogin(handle, password);
    } catch {
      setError(
        'ログインに失敗しました。ハンドルまたはパスワードを確認してください。',
      );
      setSubmitting(false);
    }
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
        aria-label="ATProto ログイン"
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: 24,
          width: DIALOG_WIDTH,
          maxWidth: '90vw',
          boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>ATProto ログイン</h3>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="atproto-handle"
              style={{ display: 'block', fontSize: 13, marginBottom: 4 }}
            >
              ハンドル
            </label>
            <input
              id="atproto-handle"
              ref={handleRef}
              type="text"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="user.bsky.social"
              style={{
                width: '100%',
                padding: '6px 8px',
                fontSize: 13,
                boxSizing: 'border-box',
                border: '1px solid #ccc',
                borderRadius: 4,
              }}
            />
          </div>
          <div style={{ marginBottom: error ? 12 : 16 }}>
            <label
              htmlFor="atproto-password"
              style={{ display: 'block', fontSize: 13, marginBottom: 4 }}
            >
              パスワード
            </label>
            <input
              id="atproto-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                fontSize: 13,
                boxSizing: 'border-box',
                border: '1px solid #ccc',
                borderRadius: 4,
              }}
            />
          </div>
          {error && (
            <p
              style={{
                color: '#e55',
                fontSize: 12,
                margin: '0 0 12px',
                lineHeight: 1.4,
              }}
            >
              {error}
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{ padding: '6px 16px', fontSize: 13, cursor: 'pointer' }}
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={submitting || !handle || !password}
              style={{
                padding: '6px 16px',
                fontSize: 13,
                background:
                  !submitting && handle && password ? '#4f6ef7' : '#ccc',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor:
                  !submitting && handle && password ? 'pointer' : 'not-allowed',
              }}
            >
              {submitting ? 'ログイン中…' : 'ログイン'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
