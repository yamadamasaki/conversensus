import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setAuthBackend } from '@conversensus/client/src/atproto/client';
import { passwordAuth } from '@conversensus/client/src/atproto/passwordAuth';
import {
  addNode,
  createFile,
  invite,
  login,
  openFileNamed,
  renderedNodeCount,
  selectFirstNode,
  syncNow,
  WIRING_TIMEOUT,
  waitForResumedSession,
} from '@conversensus/client/src/testing/appDriver';
import {
  type AppWorld,
  createAppWorld,
  PDS_ORIGIN,
} from '@conversensus/client/src/testing/appWorld';
import type { FakeAccount } from '@conversensus/client/src/testing/fakePds';
import { Headless } from '@conversensus/headless/src/headless';
import { startResident } from '@conversensus/headless/src/resident/startResident';
import { connectMcp, idIn } from '@conversensus/headless/src/testing/mcpClient';
import type { Did } from '@conversensus/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RequestJob } from './requestDispatch';
import { REQUEST_HEADLESS_MODULE } from './requestHeadless';
import { createRequestWorker } from './requestResident';
import {
  addRequestSheet,
  answerSelected,
  renderAppWithRequests,
  requestBadge,
  sendSelected,
} from './testing/requestDriver';

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
const FILE_NAME = 'agent と共有する File';
/** 人と agent が何度も入れ替わるので長め */
const AGENT_TEST_TIMEOUT_MS = 60_000;

let world: AppWorld;
let dataDir: string;

beforeEach(async () => {
  world = await createAppWorld();
  world.pds.addAccount(ALICE);
  world.pds.addAccount(AGENT);
  dataDir = mkdtempSync(join(tmpdir(), 'agent-request-'));
});

afterEach(async () => {
  cleanup();
  expect(world.unhandled).toEqual([]);
  await world.dispose();
  rmSync(dataDir, { recursive: true, force: true });
});

/**
 * headless の agent として作業する。App を外し、headless を開いて閉じる。
 * headless は閉じるときに認証の口を外すので、App 結合の口 (パスワード) を入れ直す
 */
async function asAgent<T>(work: (agent: Headless) => Promise<T>): Promise<T> {
  cleanup();
  const agent = await Headless.open({
    dataDir,
    auth: passwordAuth(PDS_ORIGIN),
  });
  try {
    return await work(agent);
  } finally {
    await agent.close();
    setAuthBackend(passwordAuth(PDS_ORIGIN));
  }
}

/** alice が依頼を 1 つ作り、node のそばの「送る」で agent に送る */
async function aliceSendsToAgent(user: ReturnType<typeof userEvent.setup>) {
  await addRequestSheet(user);
  await addNode(user, '依頼');
  await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
  selectFirstNode();
  await sendSelected(user, [AGENT.handle]);
  await waitFor(() => expect(requestBadge()).toBe('sent'), WIRING_TIMEOUT);
}

