import { useEffect, useRef, useState } from 'react';
import { useMessages } from './i18n/messages';
import { color, font, monospace, radius, space } from './theme';
import { Button } from './ui/Button';
import { Dialog, DialogActions } from './ui/Dialog';

/**
 * 参加コードの入力ダイアログ (step2 Phase 1)
 *
 * 仕様: `deepse/requirements/spec/participation/invitation.png` — 受け取った参加コードを
 * 貼る。**ここでは参加しない** — OK で検めて、何に参加するのかを見せてから承認する
 * (`AcceptInvitationDialog`)。
 *
 * **貼られた文字列を検証するのは呼び出し側**である。ここは入力と、返ってきた理由の
 * 表示に徹する — 「貼り間違い」と「古いコード」でユーザにしてもらうことが違うので、
 * 理由をそのまま出せるようにしてある。
 */

type Props = {
  /** 貼られたコードを検める。**参加はまだ成立しない** */
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
  const t = useMessages();
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
    <Dialog
      kind="input"
      label={t.participate.title}
      title={t.participate.heading}
      onDismiss={onCancel}
    >
      <p style={{ margin: `0 0 ${space[3]}px`, color: color.textMuted }}>
        {t.participate.body}
      </p>
      <textarea
        ref={inputRef}
        value={code}
        aria-label={t.participate.code}
        disabled={busy}
        rows={4}
        onChange={(e) => setCode(e.target.value)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: space[2],
          fontSize: font.body,
          fontFamily: monospace,
          borderRadius: radius.sm,
          border: `1px solid ${color.border}`,
          resize: 'vertical',
        }}
      />
      {error && (
        <p
          role="alert"
          style={{ margin: `${space[2]}px 0 0`, color: color.dangerText }}
        >
          {error}
        </p>
      )}
      <DialogActions>
        <Button onClick={onCancel}>{t.common.cancel}</Button>
        <Button variant="primary" disabled={busy} onClick={submit}>
          {t.common.ok}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
