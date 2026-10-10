import type { Did } from '@conversensus/shared';
import type { ParticipationRound } from './sync/participationHistoryView';
import { formatDay } from './sync/participationHistoryView';
import { color, font } from './theme';
import { Button } from './ui/Button';
import { Dialog, DialogActions } from './ui/Dialog';

const HISTORY_DIALOG_WIDTH = 560;
/** 参加者一覧の上に重ねて開く */
const ABOVE_ROSTER = 1;

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
        <span style={{ color: color.textMuted }}>({labelOf(mark.by)})</span>
      </>
    ) : (
      ''
    );

  return (
    <Dialog
      kind="alert"
      label={`参加履歴 - ${label}`}
      title={`参加履歴 - ${label}`}
      onDismiss={onClose}
      width={HISTORY_DIALOG_WIDTH}
      scroll
      layer={ABOVE_ROSTER}
    >
      {rounds.length === 0 ? (
        <p style={{ fontSize: font.body, color: color.textMuted }}>
          まだ記録がない。
        </p>
      ) : (
        <table
          style={{
            width: '100%',
            fontSize: font.body,
            borderCollapse: 'collapse',
          }}
        >
          <thead>
            <tr style={{ textAlign: 'left', color: color.textMuted }}>
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
                style={{
                  borderTop: `1px solid ${color.borderSubtle}`,
                  verticalAlign: 'top',
                }}
              >
                <td style={{ padding: '6px' }}>{cell(round.invited)}</td>
                <td style={{ padding: '6px' }}>{cell(round.inviteRevoked)}</td>
                <td style={{ padding: '6px' }}>{cell(round.joined)}</td>
                <td style={{ padding: '6px' }}>{cell(round.left)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <DialogActions>
        <Button variant="primary" onClick={onClose}>
          閉じる
        </Button>
      </DialogActions>
    </Dialog>
  );
}
