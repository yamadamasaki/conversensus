import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { agentRecords } from '@conversensus/client/src/atproto/collections';
import { Headless } from './headless';
import {
  AGENT,
  ALICE,
  createHeadlessWorld,
  type HeadlessWorld,
} from './testing/headlessWorld';

let world: HeadlessWorld;
let current: Headless | null = null;

async function as(account: { handle: string; password: string }) {
  await current?.close();
  current = await Headless.open(world.options(world.newDataDir()));
  await current.signIn(account.handle, account.password);
  return current;
}

beforeEach(() => {
  world = createHeadlessWorld();
});
afterEach(async () => {
  await current?.close();
  current = null;
  world.dispose();
});

describe('agent の宣言 (設計 D2、計画 agent-d2-declaration.md A2)', () => {
  it('🔴 agent が operator をハンドル名で宣言すると名乗りのみ。operator が認めると裏付けあり。やめると名乗りのみに戻る', async () => {
    const agent = await as(AGENT);
    expect((await agent.agentDeclaration()).status).toBe('none');
    const declared = await agent.declareAgent({
      operator: ALICE.handle,
      model: 'claude',
    });
    expect(declared).toEqual({ operator: ALICE.did, model: 'claude' });
    expect(await agent.agentDeclaration()).toEqual({
      status: 'claimed',
      operator: ALICE.did,
      model: 'claude',
    });

    // operator (alice) が自分の repo に裏付けを書く (App の参加者一覧と同じ口)
    const alice = await as(ALICE);
    await agentRecords.putOperated(AGENT.did);
    expect((await alice.agentDeclaration(AGENT.did)).status).toBe('verified');
    // alice 自身は agent ではない (裏付けを書いても)
    expect((await alice.agentDeclaration()).status).toBe('none');

    await agentRecords.deleteOperated(AGENT.did);
    expect((await alice.agentDeclaration(AGENT.did)).status).toBe('claimed');
  });

  it('operator は DID でも受ける。見つからないハンドル名は理由つきで断る', async () => {
    const agent = await as(AGENT);
    expect((await agent.declareAgent({ operator: ALICE.did })).operator).toBe(
      ALICE.did,
    );
    await expect(
      agent.declareAgent({ operator: 'nobody.test' }),
    ).rejects.toThrow('operator が見つからない');
  });
});
