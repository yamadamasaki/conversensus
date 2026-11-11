import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  appliedTemplatePropertyOf,
  appliedTemplateValueOf,
  type FileId,
  heldMaxima,
  type NodeId,
  SHEET_KIND_PROPERTY,
  type SheetId,
  TEMPLATE_SHEET_KIND,
} from '@conversensus/shared';
import { Headless } from './headless';
import { contentChanged, nodeAdded } from './testing/events';
import {
  AGENT,
  ALICE,
  createHeadlessWorld,
  type HeadlessWorld,
} from './testing/headlessWorld';

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

/** File の最初の Sheet (`createFile` が作る「Sheet 1」) */
function firstSheet(headless: Headless, fileId: FileId): SheetId {
  const sheet = headless.read(fileId).sheets[0];
  if (!sheet) throw new Error('Sheet が無い');
  return sheet.id as SheetId;
}

/**
 * 最初の Sheet の node の本文 (並べ替えたもの)。File には metagraph (`index`) もあり、Sheet ごとの
 * 導出 node を持つので、全 Sheet を集めると数が合わない
 */
function contentsOf(headless: Headless, fileId: FileId): string[] {
  const sheetId = firstSheet(headless, fileId);
  const sheet = headless.read(fileId).sheets.find((s) => s.id === sheetId);
  return (sheet?.nodes ?? []).map((n) => n.content).sort();
}

/** alice が File を作って 1 つ書き、agent を参加させる */
async function sharedFile(): Promise<{ fileId: FileId; sheetId: SheetId }> {
  const alice = await as(aliceDir, ALICE);
  const fileId = await alice.createFile('共有の File');
  const sheetId = firstSheet(alice, fileId);
  alice.record(fileId, sheetId, nodeAdded('alice が書いた').event);
  await alice.sync(fileId);
  const code = await alice.invite(fileId, AGENT.did);
  const agent = await as(agentDir, AGENT);
  await agent.accept(code);
  return { fileId, sheetId };
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

describe('Headless: 読み書き (H3)', () => {
  it('🔴 参加した File の、相手が書いた中身を読める (完了基準 2)', async () => {
    const { fileId } = await sharedFile();
    expect(contentsOf(current as Headless, fileId)).toEqual(['alice が書いた']);
  });

  it('🔴 agent が書いたものを、alice が同期して読める (完了基準 3)', async () => {
    const { fileId, sheetId } = await sharedFile();
    const agent = current as Headless;
    agent.record(fileId, sheetId, nodeAdded('agent が書いた').event);
    await agent.sync(fileId);

    const alice = await as(aliceDir, null);
    await alice.sync(fileId);
    expect(contentsOf(alice, fileId)).toEqual([
      'agent が書いた',
      'alice が書いた',
    ]);
  });

  it('agent の書き込みは agent の actor で op-log に載る (由来が壊れない, 設計 D1)', async () => {
    const { fileId, sheetId } = await sharedFile();
    const agent = current as Headless;
    agent.record(fileId, sheetId, nodeAdded('由来を見る').event);
    await agent.settled(fileId);
    const mine = agent.store.events
      .getBatches(fileId)
      .filter((b) => b.actor === agent.actor);
    expect(mine).toHaveLength(1);
    // 送ったのは agent の repo
    await agent.sync(fileId);
    const own = world.pds
      .records(AGENT.did, 'app.conversensus.v2.batch')
      .filter((r) => (r.value as { actor: string }).actor === agent.actor);
    expect(own).toHaveLength(1);
  });

  it('本文の書き換えも往復する', async () => {
    const { fileId, sheetId } = await sharedFile();
    const agent = current as Headless;
    const { nodeId, event } = nodeAdded('下書き');
    agent.record(fileId, sheetId, event);
    agent.record(fileId, sheetId, contentChanged(nodeId, '下書き', '清書'));
    await agent.sync(fileId);

    const alice = await as(aliceDir, null);
    await alice.sync(fileId);
    expect(contentsOf(alice, fileId)).toEqual(['alice が書いた', '清書']);
  });

  it('開き直した agent が書いても、点 (actor, seq) が前の起動と重ならない', async () => {
    const { fileId, sheetId } = await sharedFile();
    const first = current as Headless;
    first.record(fileId, sheetId, nodeAdded('1 回目の起動').event);
    await first.sync(fileId);

    const second = await as(agentDir, null);
    second.record(fileId, sheetId, nodeAdded('2 回目の起動').event);
    await second.sync(fileId);

    const points = second.store.events
      .getBatches(fileId)
      .filter((b) => b.actor === second.actor)
      .map((b) => b.seq);
    expect(new Set(points).size).toBe(points.length);
    // agent の repo にある agent 自身の batch は 2 つ。genesis (File の起源) も送られうるが、
    // それは誰の repo に出てもよい扱いである (`remoteFilter.ts`)
    const own = world.pds
      .records(AGENT.did, 'app.conversensus.v2.batch')
      .filter((r) =>
        (r.value as { actor: string }).actor.startsWith(AGENT.did),
      );
    expect(own).toHaveLength(2);
  });

  it('既にある Sheet に後から当てた template の種別が、encoding の注釈に出る (#355)', async () => {
    const alice = await as(aliceDir, ALICE);
    const fileId = await alice.createFile('後から当てる');
    const sheetId = firstSheet(alice, fileId);
    // template graph を作り、種類の node (label のある node) を 1 つ置く
    const templateSheet = crypto.randomUUID() as SheetId;
    alice.record(fileId, templateSheet, {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      category: 'file',
      type: 'SHEET_CREATED',
      sheetId: templateSheet,
      name: '依頼の型',
      properties: { [SHEET_KIND_PROPERTY]: TEMPLATE_SHEET_KIND },
    });
    const kind = crypto.randomUUID() as NodeId;
    alice.record(fileId, templateSheet, {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      category: 'structure',
      type: 'NODE_ADDED',
      nodeId: kind,
      data: { id: kind, content: '答えてほしいこと', label: '依頼' },
    });
    await alice.settled(fileId);
    expect(alice.encode(fileId)).not.toContain('# template "依頼の型"');

    // 最初の Sheet に、今の姿 (切断面) で当てる
    alice.record(fileId, sheetId, {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      category: 'file',
      type: 'SHEET_PROPERTY_CHANGED',
      sheetId,
      name: appliedTemplatePropertyOf(templateSheet),
      value: appliedTemplateValueOf(heldMaxima(alice.batches(fileId))),
    });
    await alice.settled(fileId);
    const encoding = alice.encode(fileId);
    expect(encoding).toContain(`# template "依頼の型"`);
    expect(encoding).toContain(`node 種別 "依頼"=${kind}`);
    expect(encoding).toContain('# 後から当てた template "依頼の型"');
  });
});
