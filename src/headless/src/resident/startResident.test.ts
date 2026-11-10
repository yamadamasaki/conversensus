import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { FileId } from '@conversensus/shared';
import { Headless } from '../headless';
import type { ResidentWorker } from '../headlessModule';
import { nodeAdded } from '../testing/events';
import {
  AGENT,
  ALICE,
  createHeadlessWorld,
  type HeadlessWorld,
} from '../testing/headlessWorld';
import { startResident } from './startResident';

/** 試験の間には来ないポーリング (同期は始めたときの 1 回だけ) */
const NEVER = 60 * 60_000;

let world: HeadlessWorld;
let current: Headless | null = null;

beforeEach(() => {
  world = createHeadlessWorld();
});
afterEach(async () => {
  await current?.close();
  current = null;
  world.dispose();
});

async function open(
  dataDir: string,
  account: { handle: string; password: string } | null,
): Promise<Headless> {
  await current?.close();
  current = await Headless.open(world.options(dataDir));
  if (account) await current.signIn(account.handle, account.password);
  return current;
}

/** alice が File を作って agent を招き、agent が参加する。agent の置き場所を返す */
async function agentJoinsAFile(): Promise<{
  agentDir: string;
  fileId: FileId;
}> {
  const alice = await open(world.newDataDir(), ALICE);
  const fileId = await alice.createFile('常駐の File');
  const sheetId = alice.read(fileId).sheets[0]?.id as string;
  alice.record(fileId, sheetId as never, nodeAdded('alice の主張').event);
  await alice.sync(fileId);
  const code = await alice.invite(fileId, AGENT.did);
  const agentDir = world.newDataDir();
  const agent = await open(agentDir, AGENT);
  await agent.accept(code);
  return { agentDir, fileId };
}

/** 知らされた File を覚える worker (module の常駐の振る舞いの代わり) */
function recordingWorker(): ResidentWorker & { offered: FileId[] } {
  const offered: FileId[] = [];
  return { offered, offer: (id) => offered.push(id), idle: async () => {} };
}

/** 常駐を始めて、今ある契機を回し終えたら止める */
async function runOnce(agentDir: string, workers: readonly ResidentWorker[]) {
  // 開き直す: 前のセッションが置き場所から戻る (戻せなければ app password で入る)
  const agent = await open(agentDir, null);
  const resident = await startResident({
    headless: agent,
    handle: AGENT.handle,
    appPassword: AGENT.password,
    workers,
    live: null,
    pollIntervalMs: NEVER,
    livePollIntervalMs: NEVER,
    log: () => {},
  });
  await resident.idle();
  resident.stop();
  return agent;
}

describe('startResident (段 5 S6、汎用にしたのは計画 node-actions-request-module.md B4)', () => {
  it('参加している File を同期し終えると、どの worker にも知らせる', async () => {
    const { agentDir, fileId } = await agentJoinsAFile();
    const a = recordingWorker();
    const b = recordingWorker();
    const agent = await runOnce(agentDir, [a, b]);
    expect(a.offered).toContain(fileId);
    expect(b.offered).toContain(fileId);
    // 知らせる前に同期している (alice の node が手元にある)
    const sheet = agent.read(fileId).sheets[0];
    expect(sheet?.nodes.map((n) => n.content)).toContain('alice の主張');
  });

  it('セッションが失効していても、始めるときに app password で入り直して続ける', async () => {
    const { agentDir, fileId } = await agentJoinsAFile();
    world.pds.expireSessions();
    const w = recordingWorker();
    await runOnce(agentDir, [w]);
    expect(w.offered).toContain(fileId);
  });

  it('idle は worker の仕事が終わるまで待つ', async () => {
    const { agentDir } = await agentJoinsAFile();
    let finished = false;
    const slow: ResidentWorker = {
      offer: () => {},
      idle: async () => {
        await Bun.sleep(10);
        finished = true;
      },
    };
    await runOnce(agentDir, [slow]);
    expect(finished).toBe(true);
  });
});
