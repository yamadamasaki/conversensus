import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  addNode,
  createFile,
  invite,
  login,
  openFileNamed,
  participate,
  renderedNodeCount,
  selectFirstNode,
  syncNow,
  WIRING_TIMEOUT,
  waitForResumedSession,
} from '@conversensus/client/src/testing/appDriver';
import {
  type AppWorld,
  createAppWorld,
} from '@conversensus/client/src/testing/appWorld';
import type { FakeAccount } from '@conversensus/client/src/testing/fakePds';
import {
  ANSWERS_PROPERTY,
  type Did,
  type FileId,
  projectFile,
  requestsInFile,
} from '@conversensus/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  addRequestSheet,
  answerSelected,
  clickNodeAction,
  nodeBar,
  renderAppWithRequests,
  requestBadge,
  sendSelected,
} from './testing/requestDriver';

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
  renderAppWithRequests();
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

/** 選んでいる node のそばに出ている操作の名前 */
const shownActions = () =>
  within(nodeBar())
    .getAllByRole('button')
    .map((b) => b.textContent);

/** 正典の、この File の依頼 (1 つ) */
function storedRequest() {
  const store = world.localStore();
  const fileId = store.listFiles()[0]?.id as FileId;
  const file = projectFile(store.getBatches(fileId), fileId);
  return { file, requests: requestsInFile(file) };
}

/** 依頼の Sheet に依頼 node を 1 つ作って選ぶ */
async function oneSelectedRequest(user: ReturnType<typeof userEvent.setup>) {
  await addRequestSheet(user);
  await addNode(user, '依頼');
  await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
  selectFirstNode();
}

describe('App 結合: 依頼の操作 (agent 段 4 R4、計画 node-actions-request-module.md N3)', () => {
  test(
    '依頼 node を作り、送る → 答える → 閉じる → 開き直す。node のそばの操作・node の印・正典が揃って動き、property の欄には依頼の区画が無い',
    async () => {
      await world.activate('solo');
      renderAppWithRequests();
      const user = userEvent.setup();
      await createFile(user, FILE_NAME);

      // 依頼の種類で node を作ると、作った時から応答を求める node (下書き)
      await oneSelectedRequest(user);
      await waitFor(() => expect(requestBadge()).toBe('draft'), WIRING_TIMEOUT);
      await waitFor(() => expect(shownActions()).toEqual(['送る']));
      expect(screen.queryByRole('region', { name: '依頼' })).toBeNull();

      // 送る: dialog で宛先を選ばない (= 参加者全員)
      await sendSelected(user);
      await waitFor(() => expect(requestBadge()).toBe('sent'), WIRING_TIMEOUT);
      expect(
        document.querySelector('[data-node-badge="request"]')?.textContent,
      ).toContain('1 回目');
      await waitFor(() =>
        expect(shownActions()).toEqual(['送り直す', '答える', '閉じる']),
      );

      // 答える: 答えの node が増え、依頼は選ばれたまま
      await answerSelected(user, '答えです');
      await waitFor(() => expect(renderedNodeCount()).toBe(2), WIRING_TIMEOUT);
      await waitFor(
        () => expect(requestBadge()).toBe('answered'),
        WIRING_TIMEOUT,
      );
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

      await clickNodeAction(user, '閉じる');
      await waitFor(
        () => expect(requestBadge()).toBe('closed'),
        WIRING_TIMEOUT,
      );
      await waitFor(() => expect(shownActions()).toEqual(['開き直す']));

      await clickNodeAction(user, '開き直す');
      await waitFor(
        () => expect(requestBadge()).toBe('answered'),
        WIRING_TIMEOUT,
      );
    },
    TEST_TIMEOUT_MS,
  );

  test(
    '送ったことは undo で戻らない: 答えた後の undo は答えだけを戻し、次の undo は送信を飛ばして node を作ったことを戻す',
    async () => {
      await world.activate('solo');
      renderAppWithRequests();
      const user = userEvent.setup();
      await createFile(user, FILE_NAME);
      await oneSelectedRequest(user);
      await sendSelected(user);
      await answerSelected(user, '戻す答え');
      await waitFor(() => expect(renderedNodeCount()).toBe(2), WIRING_TIMEOUT);
      const undo = () =>
        user.click(
          within(
            screen.getByRole('toolbar', { name: 'グラフの操作' }),
          ).getByRole('button', { name: '元に戻す' }),
        );

      // 答えは手元の編集なので戻せる
      await undo();
      await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
      await waitFor(() => expect(requestBadge()).toBe('sent'), WIRING_TIMEOUT);
      // 送ったことは undo に積まれていない (相手に届く行為)。次の undo はその前の「node を作った」を戻す
      await undo();
      await waitFor(() => expect(renderedNodeCount()).toBe(0), WIRING_TIMEOUT);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    '送り直すと、前の答えでは回答ありにならない',
    async () => {
      await world.activate('solo');
      renderAppWithRequests();
      const user = userEvent.setup();
      await createFile(user, FILE_NAME);
      await oneSelectedRequest(user);
      await sendSelected(user);
      await answerSelected(user, '前の答え');
      await waitFor(
        () => expect(requestBadge()).toBe('answered'),
        WIRING_TIMEOUT,
      );

      await sendSelected(user, [], '送り直す');
      await waitFor(() => expect(requestBadge()).toBe('sent'), WIRING_TIMEOUT);
      expect(
        document.querySelector('[data-node-badge="request"]')?.textContent,
      ).toContain('2 回目');
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

      // alice: 依頼を作り、送る dialog で宛先に bob を選ぶ。次に開くと bob が選ばれている
      user = await startOn('alice', ALICE);
      await openFileNamed(user, FILE_NAME);
      await oneSelectedRequest(user);
      await sendSelected(user, [BOB.handle]);
      await waitFor(() => expect(requestBadge()).toBe('sent'), WIRING_TIMEOUT);
      await clickNodeAction(user, '送り直す');
      const again = await screen.findByRole('dialog', { name: '送り直す' });
      expect(
        (
          within(again).getByRole('checkbox', {
            name: BOB.handle,
          }) as HTMLInputElement
        ).checked,
      ).toBe(true);
      await user.click(
        within(again).getByRole('button', { name: 'キャンセル' }),
      );
      await syncNow(user);

      // bob: 同期すると通知が出る。開くと依頼が選ばれ、node のそばの操作で答える
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
      // 開いたら既読 (通知は消える)
      await waitFor(() =>
        expect(screen.queryByRole('status', { name: '届いた依頼' })).toBeNull(),
      );
      await answerSelected(user, 'bob の答え');
      await waitFor(
        () => expect(requestBadge()).toBe('answered'),
        WIRING_TIMEOUT,
      );
      await syncNow(user);

      // alice: 同期すると回答あり。alice には通知は出ない (自分が送ったもの)
      user = await startOn('alice', ALICE);
      await openFileNamed(user, FILE_NAME);
      await syncNow(user);
      await waitFor(
        () => expect(requestBadge()).toBe('answered'),
        WIRING_TIMEOUT,
      );
      expect(screen.queryByRole('status', { name: '届いた依頼' })).toBeNull();
    },
    TWO_PEOPLE_TIMEOUT_MS,
  );
});
