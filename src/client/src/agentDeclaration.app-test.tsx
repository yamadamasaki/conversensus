import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Did } from '@conversensus/shared';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { agentRecords } from './atproto/collections';
import { NSID } from './atproto/types';
import { createFile, invite, login, WIRING_TIMEOUT } from './testing/appDriver';
import { type AppWorld, createAppWorld } from './testing/appWorld';
import type { FakeAccount } from './testing/fakePds';

const ALICE: FakeAccount = {
  did: 'did:plc:alice000000000000000000' as Did,
  handle: 'alice.test',
  password: 'alice-pw',
};
const AGENT: FakeAccount = {
  did: 'did:plc:agent000000000000000000' as Did,
  handle: 'agent.test',
  password: 'agent-pw',
};
/** 2 人の端末を行き来するので長め */
const TEST_TIMEOUT_MS = 30_000;

let world: AppWorld;
beforeEach(async () => {
  world = await createAppWorld();
  world.pds.addAccount(ALICE);
  world.pds.addAccount(AGENT);
});
afterEach(async () => {
  cleanup();
  expect(world.unhandled).toEqual([]);
  await world.dispose();
});

/** 参加者一覧の agent の印の状態 */
const agentMark = () =>
  document
    .querySelector('[data-agent-status]')
    ?.getAttribute('data-agent-status');

describe('App 結合: agent の宣言 (設計 agent-actor.md D2、計画 agent-d2-declaration.md A3)', () => {
  test(
    '🔴 agent が alice を operator と宣言 → alice の参加者一覧に名乗りのみ → 認めると裏付けあり → やめると名乗りのみ',
    async () => {
      // agent: 自分の repo に宣言を書く (CLI の `profile` と同じ口)
      await world.activate('agent');
      render(<App />);
      let user = userEvent.setup();
      await login(user, AGENT);
      await agentRecords.putProfile({ operator: ALICE.did, model: 'claude' });

      // alice: File を作り agent を招く。参加者一覧を開き直すと、agent の行に印
      cleanup();
      await world.activate('alice');
      render(<App />);
      user = userEvent.setup();
      await login(user, ALICE);
      await createFile(user, 'agent と使う File');
      await invite(user, AGENT);
      await user.click(screen.getByTitle('参加者一覧'));
      await waitFor(() => expect(agentMark()).toBe('claimed'), WIRING_TIMEOUT);
      expect(
        document.querySelector('[data-agent-status]')?.textContent,
      ).toContain('model: claude');

      await user.click(
        screen.getByRole('button', { name: '自分の agent と認める' }),
      );
      await waitFor(() => expect(agentMark()).toBe('verified'), WIRING_TIMEOUT);
      expect(
        world.pds.records(ALICE.did, NSID.operatedAgent).map((r) => r.rkey),
      ).toEqual([AGENT.did]);

      await user.click(
        screen.getByRole('button', { name: '認めるのをやめる' }),
      );
      await waitFor(() => expect(agentMark()).toBe('claimed'), WIRING_TIMEOUT);
      expect(world.pds.records(ALICE.did, NSID.operatedAgent)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});
