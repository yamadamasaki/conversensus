import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  ANSWERS_PROPERTY,
  type Did,
  type FileId,
  projectFile,
  requestsInFile,
} from '@conversensus/shared';
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
  addRequestSheet,
  createFile,
  invite,
  login,
  openFileNamed,
  openRightSidebar,
  participate,
  renderedNodeCount,
  selectFirstNode,
  syncNow,
  WIRING_TIMEOUT,
  waitForResumedSession,
} from './testing/appDriver';
import { type AppWorld, createAppWorld } from './testing/appWorld';
import type { FakeAccount } from './testing/fakePds';

const ALICE: FakeAccount = {
  did: 'did:plc:alice000000000000000000' as Did,
  handle: 'alice.test',
  password: 'alice-pw',
};
const BOB: FakeAccount = {
  did: 'did:plc:bob00000000000000000000' as Did,
  handle: 'bob.test',
  password: 'bob-pw',
};
/** 2 人で何度も端末を替えるので長め */
const TWO_PEOPLE_TIMEOUT_MS = 40_000;

const FILE_NAME = '依頼の File';
/** 画面を何度も往復するので、bun の既定 (5 秒) では足りない */
const TEST_TIMEOUT_MS = 20_000;

let world: AppWorld;
let signedIn: Set<string>;
beforeEach(async () => {
  world = await createAppWorld();
  world.pds.addAccount(ALICE);
  world.pds.addAccount(BOB);
  signedIn = new Set();
});

/** 端末を切り替えて App を描き、ログインした状態にする */
async function startOn(device: string, account: FakeAccount) {
  cleanup();
  await world.activate(device);
  render(<App />);
  const user = userEvent.setup();
  if (signedIn.has(device)) {
    await waitForResumedSession(account);
  } else {
    await login(user, account);
    signedIn.add(device);
  }
  return user;
}
afterEach(async () => {
  cleanup();
  expect(world.unhandled).toEqual([]);
  await world.dispose();
});

/** 右の欄の「依頼」の区画 */
const panel = () => screen.getByRole('region', { name: '依頼' });
/** 区画の状態の行と、node の上の印 */
const statusText = () => within(panel()).getByRole('status').textContent ?? '';
const badge = () =>
  document
    .querySelector('[data-request-status]')
    ?.getAttribute('data-request-status');

/** 正典の、この File の依頼 (1 つ) */
function storedRequest() {
  const store = world.localStore();
  const fileId = store.listFiles()[0]?.id as FileId;
  const file = projectFile(store.getBatches(fileId), fileId);
  return { file, requests: requestsInFile(file) };
}

