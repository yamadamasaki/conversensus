import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Did, FileId, NodeId, SheetId } from '@conversensus/shared';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Headless } from '../../headless/src/headless';
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
  createFile,
  invite,
  login,
  openFileNamed,
  renderedNodeCount,
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
});
