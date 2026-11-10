/**
 * MCP server の入口 (agent 段 3 M3, 設計 D3・D4, #349)。Claude Code などの MCP client が stdio で起動する:
 *
 * ```sh
 * bun run src/headless/src/cli.ts login agent.test     # 先に一度だけ (ブラウザで同意する)
 * claude mcp add conversensus -- bun run <repo>/src/headless/src/mcp.ts [--data <dir>] [--pds <url>]
 * ```
 *
 * - **ログインは CLI で済ませておく。**stdio の server はブラウザの同意を待てないので、ここは
 *   前のセッションを戻す (`resume`) だけである
 * - **標準出力は MCP の通信路**なので、client の部品が出す `console.log` は標準エラーへ回す
 * - **どの module を使うかはここが決める** (計画 node-actions-request-module.md B3)。道具そのものは
 *   `mcpServer.ts` と module にある
 */

import { join } from 'node:path';
import { REQUEST_HEADLESS_MODULE } from '@conversensus/request/src/requestHeadless';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEFAULT_DATA_DIR, DEFAULT_PDS_URL, OAUTH_FILE } from './cli';
import { Headless } from './headless';
import type { HeadlessModule } from './headlessModule';
import { createMcpServer } from './mcpServer';
import { oauthLoopback } from './oauthLoopback';

/** この入口が使う module */
export const HEADLESS_MODULES: readonly HeadlessModule[] = [
  REQUEST_HEADLESS_MODULE,
];

/** 引数から置き場所と PDS を読む (`--data <dir>`、`--pds <url>`) */
export function parseServerArgs(argv: readonly string[]): {
  dataDir: string;
  pdsUrl: string;
} {
  let dataDir = DEFAULT_DATA_DIR;
  let pdsUrl = DEFAULT_PDS_URL;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === '--data' || arg === '--pds') && next === undefined) {
      throw new Error(`${arg} の値が無い`);
    }
    if (arg === '--data') dataDir = next as string;
    else if (arg === '--pds') pdsUrl = next as string;
    else throw new Error(`知らない引数: ${arg}`);
    i++;
  }
  return { dataDir, pdsUrl };
}

if (import.meta.main) {
  // 標準出力は MCP の通信路。client の部品のログで壊さない
  console.log = console.error;
  console.info = console.error;
  const { dataDir, pdsUrl } = parseServerArgs(process.argv.slice(2));
  const headless = await Headless.open({
    dataDir,
    auth: oauthLoopback({
      pdsUrl,
      storePath: join(dataDir, OAUTH_FILE),
      openUrl: () => {
        throw new Error(
          'MCP server からはログインしない。先に cli.ts login を使う',
        );
      },
    }),
  });
  const server = createMcpServer(headless, HEADLESS_MODULES);
  const close = async () => {
    await server.close();
    await headless.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  // client が stdin を閉じたら終わる
  process.stdin.on('end', close);
  await server.connect(new StdioServerTransport());
}
