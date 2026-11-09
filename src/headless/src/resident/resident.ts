/**
 * 常駐の agent (agent 段 5、設計 D12・D13・A2')
 *
 * 参加している File を同期し続け (S2)、自分宛てに送られた依頼を見つけると、言語モデルを 1 依頼に 1 回
 * 起動する (S3)。言語モデルは常駐のプロセスが HTTP で出す MCP (S4) で読み書きする (S5)。
 * **conversensus は依頼を評価しない** — ここは見つけて起動するだけである。
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
import type { LiveChannel } from '@conversensus/client/src/sync/liveChannel';
import {
  REQUEST_HEADLESS_MODULE,
  requestsForMe,
} from '@conversensus/request/src/requestHeadless';
import {
  type FileId,
  type NodeId,
  type SheetId,
  sentCountOf,
} from '@conversensus/shared';
import { DEFAULT_DATA_DIR, DEFAULT_PDS_URL } from '../cli';
import { Headless } from '../headless';
import { claudeRunner, writeMcpConfig } from './claudeRunner';
import {
  type AgentRunner,
  createDispatcher,
  type RequestJob,
  storageAttempts,
} from './dispatch';
import { newToken, serveMcpHttp } from './httpMcp';
import { headlessLiveChannel } from './liveSocket';
import { watch } from './watch';

/** 流れに繋がっていないときのポーリングの間隔の既定 */
export const DEFAULT_POLL_INTERVAL_MS = 60_000;
/** 流れに繋がっている間のポーリングの間隔の既定 (合図が抜けたときの保険) */
export const DEFAULT_LIVE_POLL_INTERVAL_MS = 10 * 60_000;
/** app password を読む環境変数 */
export const APP_PASSWORD_ENV = 'CONVERSENSUS_APP_PASSWORD';
/** `claude -p` に渡す MCP の設定 file (置き場所の中) */
export const MCP_CONFIG_FILE = 'resident-mcp.json';

export type ResidentOptions = {
  headless: Headless;
  handle: string;
  appPassword: string;
  runner: AgentRunner;
  /** 流れの合図。無ければポーリングだけ */
  live: LiveChannel | null;
  pollIntervalMs?: number;
  livePollIntervalMs?: number;
  log?: (message: string) => void;
};

export type Resident = {
  /** 今ある契機と依頼を回し終えるまで待つ (試験用) */
  idle: () => Promise<void>;
  stop: () => void;
};

/** 依頼の一覧の 1 行を、起動する依頼にする */
function jobsOf(headless: Headless, fileId: FileId): RequestJob[] {
  return requestsForMe(headless, fileId).map((r) => ({
    fileId,
    sheetId: r.sheet.id as SheetId,
    nodeId: r.node.id as NodeId,
    sent: sentCountOf(r.node),
    content: r.node.content,
  }));
}

/**
 * 常駐を始める。ログインを確かめ (戻せなければ app password で入る)、同期し続け、依頼に起動する。
 * 呼ぶ側は `Headless` を開いておく (閉じるのも呼ぶ側)
 */
export async function startResident(
  options: ResidentOptions,
): Promise<Resident> {
  const { headless, handle, appPassword } = options;
  const log = options.log ?? ((m) => console.error(`[resident] ${m}`));
  await headless.ensureSignedIn(handle, appPassword);
  log(`${headless.did} (${headless.actor}) として常駐する`);

  const dispatcher = createDispatcher({
    requestsOf: (fileId) => jobsOf(headless, fileId),
    runner: {
      run: async (job) => {
        log(`依頼に答える: ${job.fileId} ${job.nodeId} (${job.sent} 回目)`);
        await options.runner.run(job);
      },
    },
    attempts: storageAttempts(localStorage),
    onError: (job, error) => log(`答えられなかった: ${job.nodeId}: ${error}`),
  });

  const stopLive = options.live?.start();
  const watcher = watch({
    files: async () => (await headless.files()).map((f) => f.id as FileId),
    // 見つけ直しはポーリングのたびに走る。そのたびにログインを確かめる (失効していれば入り直す)
    discover: async () => {
      if (await headless.ensureSignedIn(handle, appPassword)) {
        log('セッションが失効していたので、ログインし直した');
      }
      await headless.discover();
    },
    sync: (fileId) => headless.sync(fileId),
    live: options.live,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    livePollIntervalMs:
      options.livePollIntervalMs ?? DEFAULT_LIVE_POLL_INTERVAL_MS,
    onSynced: (fileId) => dispatcher.offer(fileId),
    onError: (error) => log(`同期: ${error}`),
  });

  return {
    idle: async () => {
      await watcher.idle();
      await dispatcher.idle();
    },
    stop: () => {
      watcher.stop();
      stopLive?.();
    },
  };
}

export const USAGE = `使い方: resident.ts --handle <handle> [options]
  環境変数 ${APP_PASSWORD_ENV} に app password を入れる (置き場所には残さない)
  --data <dir>          置き場所 (既定 ${DEFAULT_DATA_DIR})
  --pds <url>           PDS (既定 ${DEFAULT_PDS_URL})
  --claude <path>       起動する claude (既定 claude)
  --model <model>       claude のモデル
  --instructions <file> agent 全体の指示 (operator) を書いた file
  --timeout <seconds>   1 つの依頼に使ってよい時間
  --poll <seconds>      流れに繋がっていないときのポーリングの間隔`;

export type ResidentArgs = {
  handle: string;
  dataDir: string;
  pdsUrl: string;
  claude: string;
  model?: string;
  instructionsPath?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
};

const MS_PER_SECOND = 1000;

/** 引数を読む。読めなければ理由つきで例外 */
export function parseResidentArgs(argv: readonly string[]): ResidentArgs {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] as string;
    const value = argv[i + 1];
    if (!flag.startsWith('--')) throw new Error(`知らない引数: ${flag}`);
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
  return {
    handle,
    dataDir: values.get('data') ?? DEFAULT_DATA_DIR,
    pdsUrl: values.get('pds') ?? DEFAULT_PDS_URL,
    claude: values.get('claude') ?? 'claude',
    model: values.get('model'),
    instructionsPath: values.get('instructions'),
    timeoutMs: seconds('timeout'),
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
  const headless = await Headless.open({
    dataDir: args.dataDir,
    auth: passwordAuth(args.pdsUrl),
  });
  const token = newToken();
  const http = serveMcpHttp(headless, {
    token,
    modules: [REQUEST_HEADLESS_MODULE],
  });
  const mcpConfigPath = join(args.dataDir, MCP_CONFIG_FILE);
  writeMcpConfig(mcpConfigPath, http.url, token);
  const instructions = args.instructionsPath
    ? await Bun.file(args.instructionsPath).text()
    : undefined;
  const resident = await startResident({
    headless,
    handle: args.handle,
    appPassword,
    live: headlessLiveChannel([args.pdsUrl]),
    pollIntervalMs: args.pollIntervalMs,
    runner: claudeRunner({
      command: [args.claude],
      mcpConfigPath,
      instructions,
      model: args.model,
      cwd: args.dataDir,
      timeoutMs: args.timeoutMs,
      onOutput: (job, text) =>
        console.error(`[resident] ${job.nodeId} の出力:\n${text.trim()}`),
    }),
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
