import { describe, expect, test } from 'bun:test';
import type { Did } from '@conversensus/shared';
import type { PlanInvitationsDeps } from './planInvitations';
import { planInvitations } from './planInvitations';

const A = 'did:plc:alice' as Did;
const B = 'did:plc:bob' as Did;
const FOREIGN = 'did:plc:elsewhere' as Did;
/** 依頼を出す本人。**名簿の誰でもない** — 自分自身の判定だけを別に試すため */
const ME = 'did:plc:me' as Did;

const DIRECTORY: Record<string, Did> = {
  'alice.test': A,
  'bob.test': B,
  'far.away': FOREIGN,
};

function makeDeps(over: Partial<PlanInvitationsDeps> = {}) {
  const asked: string[] = [];
  const deps: PlanInvitationsDeps = {
    resolveHandle: async (handle) => {
      asked.push(handle);
      return DIRECTORY[handle] ?? null;
    },
    isLocalDid: async (did) => did !== FOREIGN,
    isParticipating: () => false,
    viewer: ME,
    ...over,
  };
  return { deps, asked };
}

describe('planInvitations', () => {
  test('引けたハンドルは依頼先になる', async () => {
    const { deps } = makeDeps();
    expect(await planInvitations(deps, ['bob.test'])).toEqual({
      targets: [B],
      problems: [],
    });
  });

  test('見つからないハンドルは理由を返す', async () => {
    const { deps } = makeDeps();
    const plan = await planInvitations(deps, ['nobody.test']);
    expect(plan.targets).toEqual([]);
    expect(plan.problems).toEqual(['nobody.test は見つからない']);
  });

  test('既に参加している人は理由を返す', async () => {
    const { deps } = makeDeps({ isParticipating: (did) => did === B });
    const plan = await planInvitations(deps, ['bob.test']);
    expect(plan.targets).toEqual([]);
    expect(plan.problems).toEqual(['bob.test は既に参加している']);
  });

  test('自分自身は依頼先にならない', async () => {
    // 畳み込みは必ず捨てるが、捨てられた op は判断ログに永久に残る。
    // 「名簿の input に自分のハンドルを入れた」は実際に起きた (2026-09-05)
    const { deps } = makeDeps({ viewer: A });
    const plan = await planInvitations(deps, ['alice.test']);
    expect(plan.targets).toEqual([]);
    expect(plan.problems).toEqual(['alice.test は自分自身である']);
  });

  test('離脱中の自分も止まる — 参加中かどうかでは見ない', async () => {
    // **ここが要点である。**離脱中は `isParticipating` が false なので、
    // 参加中かどうかで見ていると素通りする (実機で 1 件書かれた経路)
    const { deps } = makeDeps({ viewer: A, isParticipating: () => false });
    const plan = await planInvitations(deps, ['alice.test', 'bob.test']);
    expect(plan.targets).toEqual([B]); // 他の人の分は通す
    expect(plan.problems).toEqual(['alice.test は自分自身である']);
  });

  test('別の PDS のアカウントは理由を返す', async () => {
    // 仕様は他 PDS への依頼を「やらない」ではなく「無効とする」と定めている。
    // 畳み込みも同じ判定をするが、ここで止めれば理由が画面に出る
    const { deps } = makeDeps();
    const plan = await planInvitations(deps, ['far.away']);
    expect(plan.targets).toEqual([]);
    expect(plan.problems).toEqual(['far.away は別の PDS のアカウントである']);
  });

  test('通る分は書く — 1 人の失敗で全員を捨てない', async () => {
    // 5 人中 1 人が見つからないときに 4 人分を捨てると打ち直しになる
    const { deps } = makeDeps();
    const plan = await planInvitations(deps, [
      'bob.test',
      'nobody.test',
      'alice.test',
    ]);
    expect(plan.targets).toEqual([B, A]);
    expect(plan.problems).toEqual(['nobody.test は見つからない']);
  });

  test('理由は依頼した順に並ぶ', async () => {
    const { deps } = makeDeps({ isParticipating: (did) => did === A });
    const plan = await planInvitations(deps, [
      'nobody.test',
      'alice.test',
      'far.away',
    ]);
    expect(plan.problems).toEqual([
      'nobody.test は見つからない',
      'alice.test は既に参加している',
      'far.away は別の PDS のアカウントである',
    ]);
  });

  test('同じハンドルは 1 度しか引かない', async () => {
    // 2 度書いても畳み込みの結果は同じだが、op が無駄に増える
    const { deps, asked } = makeDeps();
    const plan = await planInvitations(deps, [
      'bob.test',
      'bob.test',
      ' bob.test ',
    ]);
    expect(plan.targets).toEqual([B]);
    expect(asked).toEqual(['bob.test']);
  });

  test('空白だけの要素は落とす', async () => {
    const { deps, asked } = makeDeps();
    const plan = await planInvitations(deps, ['bob.test', '', '  ']);
    expect(plan.targets).toEqual([B]);
    expect(asked).toEqual(['bob.test']);
  });

  test('依頼が 1 つも無ければ何も返さない', async () => {
    const { deps, asked } = makeDeps();
    expect(await planInvitations(deps, [])).toEqual({
      targets: [],
      problems: [],
    });
    expect(asked).toEqual([]);
  });

  test('既に依頼済の人は通す — 参加コードの再発行は正当な操作である', async () => {
    // 畳み込みも「既に招待済でも捨てない」と決めている (依頼者を上書きする)
    const { deps } = makeDeps();
    const plan = await planInvitations(deps, ['bob.test']);
    expect(plan.targets).toEqual([B]);
  });
});
