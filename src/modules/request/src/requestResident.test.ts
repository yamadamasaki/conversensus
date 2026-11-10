import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Headless } from '@conversensus/headless/src/headless';
import { startResident } from '@conversensus/headless/src/resident/startResident';
import {
  AGENT,
  ALICE,
  createHeadlessWorld,
  type HeadlessWorld,
} from '@conversensus/headless/src/testing/headlessWorld';
import { connectMcp } from '@conversensus/headless/src/testing/mcpClient';
import type { FileId, NodeId, SheetId } from '@conversensus/shared';
import type { RequestJob } from './requestDispatch';
import { sendRequest } from './requestEvents';
import { REQUEST_HEADLESS_MODULE } from './requestHeadless';
import { requestStatus } from './requestNode';
import { createRequestWorker, promptFor } from './requestResident';
import { requestAdded } from './testing/requestNodes';

/** 試験の間には来ないポーリング (同期は始めたときの 1 回だけ) */
const NEVER = 60 * 60_000;

let world: HeadlessWorld;
let current: Headless | null = null;
let aliceDir: string;
let agentDir: string;

async function as(
  dataDir: string,
  account: { handle: string; password: string } | null,
): Promise<Headless> {
  await current?.close();
  current = await Headless.open(world.options(dataDir));
  if (account) await current.signIn(account.handle, account.password);
  return current;
}

beforeEach(() => {
  world = createHeadlessWorld();
  aliceDir = world.newDataDir();
  agentDir = world.newDataDir();
});
afterEach(async () => {
  await current?.close();
  current = null;
  world.dispose();
});

/** alice が File を作って agent を招き、agent に依頼を送る。agent は参加だけしておく */
async function aliceSendsRequest(): Promise<{
  fileId: FileId;
  sheetId: SheetId;
  nodeId: NodeId;
}> {
  const alice = await as(aliceDir, ALICE);
  const fileId = await alice.createFile('依頼の File');
  const sheetId = alice.read(fileId).sheets[0]?.id as SheetId;
  const req = requestAdded('この章を要約して', [AGENT.did]);
  alice.record(fileId, sheetId, req.event);
  alice.record(fileId, sheetId, sendRequest(req.node));
  await alice.sync(fileId);
  const code = await alice.invite(fileId, AGENT.did);
  const agent = await as(agentDir, AGENT);
  await agent.accept(code);
  return { fileId, sheetId, nodeId: req.nodeId };
}

/** 言語モデルの代わり: MCP の道具で答える (本物の `claude -p` が HTTP でするのと同じ道具) */
function answeringRunner(headless: Headless, jobs: RequestJob[]) {
  return {
    run: async (job: RequestJob) => {
      jobs.push(job);
      const mcp = await connectMcp(headless, [REQUEST_HEADLESS_MODULE]);
      try {
        const result = await mcp.call('answer_request', {
          fileId: job.fileId,
          sheetId: job.sheetId,
          nodeId: job.nodeId,
          content: `答え (${job.sent} 回目)`,
        });
        if (result.isError) throw new Error(result.text);
      } finally {
        await mcp.close();
      }
    },
  };
}

/** 常駐を始めて、今ある契機と依頼を回し終えたら止める */
async function runResidentOnce(jobs: RequestJob[]): Promise<Headless> {
  // 開き直す: 前のセッションが置き場所から戻る (戻せなければ app password で入る)
  const agent = await as(agentDir, null);
  const resident = await startResident({
    headless: agent,
    handle: AGENT.handle,
    appPassword: AGENT.password,
    workers: [
      createRequestWorker({
        headless: agent,
        runner: answeringRunner(agent, jobs),
        log: () => {},
      }),
    ],
    live: null,
    pollIntervalMs: NEVER,
    livePollIntervalMs: NEVER,
    log: () => {},
  });
  await resident.idle();
  resident.stop();
  return agent;
}

/** alice の手元で見た依頼の状態 */
async function statusForAlice(fileId: FileId, nodeId: NodeId) {
  const alice = await as(aliceDir, ALICE);
  await alice.sync(fileId);
  const sheet = alice
    .read(fileId)
    .sheets.find((s) => s.nodes.some((n) => n.id === nodeId));
  const node = sheet?.nodes.find((n) => n.id === nodeId);
  if (!sheet || !node) throw new Error('依頼が無い');
  return requestStatus(node, sheet.edges);
}

describe('依頼に答える常駐 (段 5 S6、計画 node-actions-request-module.md B4)', () => {
  it('🔴 送られた依頼を見つけて言語モデルを起動し、その答えが alice の手元で「回答あり」になる', async () => {
    const { fileId, sheetId, nodeId } = await aliceSendsRequest();
    const jobs: RequestJob[] = [];
    await runResidentOnce(jobs);
    expect(jobs).toEqual([
      { fileId, sheetId, nodeId, sent: 1, content: 'この章を要約して' },
    ]);
    expect(await statusForAlice(fileId, nodeId)).toBe('answered');
  });

  it('🔴 再起動しても同じ送信には起動しない。送り直されれば起動する', async () => {
    const { fileId, sheetId, nodeId } = await aliceSendsRequest();
    const jobs: RequestJob[] = [];
    await runResidentOnce(jobs);
    await runResidentOnce(jobs);
    expect(jobs.map((j) => j.sent)).toEqual([1]);

    // alice が送り直す
    const alice = await as(aliceDir, ALICE);
    await alice.sync(fileId);
    const node = alice
      .read(fileId)
      .sheets.find((s) => s.id === sheetId)
      ?.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error('依頼が無い');
    alice.record(fileId, sheetId, sendRequest(node));
    await alice.sync(fileId);

    await runResidentOnce(jobs);
    expect(jobs.map((j) => j.sent)).toEqual([1, 2]);
    expect(await statusForAlice(fileId, nodeId)).toBe('answered');
  });

  it('セッションが失効していても、始めるときに app password で入り直す', async () => {
    const { fileId, nodeId } = await aliceSendsRequest();
    world.pds.expireSessions();
    const jobs: RequestJob[] = [];
    await runResidentOnce(jobs);
    expect(jobs).toHaveLength(1);
    expect(await statusForAlice(fileId, nodeId)).toBe('answered');
  });
});

describe('promptFor (段 5 S5)', () => {
  it('prompt は依頼の場所と回数と本文を持ち、MCP で答えるよう求める', () => {
    const job: RequestJob = {
      fileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as FileId,
      sheetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as SheetId,
      nodeId: '11111111-1111-4111-8111-111111111111' as NodeId,
      sent: 2,
      content: '要約して',
    };
    const prompt = promptFor(job);
    for (const part of [
      job.fileId,
      job.sheetId,
      job.nodeId,
      '2 回目',
      '要約して',
    ]) {
      expect(prompt).toContain(part);
    }
    expect(prompt).toContain('read_file');
    expect(prompt).toContain('answer_request');
  });
});
