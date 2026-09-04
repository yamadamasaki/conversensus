import type { Did } from '@conversensus/shared';
import { DIALOG_Z_INDEX } from './ConfirmDialog';
import type { ParticipationRound } from './sync/participationHistoryView';
import { formatDay } from './sync/participationHistoryView';

/**
 * 参加履歴ダイアログ (step2)
 *
 * 仕様: `deepse/requirements/spec/participation.md`「参加履歴」
 * (図: `deepse/requirements/spec/participation/history.png`)
 *
 * **判断はここに書かない。**どの列に何が入るかは `participationRounds` が決めており、
 * ここは日付に直して並べるだけである。同じ `participation.revoke` が「依頼取り止め」に
 * なるか「参加取り止め」になるかは、その巡に参加があったかで決まる — その導出を
 * 画面に持つと、畳み込みが捨てた op まで拾ってしまう。
 */

const COLUMNS = ['依頼', '依頼取り止め', '参加', '参加取り止め'] as const;

type Props = {
  /** 誰の履歴か。**DID ではなくハンドル名を渡す** */
  label: string;
  rounds: readonly ParticipationRound[];
  /** DID → ハンドル名。実行者の欄に使う */
  labelOf: (did: Did) => string;
  onClose: () => void;
};

export function ParticipationHistoryDialog({
  label,
  rounds,
  labelOf,
  onClose,
}: Props) {
  const cell = (mark: ParticipationRound['invited']) =>
    mark ? (
      <>
        {formatDay(mark.at)}
        <br />
        <span style={{ color: '#666' }}>({labelOf(mark.by)})</span>
      </>
    ) : (
      ''
    );

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
        zIndex: DIALOG_Z_INDEX + 1,
      }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`参加履歴 - ${label}`}
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: 24,
          width: 560,
          maxWidth: '90vw',
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 16px', fontSize: 16 }}>参加履歴 - {label}</h2>

        {rounds.length === 0 ? (
          <p style={{ fontSize: 13, color: '#666' }}>まだ記録がない。</p>
        ) : (
          <table
            style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}
          >
            <thead>
              <tr style={{ textAlign: 'left', color: '#666' }}>
                {COLUMNS.map((c) => (
                  <th key={c} style={{ padding: '4px 6px', fontWeight: 500 }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rounds.map((round, i) => (
                <tr
                  // 巡そのものに id は無い。並びは `participationRounds` が決めていて
                  // 画面側で並べ替えないので、位置を key にしてよい
                  // biome-ignore lint/suspicious/noArrayIndexKey: 並べ替えない表である
                  key={i}
                  style={{ borderTop: '1px solid #eee', verticalAlign: 'top' }}
                >
                  <td style={{ padding: '6px' }}>{cell(round.invited)}</td>
                  <td style={{ padding: '6px' }}>
                    {cell(round.inviteRevoked)}
                  </td>
                  <td style={{ padding: '6px' }}>{cell(round.joined)}</td>
                  <td style={{ padding: '6px' }}>{cell(round.left)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ marginTop: 20, textAlign: 'right' }}>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
