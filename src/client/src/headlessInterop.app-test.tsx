import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Did, FileId, NodeId, SheetId } from '@conversensus/shared';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Headless } from '../../headless/src/headless';
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
});
