/**
 * 常駐の agent の入口 (agent 段 5、設計 D12・D13・A2')
 *
 * 参加している File を同期し続け、module の常駐の振る舞いに知らせる (`startResident.ts`)。言語モデル
 * (`claude -p`) は常駐のプロセスが HTTP で出す MCP で読み書きする。**どの module を使うかはここが決める**
 * (stdio の入口 `mcp.ts` と同じ `HEADLESS_MODULES`、計画 node-actions-request-module.md B4)。
 * 依頼の module は、自分宛てに送られた依頼を見つけると、言語モデルを 1 依頼に 1 回起動する。
 *
 * ```sh
 * CONVERSENSUS_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
 *   bun run src/headless/src/resident/resident.ts --handle agent.test
 * ```
 *
 * 引数は `USAGE` を見る。置き場所 (`--data`) は CLI・stdio の MCP server と同じ形で、**同時には開けない**
 * (常駐の間に参加するには、出している MCP の口を使うか、止めて `cli.ts accept` する)。
 */

import { join } from 'node:path';
import { passwordAuth } from '@conversensus/client/src/atproto/passwordAuth';
import { DEFAULT_DATA_DIR, DEFAULT_PDS_URL } from '../cli';
import { Headless } from '../headless';
import { HEADLESS_MODULES } from '../mcp';
import {
  claudeRunner,
  DEFAULT_MAX_TURNS,
  writeMcpConfig,
} from './claudeRunner';
import { newToken, serveMcpHttp } from './httpMcp';
import { headlessLiveChannel } from './liveSocket';
import { startResident } from './startResident';

/** app password を読む環境変数 */
export const APP_PASSWORD_ENV = 'CONVERSENSUS_APP_PASSWORD';
/**
 * 常駐の MCP の口の設定 file (置き場所の中、全体の token)。**operator が対話の Claude Code をつなぐためのもの**
 * (常駐を止めずに参加する、§5.8)。常駐が起動する `claude -p` には渡さない — そちらは起動ごとに範囲を絞った
 * token の設定を作る (#386、`claudeRunner`)
 */
export const MCP_CONFIG_FILE = 'resident-mcp.json';

export const USAGE = `使い方: resident.ts --handle <handle> [options]
  環境変数 ${APP_PASSWORD_ENV} に app password を入れる (置き場所には残さない)
  --data <dir>          置き場所 (既定 ${DEFAULT_DATA_DIR})
  --pds <url>           PDS (既定 ${DEFAULT_PDS_URL})
  --claude <path>       起動する claude (既定 claude)
  --model <model>       claude のモデル
  --instructions <file> agent 全体の指示 (operator) を書いた file
  --timeout <seconds>   1 つの依頼に使ってよい時間
  --max-turns <n>       1 つの依頼に使ってよい turn (既定 ${DEFAULT_MAX_TURNS})
  --max-budget <usd>    1 つの依頼に使ってよい費用 (USD。既定は上限なし)
  --answer-agents       agent が送った依頼にも答える (既定は答えない)
  --poll <seconds>      流れに繋がっていないときのポーリングの間隔`;

export type ResidentArgs = {
  handle: string;
  dataDir: string;
  pdsUrl: string;
  claude: string;
  model?: string;
  instructionsPath?: string;
  timeoutMs?: number;
  maxTurns?: number;
  maxBudgetUsd?: number;
  answerAgents: boolean;
  pollIntervalMs?: number;
};

/** 値を取らない引数 */
const BOOLEAN_FLAGS = new Set(['answer-agents']);

const MS_PER_SECOND = 1000;

/** 引数を読む。読めなければ理由つきで例外 */
export function parseResidentArgs(argv: readonly string[]): ResidentArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] as string;
    if (!flag.startsWith('--')) throw new Error(`知らない引数: ${flag}`);
    if (BOOLEAN_FLAGS.has(flag.slice(2))) {
      flags.add(flag.slice(2));
      i -= 1; // 値を取らない
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${flag} の値が無い`);
    values.set(flag.slice(2), value);
  }
  const known = new Set([
    'handle',
    'data',
    'pds',
    'claude',
    'model',
    'instructions',
    'timeout',
    'max-turns',
    'max-budget',
    'poll',
  ]);
  for (const key of values.keys()) {
    if (!known.has(key)) throw new Error(`知らない引数: --${key}`);
  }
  const handle = values.get('handle');
  if (!handle) throw new Error('--handle が要る');
  const seconds = (key: string) => {
    const raw = values.get(key);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`--${key} は正の秒数: ${raw}`);
    }
    return n * MS_PER_SECOND;
  };
  const positive = (key: string, integer: boolean) => {
    const raw = values.get(key);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n))) {
      throw new Error(`--${key} は正の${integer ? '整数' : '数'}: ${raw}`);
    }
    return n;
  };
  return {
    handle,
    dataDir: values.get('data') ?? DEFAULT_DATA_DIR,
    pdsUrl: values.get('pds') ?? DEFAULT_PDS_URL,
    claude: values.get('claude') ?? 'claude',
    model: values.get('model'),
    instructionsPath: values.get('instructions'),
    timeoutMs: seconds('timeout'),
    maxTurns: positive('max-turns', true),
    maxBudgetUsd: positive('max-budget', false),
    answerAgents: flags.has('answer-agents'),
    pollIntervalMs: seconds('poll'),
  };
}

if (import.meta.main) {
  let args: ResidentArgs;
  try {
    args = parseResidentArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    process.exit(2);
  }
  const appPassword = process.env[APP_PASSWORD_ENV];
  if (!appPassword) {
    console.error(`環境変数 ${APP_PASSWORD_ENV} に app password を入れる`);
    process.exit(2);
  }
  // 読んだら環境から消す (#390)。起動する claude には決めた環境変数しか渡さないが、二重に守る
  delete process.env[APP_PASSWORD_ENV];
  const headless = await Headless.open({
    dataDir: args.dataDir,
    auth: passwordAuth(args.pdsUrl),
  });
  const token = newToken();
  const http = serveMcpHttp(headless, { token, modules: HEADLESS_MODULES });
  const mcpConfigPath = join(args.dataDir, MCP_CONFIG_FILE);
  writeMcpConfig(mcpConfigPath, http.url, token);
  const log = (m: string) => console.error(`[resident] ${m}`);
  const runner = claudeRunner({
    command: [args.claude],
    // 起動ごとに範囲を絞った token を出す (#386)
    mcp: http,
    configDir: args.dataDir,
    instructionsPath: args.instructionsPath,
    model: args.model,
    maxTurns: args.maxTurns,
    maxBudgetUsd: args.maxBudgetUsd,
    cwd: args.dataDir,
    timeoutMs: args.timeoutMs,
    onOutput: (task, text) =>
      console.error(`[resident] ${task.label} の出力:\n${text.trim()}`),
  });
  const resident = await startResident({
    headless,
    handle: args.handle,
    appPassword,
    live: headlessLiveChannel([args.pdsUrl]),
    pollIntervalMs: args.pollIntervalMs,
    // module の常駐の振る舞い (依頼に答える、など)
    workers: HEADLESS_MODULES.flatMap((m) =>
      m.resident
        ? [
            m.resident({
              headless,
              runner,
              log,
              answerAgents: args.answerAgents,
            }),
          ]
        : [],
    ),
    log,
  });
  console.error(`[resident] MCP: ${http.url}`);
  const close = async () => {
    resident.stop();
    await http.stop();
    await headless.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