describe('App 結合: 依頼を人間と headless の agent の間で (agent 段 4・5、計画 node-actions-request-module.md N3)', () => {
  test(
    '🔴 依頼を行き来する: alice が agent に送り agent が MCP で答える。agent が alice に送り alice が画面で答える (agent 段 4 完了基準 6)',
    async () => {
      // alice (App): File を作り agent を招く。agent が参加する
      await world.activate('alice');
      renderAppWithRequests();
      let user = userEvent.setup();
      await login(user, ALICE);
      await createFile(user, FILE_NAME);
      const code = await invite(user, AGENT);
      await syncNow(user);
      const fileId = await asAgent(async (agent) => {
        await agent.signIn(AGENT.handle, AGENT.password);
        return agent.accept(code);
      });

      // alice (App): 依頼の Sheet で依頼を作り、宛先に agent を選んで送る
      await world.activate('alice');
      renderAppWithRequests();
      user = userEvent.setup();
      await waitForResumedSession(ALICE);
      await openFileNamed(user, FILE_NAME);
      await aliceSendsToAgent(user);
      await syncNow(user);

      // agent (MCP): 自分宛ての依頼を見つけて答える。続けて alice への依頼を作って送る
      await asAgent(async (agent) => {
        const mcp = await connectMcp(agent, [REQUEST_HEADLESS_MODULE]);
        try {
          const listed = (await mcp.call('list_requests')).text;
          const [, nodeId, , , , sheetId] =
            listed.split('\n')[0]?.split(' ') ?? [];
          expect(listed).toContain(`from ${ALICE.did}`);
          expect(
            (
              await mcp.call('answer_request', {
                fileId,
                sheetId,
                nodeId,
                content: 'agent の答え',
              })
            ).isError,
          ).toBe(false);

          // 依頼の種類の id は encoding の template の注釈にある
          const encoding = (await mcp.call('read_file', { fileId })).text;
          const kind = encoding.match(/node 種別 "依頼"=(\S+?),/)?.[1];
          const added = await mcp.call('add_node', {
            fileId,
            sheetId,
            content: 'agent からの依頼',
            kind,
          });
          expect(added.isError).toBe(false);
          const requestId = idIn(added.text);
          await mcp.call('set_addressee', {
            fileId,
            sheetId,
            nodeId: requestId,
            dids: [ALICE.did],
          });
          expect(
            (
              await mcp.call('send_request', {
                fileId,
                sheetId,
                nodeId: requestId,
              })
            ).isError,
          ).toBe(false);
        } finally {
          await mcp.close();
        }
      });

      // alice (App): 同期すると agent の答えが届く。agent からの依頼の通知が出て、開いて答える
      await world.activate('alice');
      renderAppWithRequests();
      user = userEvent.setup();
      await waitForResumedSession(ALICE);
      await openFileNamed(user, FILE_NAME);
      await syncNow(user);
      const notice = await screen.findByRole(
        'status',
        { name: '届いた依頼' },
        WIRING_TIMEOUT,
      );
      expect(notice.textContent).toContain('agent.test から依頼が届きました');
      await user.click(within(notice).getByRole('button', { name: '開く' }));
      await screen.findByText('agent の答え', {}, WIRING_TIMEOUT);
      await waitFor(
        () => expect(requestBadge('agent からの依頼')).toBe('sent'),
        WIRING_TIMEOUT,
      );
      // 通知から開くと、その依頼が選ばれている。node のそばの操作で答える
      await answerSelected(user, 'alice の答え');
      await waitFor(
        () => expect(requestBadge('agent からの依頼')).toBe('answered'),
        WIRING_TIMEOUT,
      );
      await syncNow(user);

      // agent (MCP): agent の依頼は回答あり
      await asAgent(async (agent) => {
        const mcp = await connectMcp(agent, [REQUEST_HEADLESS_MODULE]);
        try {
          const encoding = (await mcp.call('read_file', { fileId })).text;
          expect(encoding.match(/# 応答を求める node: 回答あり/g)).toHaveLength(
            2,
          );
        } finally {
          await mcp.close();
        }
      });
    },
    AGENT_TEST_TIMEOUT_MS,
  );
  test(
    '🔴 常駐の agent: alice が画面で送ると、常駐の agent が見つけて答え、alice の画面で回答あり (agent 段 5 完了基準 5)',
    async () => {
      // alice (App): File を作り agent を招く。agent が参加する
      await world.activate('alice');
      renderAppWithRequests();
      let user = userEvent.setup();
      await login(user, ALICE);
      await createFile(user, FILE_NAME);
      const code = await invite(user, AGENT);
      await syncNow(user);
      await asAgent(async (agent) => {
        await agent.signIn(AGENT.handle, AGENT.password);
        await agent.accept(code);
      });

      // alice (App): 依頼を作り、宛先に agent を選んで送る
      await world.activate('alice');
      renderAppWithRequests();
      user = userEvent.setup();
      await waitForResumedSession(ALICE);
      await openFileNamed(user, FILE_NAME);
      await aliceSendsToAgent(user);
      await syncNow(user);

      // 常駐の agent: 誰も MCP を操作しない。始めると同期して依頼を見つけ、言語モデル (偽物) を起動する。
      // 偽物は本物の claude -p と同じく MCP の道具で答える
      const jobs: RequestJob[] = [];
      await asAgent(async (agent) => {
        const resident = await startResident({
          headless: agent,
          handle: AGENT.handle,
          appPassword: AGENT.password,
          live: null,
          pollIntervalMs: 60 * 60_000,
          livePollIntervalMs: 60 * 60_000,
          log: () => {},
          workers: [
            createRequestWorker({
              headless: agent,
              log: () => {},
              runner: {
                run: async (job) => {
                  jobs.push(job);
                  const mcp = await connectMcp(agent, [
                    REQUEST_HEADLESS_MODULE,
                  ]);
                  try {
                    const result = await mcp.call('answer_request', {
                      fileId: job.fileId,
                      sheetId: job.sheetId,
                      nodeId: job.nodeId,
                      content: '常駐の agent の答え',
                    });
                    expect(result.isError).toBe(false);
                  } finally {
                    await mcp.close();
                  }
                },
              },
            }),
          ],
        });
        await resident.idle();
        resident.stop();
      });
      expect(jobs).toHaveLength(1);

      // alice (App): 同期すると答えが描かれ、依頼は回答あり
      await world.activate('alice');
      renderAppWithRequests();
      user = userEvent.setup();
      await waitForResumedSession(ALICE);
      await openFileNamed(user, FILE_NAME);
      await syncNow(user);
      await screen.findByText('常駐の agent の答え', {}, WIRING_TIMEOUT);
      await waitFor(
        () => expect(requestBadge()).toBe('answered'),
        WIRING_TIMEOUT,
      );
    },
    AGENT_TEST_TIMEOUT_MS,
  );
});
