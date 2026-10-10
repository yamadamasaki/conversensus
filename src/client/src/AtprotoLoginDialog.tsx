import { useEffect, useRef, useState } from 'react';
import { DIALOG_WIDTH, DIALOG_Z_INDEX } from './ConfirmDialog';
import { color, font, overlay, radius, shadow } from './theme';

/** OAuth のときの案内。パスワードはこのアプリではなく PDS のページで入れる */
const OAUTH_NOTE =
  'あなたの PDS のページへ移ってログインし、このアプリに戻ってきます。';

type Props = {
  /**
   * ログインする。**OAuth では PDS のページへ移るので、この Promise は解けない**
   * (step3 Phase 2 D7)。パスワードは `needsPassword` のときだけ渡る
   */
  onLogin: (handle: string, password?: string) => Promise<void>;
  onCancel: () => void;
  /**
   * パスワード欄を出すか。**OAuth では出さない** — パスワードは PDS のページで入れるので、
   * このアプリには渡らない。出すのは App 結合テストのパスワードの実装だけである
   */
  needsPassword: boolean;
};

export function AtprotoLoginDialog({
  onLogin,
  onCancel,
  needsPassword,
}: Props) {
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
    if (!ready) return;
    setError('');
    setSubmitting(true);
    try {
      await onLogin(handle, needsPassword ? password : undefined);
    } catch (error) {
      // 文言は利用者向けに丸めるので、理由はコンソールに残す (原因を追えるように)
      console.warn('[atproto] ログインを始められなかった:', error);
      setError(
        needsPassword
          ? 'ログインに失敗しました。ハンドルまたはパスワードを確認してください。'
          : 'ログインを始められませんでした。ハンドルを確認してください。',
      );
      setSubmitting(false);
    }
  };
  const ready = Boolean(handle) && (!needsPassword || Boolean(password));

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
        aria-label="ATProto ログイン"
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
        <h3 style={{ margin: '0 0 16px', fontSize: font.heading }}>
          ATProto ログイン
        </h3>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="atproto-handle"
              style={{ display: 'block', fontSize: font.body, marginBottom: 4 }}
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
                fontSize: font.body,
                boxSizing: 'border-box',
                border: `1px solid ${color.border}`,
                borderRadius: radius.sm,
              }}
            />
          </div>
          {needsPassword ? (
            <div style={{ marginBottom: error ? 12 : 16 }}>
              <label
                htmlFor="atproto-password"
                style={{
                  display: 'block',
                  fontSize: font.body,
                  marginBottom: 4,
                }}
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
                  fontSize: font.body,
                  boxSizing: 'border-box',
                  border: `1px solid ${color.border}`,
                  borderRadius: radius.sm,
                }}
              />
            </div>
          ) : (
            <p
              style={{
                fontSize: font.body,
                color: color.textMuted,
                margin: '0 0 16px',
              }}
            >
              {OAUTH_NOTE}
            </p>
          )}
          {error && (
            <p
              style={{
                color: color.dangerText,
                fontSize: font.body,
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
              style={{
                padding: '6px 16px',
                fontSize: font.body,
                cursor: 'pointer',
              }}
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={submitting || !ready}
              style={{
                padding: '6px 16px',
                fontSize: font.body,
                background: !submitting && ready ? color.primary : color.border,
                color: color.textOnPrimary,
                border: 'none',
                borderRadius: radius.sm,
                cursor: !submitting && ready ? 'pointer' : 'not-allowed',
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