describe('App 結合: 依頼の区画 (agent 段 4 R4)', () => {
  test(
    '依頼 node を作り、送る → 答える → 閉じる → 開き直す。区画・node の印・正典が揃って動く',
    async () => {
      await world.activate('solo');
      render(<App />);
      const user = userEvent.setup();
      await createFile(user, FILE_NAME);
      await addRequestSheet(user);
      await openRightSidebar(user);

      // 依頼の種類で node を作ると、作った時から応答を求める node (下書き)
      await addNode(user, '依頼');
      await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
      selectFirstNode();
      await waitFor(
        () => expect(statusText()).toContain('下書き'),
        WIRING_TIMEOUT,
      );
      expect(badge()).toBe('draft');
      expect(within(panel()).getByText('指定なし (参加者全員)')).toBeDefined();

      await user.click(within(panel()).getByRole('button', { name: '送る' }));
      await waitFor(
        () => expect(statusText()).toContain('送った・未回答'),
        WIRING_TIMEOUT,
      );
      expect(statusText()).toContain('1 回目');
      expect(badge()).toBe('sent');

      await user.type(
        within(panel()).getByRole('textbox', { name: '答えを書く' }),
        '答えです',
      );
      await user.click(within(panel()).getByRole('button', { name: '答える' }));
      await waitFor(() => expect(renderedNodeCount()).toBe(2), WIRING_TIMEOUT);
      await waitFor(
        () => expect(statusText()).toContain('回答あり'),
        WIRING_TIMEOUT,
      );
      expect(badge()).toBe('answered');
      await waitFor(() => {
        const { file, requests } = storedRequest();
        expect(requests.map((r) => r.status)).toEqual(['answered']);
        const sheet = requests[0]?.sheet;
        const edge = file.sheets
          .find((s) => s.id === sheet?.id)
          ?.edges.find((e) => e.source === requests[0]?.node.id);
        expect(edge?.label).toBe('答え');
        expect(edge?.properties?.[ANSWERS_PROPERTY]).toBe(1);
      }, WIRING_TIMEOUT);

      await user.click(within(panel()).getByRole('button', { name: '閉じる' }));
      await waitFor(
        () => expect(statusText()).toContain('閉じた'),
        WIRING_TIMEOUT,
      );
      expect(
        within(panel()).queryByRole('button', { name: '答える' }),
      ).toBeNull();

      await user.click(
        within(panel()).getByRole('button', { name: '開き直す' }),
      );
      await waitFor(
        () => expect(statusText()).toContain('回答あり'),
        WIRING_TIMEOUT,
      );
    },
    TEST_TIMEOUT_MS,
  );

  test(
    '送り直すと、前の答えでは回答ありにならない',
    async () => {
      await world.activate('solo');
      render(<App />);
      const user = userEvent.setup();
      await createFile(user, FILE_NAME);
      await addRequestSheet(user);
      await openRightSidebar(user);
      await addNode(user, '依頼');
      await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
      selectFirstNode();
      await user.click(
        await within(panel()).findByRole('button', { name: '送る' }),
      );
      await user.type(
        await within(panel()).findByRole('textbox', { name: '答えを書く' }),
        '前の答え',
      );
      await user.click(within(panel()).getByRole('button', { name: '答える' }));
      await waitFor(
        () => expect(statusText()).toContain('回答あり'),
        WIRING_TIMEOUT,
      );

      await user.click(
        within(panel()).getByRole('button', { name: '送り直す' }),
      );
      await waitFor(
        () => expect(statusText()).toContain('送った・未回答'),
        WIRING_TIMEOUT,
      );
      expect(statusText()).toContain('2 回目');
      expect(badge()).toBe('sent');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('App 結合: 依頼が届く (agent 段 4 R5)', () => {
  test(
    'alice が bob 宛てに送ると bob に通知が出て、開いて答えると alice の手元で回答ありになる',
    async () => {
      // alice が File を作って bob を招き、bob が参加する
      let user = await startOn('alice', ALICE);
      await createFile(user, FILE_NAME);
      const code = await invite(user, BOB);
      await syncNow(user);
      user = await startOn('bob', BOB);
      await participate(user, code, FILE_NAME);
      await syncNow(user);

      // alice: 依頼を作り、宛先に bob を選んで送る
      user = await startOn('alice', ALICE);
      await openFileNamed(user, FILE_NAME);
      await addRequestSheet(user);
      await openRightSidebar(user);
      await addNode(user, '依頼');
      await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
      selectFirstNode();
      await user.selectOptions(
        await within(panel()).findByRole(
          'combobox',
          { name: '宛先を足す' },
          WIRING_TIMEOUT,
        ),
        BOB.did,
      );
      await waitFor(
        () =>
          expect(
            within(panel()).getByRole('list', { name: '宛先' }).textContent,
          ).toContain('bob.test'),
        WIRING_TIMEOUT,
      );
      await user.click(within(panel()).getByRole('button', { name: '送る' }));
      await waitFor(
        () => expect(statusText()).toContain('送った・未回答'),
        WIRING_TIMEOUT,
      );
      await syncNow(user);

      // bob: 同期すると通知が出る。開くと依頼が選ばれ、区画で答える
      user = await startOn('bob', BOB);
      await openFileNamed(user, FILE_NAME);
      await syncNow(user);
      const notice = await screen.findByRole(
        'status',
        { name: '届いた依頼' },
        WIRING_TIMEOUT,
      );
      expect(notice.textContent).toContain('alice.test から依頼が届きました');
      await user.click(within(notice).getByRole('button', { name: '開く' }));
      await openRightSidebar(user);
      await waitFor(
        () => expect(statusText()).toContain('送った・未回答'),
        WIRING_TIMEOUT,
      );
      // 開いたら既読 (通知は消える)
      expect(screen.queryByRole('status', { name: '届いた依頼' })).toBeNull();
      await user.type(
        within(panel()).getByRole('textbox', { name: '答えを書く' }),
        'bob の答え',
      );
      await user.click(within(panel()).getByRole('button', { name: '答える' }));
      await waitFor(
        () => expect(statusText()).toContain('回答あり'),
        WIRING_TIMEOUT,
      );
      await syncNow(user);

      // alice: 同期すると回答あり。alice には通知は出ない (自分が送ったもの)
      user = await startOn('alice', ALICE);
      await openFileNamed(user, FILE_NAME);
      await syncNow(user);
      await waitFor(() => expect(badge()).toBe('answered'), WIRING_TIMEOUT);
      expect(screen.queryByRole('status', { name: '届いた依頼' })).toBeNull();
    },
    TWO_PEOPLE_TIMEOUT_MS,
  );
});
