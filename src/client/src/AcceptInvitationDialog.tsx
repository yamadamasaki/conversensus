import { DIALOG_WIDTH, DIALOG_Z_INDEX } from './ConfirmDialog';
import type { InvitationPreview } from './hooks/useParticipation';

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
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="参加依頼の承認"
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
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7 }}>
          {preview.inviterLabel} さんが、あなた {preview.inviteeLabel} さんを
          ファイル “{preview.fileName}” の対話への参加を依頼しています。
        </p>

        {error && (
          <p
            role="alert"
            style={{ margin: '12px 0 0', fontSize: 12, color: '#c00' }}
          >
            {error}
          </p>
        )}

        <div
          style={{
            marginTop: 20,
            display: 'flex',
            gap: 8,
            justifyContent: 'space-between',
          }}
        >
          <button type="button" disabled={busy} onClick={onAccept}>
            参加する
          </button>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
