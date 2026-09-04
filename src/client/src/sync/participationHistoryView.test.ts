import { describe, expect, test } from 'bun:test';
import type {
  BatchId,
  Did,
  JudgmentBatch,
  JudgmentOp,
  ParticipationEvent,
} from '@conversensus/shared';
import { foldParticipation } from '@conversensus/shared';
import { formatDay, participationRounds } from './participationHistoryView';

const A = 'did:plc:alice' as Did;
const B = 'did:plc:bob' as Did;
const C = 'did:plc:carol' as Did;

let seq = 0;
const jb = (
  did: string,
  clock: number,
  ops: JudgmentOp[],
  timestamp = 0,
): JudgmentBatch => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` as BatchId,
  actor: `${did}#dev-1`,
  clock,
  timestamp,
  ops,
});

const genesis = (): JudgmentOp => ({ kind: 'participation.genesis' });
const invite = (target: Did): JudgmentOp => ({
  kind: 'participation.invite',
  target,
});
const accept = (): JudgmentOp => ({
  kind: 'participation.accept',
  inviter: A,
});
const resign = (): JudgmentOp => ({ kind: 'participation.resign' });
const revoke = (target: Did): JudgmentOp => ({
  kind: 'participation.revoke',
  target,
});

/** 本物の畳み込みを通す。**捨てられた op が履歴に載らないこと**が要点なので */
const eventsOf = (
  batches: JudgmentBatch[],
  did: Did,
): readonly ParticipationEvent[] =>
  foldParticipation(batches, { isLocalDid: () => true }).history.get(did) ?? [];

describe('participationRounds', () => {
  test('依頼のみ (依頼中)', () => {
    const events = eventsOf(
      [jb(A, 1, [genesis()]), jb(A, 2, [invite(B)], 2000)],
      B,
    );
    expect(participationRounds(events)).toEqual([
      { invited: { at: 2000, by: A } },
    ]);
  });

  test('依頼と参加 (参加中)', () => {
    const events = eventsOf(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)], 2000),
        jb(B, 3, [accept()], 3000),
      ],
      B,
    );
    expect(participationRounds(events)).toEqual([
      { invited: { at: 2000, by: A }, joined: { at: 3000, by: B } },
    ]);
  });

  test('承認より前の取り消しは「依頼取り止め」に入る', () => {
    const events = eventsOf(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)], 2000),
        jb(A, 3, [revoke(B)], 3000),
      ],
      B,
    );
    expect(participationRounds(events)).toEqual([
      { invited: { at: 2000, by: A }, inviteRevoked: { at: 3000, by: A } },
    ]);
  });

  test('承認より後の取り消しは「参加取り止め」に入る', () => {
    // 同じ participation.revoke でも置く列が変わる。仕様が「承認の前後を問わず
    // 同じ取り消しとして扱う」と定めているので op は 1 つしかない
    const events = eventsOf(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)], 2000),
        jb(B, 3, [accept()], 3000),
        jb(A, 4, [revoke(B)], 4000),
      ],
      B,
    );
    expect(participationRounds(events)).toEqual([
      {
        invited: { at: 2000, by: A },
        joined: { at: 3000, by: B },
        left: { at: 4000, by: A },
      },
    ]);
  });

  test('自分で辞めたときも「参加取り止め」で, 実行者は本人になる', () => {
    const events = eventsOf(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)], 2000),
        jb(B, 3, [accept()], 3000),
        jb(B, 4, [resign()], 4000),
      ],
      B,
    );
    expect(participationRounds(events)[0]?.left).toEqual({
      at: 4000,
      by: B,
    });
  });

  test('作成者の巡には依頼が無い', () => {
    // 実際の genesis batch は timestamp が 0 に固定されている
    // (`participationGenesisBatch`)。畳み込みはそれをそのまま載せるので,
    // 作成者の参加日時は `formatDay` が `—` にする
    const events = eventsOf([jb(A, 1, [genesis()], 0)], A);
    expect(participationRounds(events)).toEqual([{ joined: { at: 0, by: A } }]);
  });

  test('依頼日時の降順に並ぶ — 新しい巡が上', () => {
    const events = eventsOf(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)], 2000),
        jb(B, 3, [accept()], 3000),
        jb(B, 4, [resign()], 4000),
        jb(A, 5, [invite(B)], 5000),
      ],
      B,
    );
    const rounds = participationRounds(events);
    expect(rounds.map((r) => r.invited?.at)).toEqual([5000, 2000]);
  });

  test('再依頼は前の巡に畳まない', () => {
    // 「依頼したが承認されず, もう一度依頼した」は 2 度の依頼である
    const events = eventsOf(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)], 2000),
        jb(A, 3, [invite(B)], 3000),
      ],
      B,
    );
    expect(participationRounds(events)).toHaveLength(2);
  });

  test('捨てられた op は履歴に載らない', () => {
    // C は参加していないので, その取り消しは pre 条件で捨てられる。
    // **生の batch から組んでいたら「依頼取り止め」が出てしまう**
    const events = eventsOf(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)], 2000),
        jb(C, 3, [revoke(B)], 3000),
      ],
      B,
    );
    expect(participationRounds(events)).toEqual([
      { invited: { at: 2000, by: A } },
    ]);
  });

  test('出来事が無ければ行も無い', () => {
    expect(participationRounds([])).toEqual([]);
  });
});

describe('formatDay', () => {
  test('日付にする — 時刻は出さない', () => {
    expect(formatDay(new Date(2026, 7, 31, 13, 45).getTime())).toBe(
      '2026/08/31',
    );
  });

  test('月日は 2 桁に揃える', () => {
    expect(formatDay(new Date(2026, 0, 5).getTime())).toBe('2026/01/05');
  });

  test('0 は — にする — 作成者の参加日時は記録されていない', () => {
    // genesis の timestamp は batch のべき等のために 0 固定である。
    // 1970 年と出すより「記録が無い」と分かる方がよい
    expect(formatDay(0)).toBe('—');
  });
});
