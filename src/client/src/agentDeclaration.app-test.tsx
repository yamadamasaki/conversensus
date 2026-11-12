import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Did } from '@conversensus/shared';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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
/** 参加者でない operator (#392)。名簿にいないので、ハンドル名は宣言を読んだときに引く */
const BOB: FakeAccount = {
  did: 'did:plc:bob00000000000000000000' as Did,
  handle: 'bob.test',
  password: 'bob-pw',
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
  world.pds.addAccount(BOB);
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

      // 認める前に、どの agent かを確かめる (#394)。キャンセルすれば何も書かない
      await user.click(
        screen.getByRole('button', { name: '自分の agent と認める' }),
      );
      let confirm = await screen.findByRole('dialog', { name: '確認' });
      expect(confirm.textContent).toContain('agent.test');
      expect(confirm.textContent).toContain(AGENT.did);
      await user.click(
        within(confirm).getByRole('button', { name: 'キャンセル' }),
      );
      expect(agentMark()).toBe('claimed');
      expect(world.pds.records(ALICE.did, NSID.operatedAgent)).toEqual([]);

      await user.click(
        screen.getByRole('button', { name: '自分の agent と認める' }),
      );
      confirm = await screen.findByRole('dialog', { name: '確認' });
      await user.click(
        within(confirm).getByRole('button', { name: '自分の agent と認める' }),
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

      // 宣言を持たない alice・裏付けの無い agent を読んでも、4xx を出さない (#383)。
      // ブラウザでは「Failed to load resource」としてコンソールに出る
      expect(
        world.pds
          .rejected()
          .filter(
            (r) => r.includes('agentProfile') || r.includes('operatedAgent'),
          ),
      ).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    'operator が参加者でなくても、ハンドル名で出す (#392)',
    async () => {
      await world.activate('agent');
      render(<App />);
      let user = userEvent.setup();
      await login(user, AGENT);
      await agentRecords.putProfile({ operator: BOB.did });

      cleanup();
      await world.activate('alice');
      render(<App />);
      user = userEvent.setup();
      await login(user, ALICE);
      await createFile(user, 'bob の agent と使う File');
      await invite(user, AGENT);
      await user.click(screen.getByTitle('参加者一覧'));
      await waitFor(() => expect(agentMark()).toBe('claimed'), WIRING_TIMEOUT);
      await waitFor(
        () =>
          expect(
            document.querySelector('[data-agent-status]')?.textContent,
          ).toContain('bob.test'),
        WIRING_TIMEOUT,
      );
      // alice は operator ではないので、認める口は出ない
      expect(
        screen.queryByRole('button', { name: '自分の agent と認める' }),
      ).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );
});
