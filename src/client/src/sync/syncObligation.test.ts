import { describe, expect, test } from 'bun:test';
import type {
  BatchId,
  Did,
  JudgmentBatch,
  JudgmentOp,
} from '@conversensus/shared';
import { foldParticipation } from '@conversensus/shared';
import { rejoinObligation } from './syncObligation';

const A = 'did:plc:alice' as Did;
const B = 'did:plc:bob' as Did;

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
const accept = (inviter = A): JudgmentOp => ({
  kind: 'participation.accept',
  inviter,
});
const revoke = (target: string): JudgmentOp => ({
  kind: 'participation.revoke',
  target,
});
const resign = (): JudgmentOp => ({ kind: 'participation.resign' });
const reopen = (): JudgmentOp => ({ kind: 'participation.reopen' });

const fold = (batches: JudgmentBatch[]) =>
  foldParticipation(batches, { isLocalDid: () => true });

describe('rejoinObligation', () => {
  test('初参加には義務が無い — 取りこぼしようがない', () => {
    const p = fold([
      jb(A, 1, [genesis()]),
      jb(A, 2, [invite(B)]),
      jb(B, 3, [accept()]),
    ]);
    expect(rejoinObligation(p, A)).toBeNull();
    expect(rejoinObligation(p, B)).toBeNull();
  });

  test('名簿にいない人にも義務が無い', () => {
    expect(rejoinObligation(fold([jb(A, 1, [genesis()])]), B)).toBeNull();
  });

  test('依頼されただけの人にも義務が無い — 期間が 1 つも開いていない', () => {
    const p = fold([jb(A, 1, [genesis()]), jb(A, 2, [invite(B)])]);
    expect(rejoinObligation(p, B)).toBeNull();
  });

  test('⚠️ 離脱している間は義務が無い', () => {
    // 義務は「再参加する前に同期する」ことである。離脱したままの人は書けないので、
    // 読み取り専用にする理由が無い (共有が切れている表示は別に出ている)
    const p = fold([
      jb(A, 1, [genesis()]),
      jb(A, 2, [invite(B)]),
      jb(B, 3, [accept()]),
      jb(A, 4, [revoke(B)]),
    ]);
    expect(rejoinObligation(p, B)).toBeNull();
  });

  test('再参加すると義務が生まれ, 最後の期間の始点を返す', () => {
    const p = fold([
      jb(A, 1, [genesis()]),
      jb(A, 2, [invite(B)]),
      jb(B, 3, [accept()]),
      jb(A, 4, [revoke(B)]),
      jb(A, 5, [invite(B)]),
      jb(B, 6, [accept()]),
    ]);
    expect(rejoinObligation(p, B)).toBe(6);
  });

  test('⚠️ 何度も再参加すると, 鍵はそのたびに変わる', () => {
    // **真偽値では足りない。**「一度同期した」だけを覚えると, もう一度離脱・再参加
    // したときに義務が生まれない。始点は再参加のたびに変わるので鍵として使える
    const p = fold([
      jb(A, 1, [genesis()]),
      jb(A, 2, [invite(B)]),
      jb(B, 3, [accept()]),
      jb(A, 4, [revoke(B)]),
      jb(A, 5, [invite(B)]),
      jb(B, 6, [accept()]),
      jb(A, 7, [revoke(B)]),
      jb(A, 8, [invite(B)]),
      jb(B, 9, [accept()]),
    ]);
    expect(rejoinObligation(p, B)).toBe(9);
  });

  test('引き取りも期間を開くので, 同じ義務が生まれる', () => {
    // 誰もいなくなった File を引き取った人も, 離脱中の他人の編集を取りこぼしている
    const p = fold([
      jb(A, 1, [genesis()]),
      jb(A, 2, [invite(B)]),
      jb(B, 3, [accept()]),
      jb(B, 4, [revoke(A)]),
      jb(B, 5, [resign()]),
      jb(A, 9, [reopen()]),
    ]);
    expect(rejoinObligation(p, A)).toBe(9);
  });

  test('作成者が一度も離れていなければ義務は無い', () => {
    const p = fold([
      jb(A, 1, [genesis()]),
      jb(A, 2, [invite(B)]),
      jb(B, 3, [accept()]),
      jb(A, 4, [revoke(B)]),
    ]);
    expect(rejoinObligation(p, A)).toBeNull();
  });
});
