import { describe, expect, test } from 'bun:test';
import {
  type BatchId,
  foldParticipation,
  type JudgmentBatch,
  type JudgmentOp,
} from '@conversensus/shared';
import { rosterRows } from './rosterView';

const A = 'did:plc:alice';
const B = 'did:plc:bob';
const C = 'did:plc:carol';

const deps = { isLocalDid: () => true };

let seq = 0;
const jb = (did: string, clock: number, ops: JudgmentOp[]): JudgmentBatch => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` as BatchId,
  actor: `${did}#dev-1`,
  clock,
  timestamp: 0,
  ops,
});

const genesis = (): JudgmentOp => ({ kind: 'participation.genesis' });
const invite = (target: string): JudgmentOp => ({
  kind: 'participation.invite',
  target,
});
const accept = (): JudgmentOp => ({ kind: 'participation.accept' });
const resign = (): JudgmentOp => ({ kind: 'participation.resign' });
const revoke = (target: string): JudgmentOp => ({
  kind: 'participation.revoke',
  target,
});

const view = (batches: JudgmentBatch[], viewer: string) =>
  rosterRows(foldParticipation(batches, deps), viewer);

const rowOf = (rows: ReturnType<typeof rosterRows>, did: string) =>
  rows.find((r) => r.did === did);

describe('状態', () => {
  test('招待済は sent、承認済は accepted', () => {
    const rows = view(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(A, 3, [invite(C)]),
        jb(B, 4, [accept()]),
      ],
      A,
    );
    expect(rowOf(rows, B)?.status).toBe('accepted');
    expect(rowOf(rows, C)?.status).toBe('sent');
    expect(rowOf(rows, A)?.status).toBe('accepted');
  });

  test('取り消しは revoked、自分から降りたのは resigned', () => {
    const rows = view(
      [
        jb(A, 1, [genesis()]),
        jb(A, 2, [invite(B)]),
        jb(B, 3, [accept()]),
        jb(A, 4, [invite(C)]),
        jb(C, 5, [accept()]),
        jb(A, 6, [revoke(B)]),
        jb(C, 7, [resign()]),
      ],
      A,
    );
    expect(rowOf(rows, B)?.status).toBe('revoked');
    expect(rowOf(rows, C)?.status).toBe('resigned');
  });

  test('招待されていない actor の承認は invalid として出る', () => {
    // 名簿の participating にも invited にも現れない。捨てた op と理由を返している
    // のは、この 1 行を出すためである
    const rows = view([jb(A, 1, [genesis()]), jb(C, 2, [accept()])], A);
    expect(rowOf(rows, C)?.status).toBe('invalid');
  });

  test('invalid は後から正規に招待されたら上書きしない', () => {
    const rows = view(
      [jb(A, 1, [genesis()]), jb(C, 2, [accept()]), jb(A, 3, [invite(C)])],
      A,
    );
    expect(rowOf(rows, C)?.status).toBe('sent');
  });

  test('他 PDS への招待は一覧に載せない', () => {
    // 名簿に関わったことが一度も無い。承認だけを invalid にするのは、
    // 「その人が参加しようとした」事実が本人にも招待者にも見えるべきだからである
    const rows = rosterRows(
      foldParticipation(
        [jb(A, 1, [genesis()]), jb(A, 2, [invite('did:plc:elsewhere')])],
        { isLocalDid: (d) => d !== 'did:plc:elsewhere' },
      ),
      A,
    );
    expect(rows.map((r) => r.did)).toEqual([A]);
  });

  test('招待者を出す — 作成者には招待者が無い', () => {
    const rows = view([jb(A, 1, [genesis()]), jb(A, 2, [invite(B)])], A);
    expect(rowOf(rows, B)?.inviter).toBe(A);
    expect(rowOf(rows, A)?.inviter).toBeUndefined();
  });
});

describe('action は立場で決まる', () => {
  const batches = [
    jb(A, 1, [genesis()]),
    jb(A, 2, [invite(B)]),
    jb(B, 3, [accept()]),
    jb(A, 4, [invite(C)]),
  ];

  test('招待された本人は覗いて承認できる', () => {
    expect(rowOf(view(batches, C), C)?.available).toEqual([
      'preview',
      'accept',
    ]);
  });

  test('他人は、招待された行を承認できない', () => {
    expect(rowOf(view(batches, A), C)?.available).toEqual(['revoke']);
  });

  test('参加している本人は降りられるが、取り消しはできない', () => {
    // 自分を revoke するのは resign と同じことなので、action を二重に出さない
    expect(rowOf(view(batches, B), B)?.available).toEqual(['resign']);
  });

  test('参加者は他人を取り消せる', () => {
    expect(rowOf(view(batches, B), C)?.available).toEqual(['revoke']);
  });

  test('参加していない viewer は他人に何もできない', () => {
    // pre 条件と同じ条件でグレイアウトする。押せてしまって畳み込みで捨てられるより、
    // 押せない方がよい
    expect(rowOf(view(batches, C), B)?.available).toEqual([]);
  });

  test('外れた行には何もできない', () => {
    const rows = view([...batches, jb(A, 5, [revoke(B)])], A);
    expect(rowOf(rows, B)?.status).toBe('revoked');
    expect(rowOf(rows, B)?.available).toEqual([]);
  });
});

describe('並び', () => {
  test('DID 順に並ぶ — 表示が読むたびに入れ替わらない', () => {
    const rows = view(
      [jb(A, 1, [genesis()]), jb(A, 2, [invite(C)]), jb(A, 3, [invite(B)])],
      A,
    );
    expect(rows.map((r) => r.did)).toEqual([A, B, C]);
  });
});
