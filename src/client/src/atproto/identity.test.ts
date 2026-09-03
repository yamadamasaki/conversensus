import { describe, expect, test } from 'bun:test';
import type { Did, JudgmentBatch } from '@conversensus/shared';
import {
  type BatchId,
  collectInviteTargets,
  foldParticipation,
} from '@conversensus/shared';
import { buildLocalDidPredicate } from './identity';

const A = 'did:plc:alice';
const B = 'did:plc:bob';
const FOREIGN = 'did:plc:elsewhere';

let seq = 0;
const jb = (
  did: string,
  clock: number,
  ops: JudgmentBatch['ops'],
): JudgmentBatch => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}` as BatchId,
  actor: `${did}#dev-1`,
  clock,
  timestamp: 0,
  ops,
});

describe('collectInviteTargets — 畳む前に解決するための材料', () => {
  test('招待先の DID だけを集める', () => {
    const targets = collectInviteTargets([
      jb(A, 1, [{ kind: 'participation.genesis' }]),
      jb(A, 2, [{ kind: 'participation.invite', target: B }]),
      jb(B, 3, [{ kind: 'participation.accept', inviter: 'did:plc:alice' }]),
      jb(A, 4, [{ kind: 'participation.revoke', target: B }]),
    ]);
    // revoke の target は招待先ではないので含まない (PDS 所属を問う必要が無い)
    expect([...targets]).toEqual([B]);
  });

  test('同じ相手への再招待は 1 つにまとまる', () => {
    const targets = collectInviteTargets([
      jb(A, 1, [{ kind: 'participation.invite', target: B }]),
      jb(A, 2, [{ kind: 'participation.invite', target: B }]),
    ]);
    expect(targets.size).toBe(1);
  });
});

describe('buildLocalDidPredicate', () => {
  test('解決した結果を同期の述語にする', async () => {
    const isLocalDid = await buildLocalDidPredicate(
      [A, FOREIGN],
      async (did) => did !== FOREIGN,
    );
    expect(isLocalDid(A)).toBe(true);
    expect(isLocalDid(FOREIGN)).toBe(false);
  });

  test('同じ DID は 1 度しか問い合わせない', async () => {
    const asked: Did[] = [];
    await buildLocalDidPredicate([A, A, A], async (did) => {
      asked.push(did);
      return true;
    });
    expect(asked).toEqual([A]);
  });

  test('解決していない DID は「この PDS に属さない」として扱う', async () => {
    // 招待を通してしまうより落とす方が安全で、しかも rejected に載るので理由が出る
    const isLocalDid = await buildLocalDidPredicate([A], async () => true);
    expect(isLocalDid(B)).toBe(false);
  });

  test('畳み込みに繋ぐと、他 PDS への招待が pre 条件で落ちる', async () => {
    // 「畳む前にまとめて解決し、畳み込みには確定した答えだけを渡す」の全体像
    const batches = [
      jb(A, 1, [{ kind: 'participation.genesis' }]),
      jb(A, 2, [{ kind: 'participation.invite', target: B }]),
      jb(A, 3, [{ kind: 'participation.invite', target: FOREIGN }]),
    ];
    const isLocalDid = await buildLocalDidPredicate(
      collectInviteTargets(batches),
      async (did) => did !== FOREIGN,
    );

    const roster = foldParticipation(batches, { isLocalDid });
    expect([...roster.invited.keys()]).toEqual([B]);
    expect(roster.rejected.map((r) => r.reason)).toEqual(['targetForeignPds']);
  });
});
