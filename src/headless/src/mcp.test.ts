import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { FileId, SheetId } from '@conversensus/shared';
import { Headless } from './headless';
import { parseServerArgs } from './mcp';
import { nodeAdded } from './testing/events';
import {
  AGENT,
  ALICE,
  createHeadlessWorld,
  type HeadlessWorld,
} from './testing/headlessWorld';
import { connectMcp, idIn, type McpTestClient } from './testing/mcpClient';

let world: HeadlessWorld;
let current: Headless | null = null;
let client: McpTestClient | null = null;
let aliceDir: string;
let agentDir: string;

async function as(
  dataDir: string,
  account: { handle: string; password: string } | null,
): Promise<Headless> {
  await client?.close();
  client = null;
  await current?.close();
  current = await Headless.open(world.options(dataDir));
  if (account) await current.signIn(account.handle, account.password);
  return current;
}

/** agent の Headless に MCP server を載せ、SDK の client を in-memory でつなぐ */
async function connectAgent(): Promise<McpTestClient> {
  client = await connectMcp(await as(agentDir, AGENT));
  return client;
}

/** alice が File を作って 1 つ書き、agent への参加コードを出す */
async function aliceInvitesAgent(): Promise<{
  fileId: FileId;
  sheetId: SheetId;
  code: string;
}> {
  const alice = await as(aliceDir, ALICE);
  const fileId = await alice.createFile('例題');
  const sheetId = alice.read(fileId).sheets[0]?.id as SheetId;
  alice.record(fileId, sheetId, nodeAdded('alice の主張').event);
  await alice.sync(fileId);
  const code = await alice.invite(fileId, AGENT.did);
  return { fileId, sheetId, code };
}

/** alice が同期して、最初の Sheet の node の本文を読む */
async function aliceSees(fileId: FileId, sheetId: SheetId): Promise<string[]> {
  const alice = await as(aliceDir, null);
  await alice.sync(fileId);
  const sheet = alice.read(fileId).sheets.find((s) => s.id === sheetId);
  return (sheet?.nodes ?? []).map((n) => n.content).sort();
}

beforeEach(() => {
  world = createHeadlessWorld();
  aliceDir = world.newDataDir();
  agentDir = world.newDataDir();
});
afterEach(async () => {
  await client?.close();
  client = null;
  await current?.close();
  current = null;
  world.dispose();
});

describe('MCP server (M3)', () => {
  it('道具の一覧に、読む道具と書く道具が並ぶ (module を渡さなければ module の道具は無い)', async () => {
    const c = await connectAgent();
    const names = (await c.client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'accept_invitation',
        'list_participants',
        'add_edge',
        'add_node',
        'list_files',
        'move_node',
        'read_file',
        'remove_edge',
        'remove_node',
        'set_edge_label',
        'set_edge_property',
        'set_node_content',
        'set_node_property',
        'whoami',
      ].sort(),
    );
  });

  it('🔴 参加 → 読む → 書く → alice の手元に届く (完了基準 2・4)', async () => {
    const { fileId, sheetId, code } = await aliceInvitesAgent();
    const c = await connectAgent();

    expect((await c.call('accept_invitation', { code })).text).toContain(
      fileId,
    );
    expect((await c.call('list_files')).text).toContain(
      `file ${fileId} "例題"`,
    );

    const read = await c.call('read_file', { fileId });
    expect(read.text).toContain('content "alice の主張"');
    const aliceNode = read.text.match(
      /node ([0-9a-f-]{36})\n\s+content "alice の主張"/,
    )?.[1];
    expect(aliceNode).toBeDefined();

    const added = await c.call('add_node', {
      fileId,
      sheetId,
      content: 'agent の根拠',
    });
    expect(added.isError).toBe(false);
    const edge = await c.call('add_edge', {
      fileId,
      sheetId,
      source: idIn(added.text),
      target: aliceNode,
      label: '支える',
    });
    expect(edge.isError).toBe(false);

    expect(await aliceSees(fileId, sheetId)).toEqual([
      'agent の根拠',
      'alice の主張',
    ]);
    const alice = current as Headless;
    const sheet = alice.read(fileId).sheets.find((s) => s.id === sheetId);
    expect(sheet?.edges.map((e) => e.label)).toEqual(['支える']);
  });

  it('書いた後に読むと、書いたものが encoding に出る (自分の書き込みを読める)', async () => {
    const { fileId, sheetId, code } = await aliceInvitesAgent();
    const c = await connectAgent();
    await c.call('accept_invitation', { code });
    const added = await c.call('add_node', {
      fileId,
      sheetId,
      content: '足した',
    });
    const id = idIn(added.text);
    await c.call('set_node_content', {
      fileId,
      sheetId,
      nodeId: id,
      content: '直した',
    });
    await c.call('set_node_property', {
      fileId,
      sheetId,
      nodeId: id,
      name: 'priority',
      value: 'high',
    });

    const read = (await c.call('read_file', { fileId })).text;
    expect(read).toContain(`node ${id}\n    content "直した"`);
    expect(read).toContain('prop "priority" "high"');
  });

  it('道具が断ると、理由を isError で返す (server は落ちない)', async () => {
    const { fileId, sheetId, code } = await aliceInvitesAgent();
    const c = await connectAgent();
    await c.call('accept_invitation', { code });
    const missing = '99999999-9999-4999-8999-999999999999';
    const failed = await c.call('remove_node', {
      fileId,
      sheetId,
      nodeId: missing,
    });
    expect(failed).toEqual({
      isError: true,
      text: `この Sheet に node ${missing} は無い`,
    });
    // 続けて使える
    expect((await c.call('read_file', { fileId })).isError).toBe(false);
  });

  it('metagraph (index) の Sheet には書けない', async () => {
    const { fileId, code } = await aliceInvitesAgent();
    const c = await connectAgent();
    await c.call('accept_invitation', { code });
    const index = (current as Headless)
      .read(fileId)
      .sheets.find(
        (s) =>
          s.properties?.['app.conversensus.sheetKind'] ===
          'app.conversensus.metagraph',
      );
    expect(index).toBeDefined();
    const failed = await c.call('add_node', {
      fileId,
      sheetId: index?.id,
      content: 'x',
    });
    expect(failed.isError).toBe(true);
    expect(failed.text).toContain('metagraph');
  });

  it('ログインしていなければ、道具はそう返す', async () => {
    client = await connectMcp(await as(agentDir, null));
    expect(await client.call('whoami')).toEqual({
      isError: true,
      text: '[headless] ログインしていない',
    });
  });
});

describe('parseServerArgs', () => {
  it('--data と --pds を読み、無ければ既定', () => {
    expect(parseServerArgs(['--data', '/d', '--pds', 'http://p'])).toEqual({
      dataDir: '/d',
      pdsUrl: 'http://p',
    });
    expect(parseServerArgs([]).pdsUrl).toBe('http://localhost:3000');
  });

  it('知らない引数・値の無い引数は断る', () => {
    expect(() => parseServerArgs(['--data'])).toThrow(/値が無い/);
    expect(() => parseServerArgs(['login'])).toThrow(/知らない/);
  });
});
