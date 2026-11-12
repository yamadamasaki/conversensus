import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { FileId, SheetId } from '@conversensus/shared';
import { Headless } from '../headless';
import { nodeAdded } from '../testing/events';
import {
  AGENT,
  createHeadlessWorld,
  type HeadlessWorld,
} from '../testing/headlessWorld';
import { connectMcpHttp, type McpTestClient } from '../testing/mcpClient';
import { type HttpMcp, newToken, serveMcpHttp } from './httpMcp';

let world: HeadlessWorld;
let headless: Headless;
let http: HttpMcp;
let client: McpTestClient | null = null;
const token = newToken();

beforeEach(async () => {
  world = createHeadlessWorld();
  headless = await Headless.open(world.options(world.newDataDir()));
  await headless.signIn(AGENT.handle, AGENT.password);
  http = serveMcpHttp(headless, { token });
});
afterEach(async () => {
  await client?.close();
  client = null;
  await http.stop();
  await headless.close();
  world.dispose();
});

describe('serveMcpHttp (段 5 S4)', () => {
  it('127.0.0.1 の URL で出す', () => {
    expect(new URL(http.url).hostname).toBe('127.0.0.1');
  });

  it('🔴 token を持つ client は、同じ Headless の上の道具で読み書きできる', async () => {
    const fileId = await headless.createFile('常駐の File');
    const sheetId = headless.read(fileId).sheets[0]?.id as SheetId;
    headless.record(fileId, sheetId, nodeAdded('前からある').event);
    await headless.settled(fileId);

    client = await connectMcpHttp(http.url, token);
    const added = await client.call('add_node', {
      fileId,
      sheetId,
      content: 'HTTP から書いた',
    });
    expect(added.isError).toBe(false);
    const read = await client.call('read_file', { fileId });
    expect(read.text).toContain('前からある');
    expect(read.text).toContain('HTTP から書いた');
    // 同じ Headless なので、常駐のプロセスの手元にも入っている
    expect(
      headless.read(fileId as FileId).sheets[0]?.nodes.map((n) => n.content),
    ).toContain('HTTP から書いた');
  });

  it('token が無い・違う要求は 401 で断る', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    const none = await fetch(http.url, { method: 'POST', headers, body });
    const wrong = await fetch(http.url, {
      method: 'POST',
      headers: { ...headers, authorization: `Bearer ${newToken()}` },
      body,
    });
    expect(none.status).toBe(401);
    expect(wrong.status).toBe(401);
    await expect(connectMcpHttp(http.url, newToken())).rejects.toThrow();
  });

  it('MCP の path の外は 404', async () => {
    const res = await fetch(new URL('/', http.url), {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  it('🔴 範囲つきの token (#386): 範囲の File と道具だけを使え、取り消すと 401', async () => {
    const inside = await headless.createFile('依頼の File');
    const outside = await headless.createFile('別の File');
    const grant = http.grant({
      files: new Set([inside]),
      tools: new Set(['read_file', 'list_files']),
    });
    client = await connectMcpHttp(http.url, grant.token);
    const { tools } = await client.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'list_files',
      'read_file',
    ]);
    expect((await client.call('read_file', { fileId: inside })).isError).toBe(
      false,
    );
    const denied = await client.call('read_file', { fileId: outside });
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain('触れられない');
    const listed = await client.call('list_files');
    expect(listed.text).toContain(inside);
    expect(listed.text).not.toContain(outside);
    await client.close();
    client = null;

    grant.revoke();
    await expect(connectMcpHttp(http.url, grant.token)).rejects.toThrow();
  });
});
