/**
 * 常駐のプロセスから MCP を HTTP で出す (agent 段 5 S4、計画 F1・F2)
 *
 * 段 3 の MCP server は stdio で、起動されると自分で `Headless` を開く。常駐の agent が言語モデル
 * (`claude -p`) に stdio の server を渡すと、**同じ置き場所を 2 つのプロセスが取り合う** (`lockDataDir`)。
 * そこで常駐のプロセスが `Headless` を 1 つだけ持ち、その上の MCP を **Streamable HTTP** で出す。
 * 言語モデルにはこの URL を渡す。道具は段 3・4 と同じもの (`createMcpServer`) である。
 *
 * - **127.0.0.1 だけで受ける。**外から繋がせない
 * - **秘密の token を要る** (`Authorization: Bearer`)。同じ機械の他のプロセスにも、agent の DID で
 *   書かせない
 * - 要求ごとに server と transport を作る (stateless)。道具は `Headless` を通して読み書きするので、
 *   MCP のセッションに覚えておくものが無い
 * - **起動ごとに範囲を絞った token を出す** (#386、`grant`)。依頼に答える起動には、その依頼の File と答えに要る
 *   道具だけを許す token を渡し、起動が終われば取り消す。全体の token (`token`) は言語モデルに渡さない
 */

import { timingSafeEqual } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Headless } from '../headless';
import type { HeadlessModule } from '../headlessModule';
import { createMcpServer, type McpScope } from '../mcpServer';

/** MCP を出す path */
export const MCP_PATH = '/mcp';
/** 受ける host。外から繋がせない */
const LOOPBACK_HOST = '127.0.0.1';
/** token の長さ (バイト) */
const TOKEN_BYTES = 32;

/** 推測できない token を作る */
export function newToken(): string {
  return Buffer.from(
    crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)),
  ).toString('hex');
}

/** 長さが違っても時間で漏らさずに比べる */
function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 範囲を絞った token 1 つ */
export type McpGrant = {
  token: string;
  /** 取り消す。以後この token の要求は 401 */
  revoke: () => void;
};

export type HttpMcp = {
  /** 言語モデルに渡す URL */
  url: string;
  /** 範囲を絞った token を出す (起動 1 回ごと) */
  grant: (scope: McpScope) => McpGrant;
  stop: () => Promise<void>;
};

export function serveMcpHttp(
  headless: Headless,
  options: {
    token: string;
    port?: number;
    /** 出す MCP に足す module (依頼の道具など)。入口が決める */
    modules?: readonly HeadlessModule[];
  },
): HttpMcp {
  /** 出している範囲つきの token */
  const grants = new Map<string, McpScope>();
  /** token に当たる範囲。全体の token は範囲なし (`null`)、知らない token は `undefined` */
  const scopeOf = (given: string): McpScope | null | undefined => {
    if (sameToken(given, options.token)) return null;
    for (const [token, scope] of grants) {
      if (sameToken(given, token)) return scope;
    }
    return undefined;
  };
  const server = Bun.serve({
    hostname: LOOPBACK_HOST,
    port: options.port ?? 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== MCP_PATH) {
        return new Response('not found', { status: 404 });
      }
      const auth = request.headers.get('authorization') ?? '';
      const given = auth.startsWith('Bearer ')
        ? auth.slice('Bearer '.length)
        : '';
      const scope = scopeOf(given);
      if (scope === undefined) {
        return new Response('unauthorized', { status: 401 });
      }
      const mcp = createMcpServer(
        headless,
        options.modules,
        scope ?? undefined,
      );
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await mcp.connect(transport);
      try {
        return await transport.handleRequest(request);
      } finally {
        await mcp.close();
      }
    },
  });
  return {
    url: `http://${LOOPBACK_HOST}:${server.port}${MCP_PATH}`,
    grant: (scope) => {
      const token = newToken();
      grants.set(token, scope);
      return { token, revoke: () => grants.delete(token) };
    },
    stop: async () => {
      await server.stop(true);
    },
  };
}
