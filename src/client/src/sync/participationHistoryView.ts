/**
 * 参加履歴を画面の表に整形する (step2)
 *
 * 仕様: `deepse/requirements/spec/participation.md`「参加履歴」
 * (図: `deepse/requirements/spec/participation/history.png`)
 *
 * 畳み込みが返すのは**出来事の列**で、画面が出すのは**ラウンドの表**である。
 * 1 行が「依頼 → (参加) → (取り止め)」の 1 巡を表し、依頼日時の降順に並ぶ。
 *
 * | 依頼 | 依頼取り止め | 参加 | 参加取り止め |
 *
 * **取り消しが 2 つの列に分かれる。**同じ `participation.revoke` でも、承認より前なら
 * 「依頼取り止め」、後なら「参加取り止め」である。仕様が「承認の**前後を問わず**同じ
 * 取り消しとして扱う」と定めているので op は 1 つしかなく、**どちらの列に置くかは
 * その巡に参加があったかで決まる**。
 */

import type {
  Did,
  ParticipationEvent,
  ParticipationEventKind,
} from '@conversensus/shared';

/** 表のセル 1 つ。日時と、それを行った人 */
export type RoundMark = {
  /** batch の timestamp。**genesis は 0 に固定されている** (`formatDay` が `—` にする) */
  at: number;
  by: Did;
};

/** 表の 1 行 = 参加の 1 巡 */
export type ParticipationRound = {
  /** 依頼。**作成者 (genesis) の巡には無い** — 誰にも依頼されていない */
  invited?: RoundMark;
  /** 承認より前に取り消された */
  inviteRevoked?: RoundMark;
  /** 参加した。作成者は file を作った時点で参加している */
  joined?: RoundMark;
  /** 参加を取り止めた。自分で辞めた (resign) か辞めさせられた (revoke) かを問わない */
  left?: RoundMark;
};

/**
 * 出来事の列をラウンドの表にする。**依頼日時の降順** (新しいものが上)。
 *
 * 依頼のたびに新しい巡が始まる。**再依頼を前の巡に畳まない** — 「依頼したが承認されず、
 * もう一度依頼した」は 2 度の依頼であって、1 度ではない。
 */
export function participationRounds(
  events: readonly ParticipationEvent[],
): ParticipationRound[] {
  const rounds: ParticipationRound[] = [];
  const mark = (e: ParticipationEvent): RoundMark => ({
    at: e.timestamp,
    by: e.by,
  });
  /**
   * 今の巡。無ければ開く。
   *
   * 承認や取り消しが依頼より先に現れることは畳み込みが防ぐ (pre 条件) が、
   * **ここが落ちると履歴が丸ごと消える**ので、開いて受け止める方を採る。
   */
  const current = (): ParticipationRound => {
    const last = rounds.at(-1);
    if (last) return last;
    const opened: ParticipationRound = {};
    rounds.push(opened);
    return opened;
  };

  for (const event of events) {
    const kind: ParticipationEventKind = event.kind;
    switch (kind) {
      case 'genesis':
        // 作成者の巡には依頼が無い
        rounds.push({ joined: mark(event) });
        break;
      case 'invite':
        rounds.push({ invited: mark(event) });
        break;
      case 'accept':
        current().joined = mark(event);
        break;
      case 'resign':
        current().left = mark(event);
        break;
      case 'revoke': {
        // 承認の前後で置く列が変わる
        const round = current();
        if (round.joined) round.left = mark(event);
        else round.inviteRevoked = mark(event);
        break;
      }
    }
  }
  return rounds.reverse();
}

/**
 * 日時を日付にする。**時刻は出さない** (仕様: 今の時点では時刻は要らない)。
 *
 * `0` は `—` にする。genesis の timestamp が 0 に固定されているためで、
 * **作成者の参加日時はどこにも記録されていない** — batch がべき等であるために
 * id も clock も timestamp も fileId と actor から決まるからである。1970 年と
 * 出すよりは「記録が無い」と分かる方がよい。
 */
export function formatDay(at: number): string {
  if (at <= 0) return '—';
  const d = new Date(at);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}/${mm}/${dd}`;
}
