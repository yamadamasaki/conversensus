import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { type FileId, projectFile } from '@conversensus/shared';
import { Headless } from './headless';
import {
  AGENT,
  ALICE,
  createHeadlessWorld,
  type HeadlessWorld,
} from './testing/headlessWorld';

let world: HeadlessWorld;
let current: Headless | null = null;

/** 端末を切り替える。1 プロセスに 1 つなので、前の端末を閉じてから開く */
async function as(
  dataDir: string,
  account: { handle: string; password: string } | null,
): Promise<Headless> {
  await current?.close();
  current = await Headless.open(world.options(dataDir));
  if (account) await current.signIn(account.handle, account.password);
  return current;
}

/** File の trunk の Sheet ごとの node の本文 */
function contents(headless: Headless, fileId: FileId): string[] {
  const file = projectFile(headless.store.events.getBatches(fileId), fileId);
  return file.sheets.flatMap((sheet) => sheet.nodes.map((n) => n.content));
}

beforeEach(() => {
  world = createHeadlessWorld();
});
afterEach(async () => {
  await current?.close();
  current = null;
  world.dispose();
});

describe('Headless: 参加 (H2)', () => {
  it('🔴 招待された File に参加コードで参加すると、その File が手元に立ち上がる (完了基準 1)', async () => {
    const aliceDir = world.newDataDir();
    const agentDir = world.newDataDir();

    const alice = await as(aliceDir, ALICE);
    const fileId = await alice.createFile('alice の File');
    await alice.sync(fileId);
    const code = await alice.invite(fileId, AGENT.did);

    const agent = await as(agentDir, AGENT);
    expect(await agent.files()).toEqual([]);
    expect(await agent.accept(code)).toBe(fileId);
    const names = (await agent.files()).map((f) => f.name);
    expect(names).toEqual(['alice の File']);
    expect(world.unhandled).toEqual([]);
  });

  it('参加の後、alice の名簿に agent が参加者として載る', async () => {
    const alice = await as(world.newDataDir(), ALICE);
    const fileId = await alice.createFile('名簿を見る File');
    await alice.sync(fileId);
    const code = await alice.invite(fileId, AGENT.did);

    const agent = await as(world.newDataDir(), AGENT);
    await agent.accept(code);
    // 承認は agent の repo の判断ログにある
    const judgments = world.pds.records(
      AGENT.did,
      'app.conversensus.v2.judgment',
    );
    expect(
      judgments.some((r) =>
        JSON.stringify(r.value).includes('participation.accept'),
      ),
    ).toBe(true);
  });

  it('別の DID 宛てのコードは承認しない', async () => {
    const alice = await as(world.newDataDir(), ALICE);
    const fileId = await alice.createFile('別の人宛て');
    await alice.sync(fileId);
    const code = await alice.invite(fileId, AGENT.did);
    // alice 自身がそのコードを使おうとする
    await expect(alice.accept(code)).rejects.toThrow();
  });

  it('壊れたコードは承認しない', async () => {
    const agent = await as(world.newDataDir(), AGENT);
    await expect(agent.accept('not-a-code')).rejects.toThrow();
  });

  it('同じ DID の別の端末で作った File は、自分の repo から見つかる', async () => {
    const first = await as(world.newDataDir(), AGENT);
    const fileId = await first.createFile('別の端末で作った');
    await first.sync(fileId);
    const written = first.store.events.getBatches(fileId).length;

    const second = await as(world.newDataDir(), AGENT);
    const found = await second.discover();
    expect(found.own).toEqual([fileId]);
    expect((await second.files()).map((f) => f.name)).toEqual([
      '別の端末で作った',
    ]);
    // 発見の列挙は各 File の先頭のレコードだけを読むので、差分の deps の基が無いと警告が出る
    // (`[atproto] deferred …`)。それでも立ち上げの取得で全部そろう
    expect(second.store.events.getBatches(fileId)).toHaveLength(written);
  });

  it('発見はべき等: 2 回目は何も立ち上げない', async () => {
    const alice = await as(world.newDataDir(), ALICE);
    const fileId = await alice.createFile('べき等');
    await alice.sync(fileId);
    const code = await alice.invite(fileId, AGENT.did);

    const agent = await as(world.newDataDir(), AGENT);
    await agent.accept(code);
    expect(await agent.discover()).toEqual({ own: [], participating: [] });
  });

  it('開き直した後も、参加した File と中身はそのまま (正典は dataDir の SQLite)', async () => {
    const alice = await as(world.newDataDir(), ALICE);
    const fileId = await alice.createFile('残る');
    await alice.sync(fileId);
    const code = await alice.invite(fileId, AGENT.did);

    const agentDir = world.newDataDir();
    const agent = await as(agentDir, AGENT);
    await agent.accept(code);
    const before = contents(agent, fileId);

    const reopened = await as(agentDir, null);
    expect(reopened.did).toBe(AGENT.did);
    expect(contents(reopened, fileId)).toEqual(before);
  });
});
