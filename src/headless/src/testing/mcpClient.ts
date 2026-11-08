/**
 * テスト用: Headless に MCP server を載せ、SDK の本物の client を in-memory でつなぐ。
 *
 * App 結合 (`src/client`) からも使う。client の workspace は MCP SDK を依存に持たないので、
 * SDK の import はここ (headless の workspace) に閉じる
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Headless } from '../headless';
import { createMcpServer } from '../mcp';

/** 道具を呼んだ結果: 返した文と、失敗か */
export type Called = { text: string; isError: boolean };

export type McpTestClient = {
  client: Client;
  call(name: string, args?: Record<string, unknown>): Promise<Called>;
  close(): Promise<void>;
};

export async function connectMcp(headless: Headless): Promise<McpTestClient> {
  const server = createMcpServer(headless);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  return {
    client,
    async call(name, args = {}) {
      const result = (await client.callTool({ name, arguments: args })) as {
        content: { type: string; text: string }[];
        isError?: boolean;
      };
      return {
        text: result.content.map((p) => p.text).join('\n'),
        isError: result.isError === true,
      };
    },
    close: () => client.close(),
  };
}

/** 道具の返した文から、最初の id (UUID) を取り出す */
export function idIn(text: string): string {
  const id = text.match(/[0-9a-f]{8}-[0-9a-f-]{27}/)?.[0];
  if (!id) throw new Error(`id が無い: ${text}`);
  return id;
}

/** encoding から、本文が `content` の node の id を引く */
export function nodeIdByContent(encoding: string, content: string): string {
  const lines = encoding.split('\n');
  const at = lines.findIndex(
    (l) => l.trim() === `content ${JSON.stringify(content)}`,
  );
  const id = lines[at - 1]?.trim().match(/^node (\S+)$/)?.[1];
  if (!id) throw new Error(`本文 ${content} の node が無い`);
  return id;
}
