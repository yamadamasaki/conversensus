import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/** 本物の起動の形 (`bun run mcp.ts`) で、別のプロセスとして立てる */
const SERVER = join(import.meta.dir, 'mcp.ts');
/** 繋がらない PDS (ログインしていないので、起動では触らない) */
const UNREACHABLE_PDS = 'http://127.0.0.1:9';
/** プロセスが終わるのを待つ上限 */
const EXIT_TIMEOUT_MS = 10_000;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe('MCP server を stdio で起動する', () => {
  it('道具が見え、未ログインを返し、client が閉じればプロセスが終わる', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'headless-mcp-'));
    dirs.push(dataDir);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['run', SERVER, '--data', dataDir, '--pds', UNREACHABLE_PDS],
      stderr: 'pipe',
    });
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(transport);

    expect(client.getInstructions()).toContain('conversensus');
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    const whoami = (await client.callTool({
      name: 'whoami',
      arguments: {},
    })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(whoami.isError).toBe(true);
    expect(whoami.content[0]?.text).toContain('ログインしていない');

    const pid = transport.pid;
    await client.close();
    // 終われば lock も放している (次の起動が断られない)
    const deadline = Date.now() + EXIT_TIMEOUT_MS;
    const alive = () => {
      try {
        process.kill(pid as number, 0);
        return true;
      } catch {
        return false;
      }
    };
    while (alive() && Date.now() < deadline) await Bun.sleep(50);
    expect(alive()).toBe(false);
    expect(existsSync(join(dataDir, 'lock'))).toBe(false);
  }, 20_000);
});
