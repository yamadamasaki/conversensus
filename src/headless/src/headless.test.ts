import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { NSID } from '@conversensus/client/src/atproto/types';
import type { SheetId } from '@conversensus/shared';
import { Headless } from './headless';
import { nodeAdded } from './testing/events';
import {
  AGENT,
  createHeadlessWorld,
  type HeadlessWorld,
} from './testing/headlessWorld';

let world: HeadlessWorld;
const opened: Headless[] = [];

async function open(dataDir: string): Promise<Headless> {
  const headless = await Headless.open(world.options(dataDir));
  opened.push(headless);
  return headless;
}

beforeEach(() => {
  world = createHeadlessWorld();
});
afterEach(async () => {
  for (const h of opened.splice(0)) await h.close();
  world.dispose();
});

describe('Headless: 開く・ログイン・閉じる (H1)', () => {
  it('ログインすると DID と actor (did#deviceId) が決まる', async () => {
    const headless = await open(world.newDataDir());
    expect(() => headless.did).toThrow();
    await headless.signIn(AGENT.handle, AGENT.password);
    expect(headless.did).toBe(AGENT.did);
    expect(headless.actor.startsWith(`${AGENT.did}#`)).toBe(true);
  });

  it('🔴 同じ dataDir で開き直すと、ログインし直さずに同じ actor で続く (完了基準 6)', async () => {
    const dataDir = world.newDataDir();
    const first = await open(dataDir);
    await first.signIn(AGENT.handle, AGENT.password);
    const actor = first.actor;
    await first.close();

    const second = await open(dataDir);
    expect(second.did).toBe(AGENT.did);
    expect(second.actor).toBe(actor);
  });

  it('別の dataDir は別の端末 (別の actor) になる', async () => {
    const first = await open(world.newDataDir());
    await first.signIn(AGENT.handle, AGENT.password);
    const actor = first.actor;
    await first.close();

    const second = await open(world.newDataDir());
    await second.signIn(AGENT.handle, AGENT.password);
    expect(second.did).toBe(AGENT.did);
    expect(second.actor).not.toBe(actor);
  });

  it('ログアウトして閉じたら、開き直しても未ログイン', async () => {
    const dataDir = world.newDataDir();
    const first = await open(dataDir);
    await first.signIn(AGENT.handle, AGENT.password);
    await first.signOutAndClose();

    const second = await open(dataDir);
    expect(() => second.did).toThrow();
  });

  it('1 プロセスに同時に 2 つは開けない', async () => {
    await open(world.newDataDir());
    await expect(
      Headless.open(world.options(world.newDataDir())),
    ).rejects.toThrow();
  });

  it('閉じたら、入れた localStorage を元に戻す', async () => {
    const before = globalThis.localStorage;
    const headless = await open(world.newDataDir());
    expect(globalThis.localStorage).not.toBe(before);
    await headless.close();
    expect(globalThis.localStorage).toBe(before);
  });

  it('偽の PDS の外へは通信しない', async () => {
    const headless = await open(world.newDataDir());
    await headless.signIn(AGENT.handle, AGENT.password);
    expect(world.unhandled).toEqual([]);
  });
});

describe('Headless: ログインを保つ (段 5 S1)', () => {
  it('セッションが生きていれば何もしない (接続も作り直さない)', async () => {
    const headless = await open(world.newDataDir());
    await headless.signIn(AGENT.handle, AGENT.password);
    const fileId = await headless.createFile('f');
    const clock = headless.clockOf(fileId);
    expect(await headless.ensureSignedIn(AGENT.handle, AGENT.password)).toBe(
      false,
    );
    expect(headless.did).toBe(AGENT.did);
    expect(headless.clockOf(fileId)).toBe(clock);
  });

  it('🔴 PDS でセッションが失効したら、パスワードでログインし直し、同じ actor で書き続ける', async () => {
    const headless = await open(world.newDataDir());
    await headless.signIn(AGENT.handle, AGENT.password);
    const actor = headless.actor;
    const fileId = await headless.createFile('f');
    const sheetId = headless.read(fileId).sheets[0]?.id as SheetId;
    const clock = headless.clockOf(fileId);
    await headless.sync(fileId);

    world.pds.expireSessions();
    expect(await headless.ensureSignedIn(AGENT.handle, AGENT.password)).toBe(
      true,
    );
    expect(headless.actor).toBe(actor);
    // 同じ actor なので発番器は作り直さない (作り直すと番号が戻る)
    expect(headless.clockOf(fileId)).toBe(clock);

    const before = world.pds.records(AGENT.did, NSID.batch).length;
    headless.record(fileId, sheetId, nodeAdded('失効の後').event);
    await headless.sync(fileId);
    expect(world.pds.records(AGENT.did, NSID.batch).length).toBe(before + 1);
  });

  it('パスワードが違えば例外 (ログインし直せない)', async () => {
    const headless = await open(world.newDataDir());
    await headless.signIn(AGENT.handle, AGENT.password);
    world.pds.expireSessions();
    await expect(
      headless.ensureSignedIn(AGENT.handle, 'wrong'),
    ).rejects.toThrow();
  });
});
