import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Did, FileId, NodeId, SheetId } from '@conversensus/shared';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Headless } from '../../headless/src/headless';
import type { RequestJob } from '../../headless/src/resident/dispatch';
import { startResident } from '../../headless/src/resident/resident';
import {
  connectMcp,
  idIn,
  nodeIdByContent,
} from '../../headless/src/testing/mcpClient';
import App from './App';
import { setAuthBackend } from './atproto/client';
import { passwordAuth } from './atproto/passwordAuth';
import {
  addNode,
  addRequestSheet,
  createFile,
  invite,
  login,
  openFileNamed,
  openRightSidebar,
  renderedNodeCount,
  selectFirstNode,
  syncNow,
  WIRING_TIMEOUT,
  waitForResumedSession,
} from './testing/appDriver';
import { type AppWorld, createAppWorld, PDS_ORIGIN } from './testing/appWorld';
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
const FILE_NAME = 'agent と共有する File';
const AGENT_TEXT = 'agent が書いた';
const ALICE_TEXT = 'alice の主張';
const EDGE_LABEL = '支える';

let world: AppWorld;
let dataDir: string;

beforeEach(async () => {
  world = await createAppWorld();
  world.pds.addAccount(ALICE);
  world.pds.addAccount(AGENT);
  dataDir = mkdtempSync(join(tmpdir(), 'headless-interop-'));
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

describe('App 結合: ブラウザの人間と headless の agent (agent 段 2 H3)', () => {
  test('🔴 App の alice が招待し、headless の agent が参加して読み、書いたものが alice の画面に描かれる', async () => {
    // alice (App): File を作り、node を 1 つ置き、agent を招待する
    await world.activate('alice');
    render(<App />);
    let user = userEvent.setup();
    await login(user, ALICE);
    await createFile(user, FILE_NAME);
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    const code = await invite(user, AGENT);
    await syncNow(user);

    // agent (headless): 参加して読み (完了基準 1・2)、書いて送る
    const fileId = await asAgent(async (agent) => {
      await agent.signIn(AGENT.handle, AGENT.password);
      const joined: FileId = await agent.accept(code);
      const file = agent.read(joined);
      expect(file.name).toBe(FILE_NAME);
      const sheet = file.sheets[0];
      if (!sheet) throw new Error('Sheet が無い');
      expect(sheet.nodes).toHaveLength(1);

      const nodeId = crypto.randomUUID() as NodeId;
      agent.record(joined, sheet.id as SheetId, {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        category: 'structure',
        type: 'NODE_ADDED',
        nodeId,
        data: { id: nodeId, content: AGENT_TEXT },
      });
      await agent.sync(joined);
      return joined;
    });

    // alice (App): 同期すると、agent の node が画面に描かれる (完了基準 3)
    await world.activate('alice');
    render(<App />);
    user = userEvent.setup();
    await waitForResumedSession(ALICE);
    await openFileNamed(user, FILE_NAME);
    await syncNow(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(2), WIRING_TIMEOUT);
    await screen.findByText(AGENT_TEXT, {}, WIRING_TIMEOUT);

    // agent の書き込みは agent の repo にあり、alice の repo には無い (由来, 設計 D1)
    const agentRecords = world.pds
      .records(AGENT.did, 'app.conversensus.v2.batch')
      .filter((r) => (r.value as { fileId: string }).fileId === fileId)
      .filter((r) =>
        (r.value as { actor: string }).actor.startsWith(AGENT.did),
      );
    expect(agentRecords).toHaveLength(1);
  });

  test('🔴 agent が MCP の道具で読み書きし、書いたものが alice の画面に描かれる (agent 段 3 M3)', async () => {
    // alice (App): File を作り、本文のある node を置き、agent を招待する
    await world.activate('alice');
    render(<App />);
    let user = userEvent.setup();
    await login(user, ALICE);
    await createFile(user, FILE_NAME);
    await addNode(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(1), WIRING_TIMEOUT);
    const code = await invite(user, AGENT);
    await syncNow(user);

    // agent (MCP): 参加し、encoding で読み、node と edge を道具で書く
    await asAgent(async (agent) => {
      await agent.signIn(AGENT.handle, AGENT.password);
      const mcp = await connectMcp(agent);
      try {
        const fileId = idIn(
          (await mcp.call('accept_invitation', { code })).text,
        );
        const listing = (await mcp.call('list_files')).text;
        const sheetId = idIn(
          listing.split('\n').find((l) => l.trim().startsWith('sheet ')) ?? '',
        );
        const encoding = (await mcp.call('read_file', { fileId })).text;
        // alice が置いた node (本文は空) は encoding に出ている。本文を書いて指せるようにする
        const aliceNode = nodeIdByContent(encoding, '');
        expect(
          (
            await mcp.call('set_node_content', {
              fileId,
              sheetId,
              nodeId: aliceNode,
              content: ALICE_TEXT,
            })
          ).isError,
        ).toBe(false);
        const added = await mcp.call('add_node', {
          fileId,
          sheetId,
          content: AGENT_TEXT,
        });
        expect(added.isError).toBe(false);
        const edge = await mcp.call('add_edge', {
          fileId,
          sheetId,
          source: idIn(added.text),
          target: aliceNode,
          label: EDGE_LABEL,
        });
        expect(edge.isError).toBe(false);
      } finally {
        await mcp.close();
      }
    });

    // alice (App): 同期すると、agent の node と書き換えた本文が画面に描かれる
    await world.activate('alice');
    render(<App />);
    user = userEvent.setup();
    await waitForResumedSession(ALICE);
    await openFileNamed(user, FILE_NAME);
    await syncNow(user);
    await waitFor(() => expect(renderedNodeCount()).toBe(2), WIRING_TIMEOUT);
    await screen.findByText(AGENT_TEXT, {}, WIRING_TIMEOUT);
    await screen.findByText(ALICE_TEXT, {}, WIRING_TIMEOUT);
  });

  test('🔴 依頼を行き来する: alice が agent に送り agent が MCP で答える。agent が alice に送り alice が画面で答える (agent 段 4 完了基準 6)', async () => {
    const panel = () => screen.getByRole('region', { name: '依頼' });
    const badgeOf = (content: string) =>
      [...document.querySelectorAll('.react-flow__node')]
        .find((n) => n.textContent?.includes(content))
        ?.querySelector('[data-request-status]')
        ?.getAttribute('data-request-status');

    // alice (App): File を作り agent を招く。agent が参加する
    await world.activate('alice');
    render(<App />);
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
    render(<App />);
    user = userEvent.setup();
    await waitForResumedSession(ALICE);
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
      AGENT.did,
    );
    await user.click(
      await within(panel()).findByRole('button', { name: '送る' }),
    );
    await waitFor(
      () =>
        expect(within(panel()).getByRole('status').textContent).toContain(
          '送った・未回答',
        ),
      WIRING_TIMEOUT,
    );
    await syncNow(user);

    // agent (MCP): 自分宛ての依頼を見つけて答える。続けて alice への依頼を作って送る
    await asAgent(async (agent) => {
      const mcp = await connectMcp(agent);
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
    render(<App />);
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
    await openRightSidebar(user);
    await screen.findByText('agent の答え', {}, WIRING_TIMEOUT);
    await waitFor(
      () =>
        expect(within(panel()).getByRole('status').textContent).toContain(
          '送った・未回答',
        ),
      WIRING_TIMEOUT,
    );
    await user.type(
      within(panel()).getByRole('textbox', { name: '答えを書く' }),
      'alice の答え',
    );
    await user.click(within(panel()).getByRole('button', { name: '答える' }));
    await waitFor(
      () => expect(badgeOf('agent からの依頼')).toBe('answered'),
      WIRING_TIMEOUT,
    );
    await syncNow(user);

    // agent (MCP): agent の依頼は回答あり
    await asAgent(async (agent) => {
      const mcp = await connectMcp(agent);
      try {
        const encoding = (await mcp.call('read_file', { fileId })).text;
        expect(encoding.match(/# 応答を求める node: 回答あり/g)).toHaveLength(
          2,
        );
      } finally {
        await mcp.close();
      }
    });
  }, 60_000);
  test('🔴 常駐の agent: alice が画面で送ると、常駐の agent が見つけて答え、alice の画面で回答あり (agent 段 5 完了基準 5)', async () => {
    const panel = () => screen.getByRole('region', { name: '依頼' });
    const badge = () =>
      document
        .querySelector('.react-flow__node [data-request-status]')
        ?.getAttribute('data-request-status');

    // alice (App): File を作り agent を招く。agent が参加する
    await world.activate('alice');
    render(<App />);
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
    render(<App />);
    user = userEvent.setup();
    await waitForResumedSession(ALICE);
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
      AGENT.did,
    );
    await user.click(
      await within(panel()).findByRole('button', { name: '送る' }),
    );
    await waitFor(() => expect(badge()).toBe('sent'), WIRING_TIMEOUT);
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
        runner: {
          run: async (job) => {
            jobs.push(job);
            const mcp = await connectMcp(agent);
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
      });
      await resident.idle();
      resident.stop();
    });
    expect(jobs).toHaveLength(1);

    // alice (App): 同期すると答えが描かれ、依頼は回答あり
    await world.activate('alice');
    render(<App />);
    user = userEvent.setup();
    await waitForResumedSession(ALICE);
    await openFileNamed(user, FILE_NAME);
    await syncNow(user);
    await screen.findByText('常駐の agent の答え', {}, WIRING_TIMEOUT);
    await waitFor(() => expect(badge()).toBe('answered'), WIRING_TIMEOUT);
  }, 60_000);
});
