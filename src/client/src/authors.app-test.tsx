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
import {
  addNode,
  createFile,
  login,
  renderedNodeCount,
  WIRING_TIMEOUT,
} from './testing/appDriver';
import { type AppWorld, createAppWorld } from './testing/appWorld';
import type { FakeAccount } from './testing/fakePds';

const ALICE: FakeAccount = {
  did: 'did:plc:alice000000000000000000' as Did,
  handle: 'alice.test',
  password: 'alice-pw',
};

let world: AppWorld;
beforeEach(async () => {
  world = await createAppWorld();
  world.pds.addAccount(ALICE);
});
afterEach(async () => {
  cleanup();
  expect(world.unhandled).toEqual([]);
  await world.dispose();
});

/** node の上の、書いた人の avatar の並び */
const nodeAuthors = () =>
  document.querySelector('.react-flow__node [data-authors]');

describe('App 結合: 書いた人の avatar (#354)', () => {
  test('🔴 node を置くと、置いた人の avatar が node に出る。ヘッダで消すと出ず、出し直すと戻る', async () => {
    await world.activate('alice');
    render(<App />);
    const user = userEvent.setup();
    await login(user, ALICE);
    await createFile(user, '書いた人の File');
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);

    await waitFor(
      () => expect(nodeAuthors()?.getAttribute('data-authors')).toBe(ALICE.did),
      WIRING_TIMEOUT,
    );
    // 表示名を引いたら、読み上げはハンドル名
    await waitFor(
      () =>
        expect(nodeAuthors()?.getAttribute('aria-label')).toBe(
          '書いた人: alice.test',
        ),
      WIRING_TIMEOUT,
    );

    const header = screen.getByRole('toolbar', { name: 'グラフの操作' });
    await user.click(within(header).getByRole('button', { name: '書いた人' }));
    await waitFor(() => expect(nodeAuthors()).toBeNull());
    await user.click(within(header).getByRole('button', { name: '書いた人' }));
    await waitFor(() => expect(nodeAuthors()).not.toBeNull());
  });
});
