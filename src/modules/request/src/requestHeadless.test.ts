import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { encodeFile } from '@conversensus/headless/src/encoding';
import { Headless } from '@conversensus/headless/src/headless';
import {
  nodeAdded,
  requestAdded,
} from '@conversensus/headless/src/testing/events';
import {
  AGENT,
  ALICE,
  createHeadlessWorld,
  type HeadlessWorld,
} from '@conversensus/headless/src/testing/headlessWorld';
import {
  connectMcp,
  type McpTestClient,
} from '@conversensus/headless/src/testing/mcpClient';
import type { FileId, GraphFile, SheetId } from '@conversensus/shared';
import { requestStatus } from '@conversensus/shared';
import { sendRequest } from './requestEvents';
import { REQUEST_HEADLESS_MODULE, requestNote } from './requestHeadless';

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

/** agent の Headless に依頼の module を足した MCP server を載せ、SDK の client を in-memory でつなぐ */
async function connectAgent(): Promise<McpTestClient> {
  client = await connectMcp(await as(agentDir, AGENT), [
    REQUEST_HEADLESS_MODULE,
  ]);
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

describe('MCP: 依頼の module の道具 (計画 node-actions-request-module.md B3)', () => {
  it('依頼の module を渡すと、依頼の道具が足される', async () => {
    const c = await connectAgent();
    const names = (await c.client.listTools()).tools.map((t) => t.name);
    for (const name of [
      'answer_request',
      'close_request',
      'list_requests',
      'reopen_request',
      'send_request',
      'set_addressee',
    ]) {
      expect(names).toContain(name);
    }
  });
});

describe('read_file の注釈 (requestNote)', () => {
  it('応答を求める node には、状態・回数・宛先を注釈する (情報は property と答えの edge にある)', () => {
    const CLAIM = '11111111-1111-4111-8111-111111111111';
    const GROUND = '22222222-2222-4222-8222-222222222222';
    const file = {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'f',
      sheets: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          name: 's',
          nodes: [
            {
              id: CLAIM,
              content: '要約して',
              properties: {
                'app.conversensus.request.addressee': ['did:plc:agent'],
                'app.conversensus.request.sent': 2,
              },
            },
            { id: GROUND, content: '前の答え' },
          ],
          edges: [
            {
              id: '55555555-5555-4555-8555-555555555555',
              source: CLAIM,
              target: GROUND,
              properties: { 'app.conversensus.request.answers': 1 },
            },
          ],
        },
      ],
    } as unknown as GraphFile;
    expect(encodeFile(file, () => [], requestNote)).toContain(
      '# 応答を求める node: 送った・未回答 (2 回目)・宛先 did:plc:agent',
    );
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
