import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { sendRequest } from '@conversensus/request/src/requestEvents';
import type { FileId, SheetId } from '@conversensus/shared';
import { requestStatus } from '@conversensus/shared';
import { Headless } from './headless';
import { parseServerArgs } from './mcp';
import { nodeAdded, requestAdded } from './testing/events';
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
  it('道具の一覧に、読む道具と書く道具が並ぶ', async () => {
    const c = await connectAgent();
    const names = (await c.client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'accept_invitation',
        'answer_request',
        'close_request',
        'list_participants',
        'list_requests',
        'reopen_request',
        'send_request',
        'set_addressee',
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

describe('MCP: 依頼 (agent 段 4 R6)', () => {
  /** alice が agent を招き、宛先 `addressee` の依頼を作って送る。agent は MCP で参加する */
  async function aliceSendsRequest(addressee: string[]) {
    const { fileId, sheetId, code } = await aliceInvitesAgent();
    const alice = current as Headless;
    const req = requestAdded('この章を要約して', addressee);
    alice.record(fileId, sheetId, req.event);
    alice.record(fileId, sheetId, sendRequest(req.node));
    await alice.sync(fileId);
    const c = await connectAgent();
    await c.call('accept_invitation', { code });
    return { c, fileId, sheetId, nodeId: req.nodeId };
  }

  it('🔴 自分宛ての依頼を list_requests で見つけ、answer_request で答えると、alice の手元で回答あり (完了基準 5)', async () => {
    const { c, fileId, sheetId, nodeId } = await aliceSendsRequest([AGENT.did]);

    const listed = (await c.call('list_requests')).text;
    expect(listed).toContain(
      `request ${nodeId} file ${fileId} sheet ${sheetId} (1 回目) from ${ALICE.did}`,
    );
    expect(listed).toContain('content "この章を要約して"');
    expect((await c.call('read_file', { fileId })).text).toContain(
      '# 応答を求める node: 送った・未回答 (1 回目)',
    );

    const answered = await c.call('answer_request', {
      fileId,
      sheetId,
      nodeId,
      content: '要約です',
    });
    expect(answered.isError).toBe(false);
    // 答えたら、もう未回答の一覧には出ない
    expect((await c.call('list_requests', { fileId })).text).toBe(
      '(自分宛ての未回答の依頼は無い)',
    );

    const alice = await as(aliceDir, null);
    await alice.sync(fileId);
    const sheet = alice.read(fileId).sheets.find((s) => s.id === sheetId);
    const req = sheet?.nodes.find((n) => n.id === nodeId);
    if (!sheet || !req) throw new Error('依頼が無い');
    expect(requestStatus(req, sheet.edges)).toBe('answered');
    expect(sheet.nodes.map((n) => n.content)).toContain('要約です');
  });

  it('宛先が不特定 (空) なら届く', async () => {
    const { c } = await aliceSendsRequest([]);
    expect((await c.call('list_requests')).text).toContain('この章を要約して');
  });

  it('他の人宛ての依頼は一覧に出ない', async () => {
    const { c } = await aliceSendsRequest(['did:plc:someone-else']);
    expect((await c.call('list_requests')).text).toBe(
      '(自分宛ての未回答の依頼は無い)',
    );
  });

  it('agent も依頼を送れる: 宛先を参加者から選び、送る。自分が送った依頼は自分の一覧に出ない', async () => {
    const { c, fileId, sheetId, nodeId } = await aliceSendsRequest([]);
    const participants = (await c.call('list_participants', { fileId })).text;
    expect(participants).toContain(ALICE.did);

    await c.call('set_addressee', {
      fileId,
      sheetId,
      nodeId,
      dids: [ALICE.did, AGENT.did],
    });
    expect(
      (await c.call('send_request', { fileId, sheetId, nodeId })).isError,
    ).toBe(false);
    // 最後に送ったのは agent なので、宛先に自分が入っていても出さない
    expect((await c.call('list_requests', { fileId })).text).toBe(
      '(自分宛ての未回答の依頼は無い)',
    );
    expect((await c.call('read_file', { fileId })).text).toContain(
      `# 応答を求める node: 送った・未回答 (2 回目)・宛先 ${ALICE.did}, ${AGENT.did}`,
    );
  });

  it('閉じた依頼には答えられず、理由を返す。開き直せば答えられる', async () => {
    const { c, fileId, sheetId, nodeId } = await aliceSendsRequest([AGENT.did]);
    await c.call('close_request', { fileId, sheetId, nodeId });
    const failed = await c.call('answer_request', {
      fileId,
      sheetId,
      nodeId,
      content: 'x',
    });
    expect(failed).toEqual({
      isError: true,
      text: '閉じた依頼には答えられない',
    });
    await c.call('reopen_request', { fileId, sheetId, nodeId });
    expect(
      (
        await c.call('answer_request', {
          fileId,
          sheetId,
          nodeId,
          content: 'x',
        })
      ).isError,
    ).toBe(false);
  });
});
