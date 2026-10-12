import { useEffect, useRef, useState } from 'react';
import { useMessages } from './i18n/messages';
import { color, font, radius } from './theme';
import { Button } from './ui/Button';
import { Dialog, DialogActions } from './ui/Dialog';

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
  const t = useMessages();
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
      setError(needsPassword ? t.login.failed : t.login.couldNotStart);
      setSubmitting(false);
    }
  };
  const ready = Boolean(handle) && (!needsPassword || Boolean(password));

  return (
    <Dialog
      kind="input"
      label={t.login.title}
      title={t.login.title}
      onDismiss={onCancel}
    >
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <label
            htmlFor="atproto-handle"
            style={{ display: 'block', fontSize: font.body, marginBottom: 4 }}
          >
            {t.login.handle}
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
              {t.login.password}
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
            {/* OAuth のときの案内。パスワードはこのアプリではなく PDS のページで入れる */}
            {t.login.oauthNote}
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
        <DialogActions>
          <Button onClick={onCancel}>{t.common.cancel}</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={submitting || !ready}
          >
            {submitting ? t.login.submitting : t.login.submit}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
