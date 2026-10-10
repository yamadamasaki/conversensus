import type { InvitationPreview } from './hooks/useParticipation';
import { color, space } from './theme';
import { Button } from './ui/Button';
import { Dialog, DialogActions } from './ui/Dialog';

/**
 * 参加依頼の承認ダイアログ (step2)
 *
 * 仕様: `deepse/requirements/spec/participation/accept.png`
 *
 * **何に参加するのかを見せてから承認させる。**参加コードを貼っただけで参加が
 * 成立すると、渡し間違いや貼り間違いに気づけない。出すのは 3 つ — 誰が、あなたを、
 * どのファイルに。**どれも DID や FileId ではなく名前で出す** (`labelCache`)。
 *
 * 自分のハンドル名を出すのは、**コードが自分宛であることを目で確かめられる**ように
 * するためである。宛先違いは畳み込みより手前で弾いているが、弾かれた理由を読むより
 * 「誰宛か」が見えている方がよい。
 */

type Props = {
  preview: InvitationPreview;
  onAccept: () => void;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
};

export function AcceptInvitationDialog({
  preview,
  onAccept,
  onClose,
  busy = false,
  error = null,
}: Props) {
  return (
    <Dialog kind="input" label="参加依頼の承認" onDismiss={onClose}>
      <p style={{ margin: 0 }}>
        {preview.inviterLabel} さんが、あなた {preview.inviteeLabel} さんを File
        “{preview.fileName}” の対話への参加を依頼しています。
      </p>

      {error && (
        <p
          role="alert"
          style={{ margin: `${space[3]}px 0 0`, color: color.dangerText }}
        >
          {error}
        </p>
      )}

      <DialogActions>
        <Button onClick={onClose}>閉じる</Button>
        <Button variant="primary" disabled={busy} onClick={onAccept}>
          参加する
        </Button>
      </DialogActions>
    </Dialog>
  );
}
