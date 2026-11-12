/**
 * 仕事ごとに `claude -p` を起動する (agent 段 5 S5、計画 F7・F8)
 *
 * 起動された Claude Code は、常駐のプロセスが HTTP で出す conversensus の MCP (S4) **だけ**を使って
 * 読み書きする。何を頼むか (prompt) と、どこまで許すか (範囲) は module が決める (依頼の module なら
 * 「read_file で読み、`answer_request` で答える」、触れてよいのは依頼の File、計画 node-actions-request-module.md B4)。
 * 常駐の側は答えを読まない — 書いたものは MCP を通して同じ `Headless` に入り、次の同期で届く。
 *
 * ## 使わせる道具を絞る (完了基準 4、#386)
 *
 * | 引数 | 何のため |
 * | --- | --- |
 * | `--tools ""` | 組み込みの道具 (Bash・Edit・Read …) を使わせない。依頼の本文は誰でも書けるので、機械に触らせない |
 * | `--mcp-config <file>` + `--strict-mcp-config` | conversensus の MCP だけを読む (operator の他の MCP server を使わせない) |
 * | `--allowedTools mcp__conversensus` | conversensus の道具は尋ねずに使う |
 * | `--permission-mode dontAsk` | 許していない道具は尋ねずに断る (尋ねる相手がいない) |
 * | `--no-session-persistence` | 会話を置き場所に残さない |
 *
 * conversensus の MCP の中も絞る。**起動ごとに範囲つきの token を出し** (`McpGrants.grant`)、その起動の依頼の
 * File と答えに要る道具だけを許す。起動が終われば取り消す。
 *
 * MCP の設定は token を含むので、**引数ではなく持ち主だけが読める file** で渡し (`ps` で見えないように)、
 * 起動が終われば消す。
 *
 * ## operator の設定を通さない (#390)
 *
 * | | |
 * | --- | --- |
 * | `--setting-sources ""` | operator の設定 (hooks・plugin・CLAUDE.md) を読まない。`--bare` は Claude Code のログイン (OAuth) を読まないので使わない |
 * | 環境変数 | 決めたものだけを渡す (`agentEnv`)。常駐の環境には app password がある |
 * | prompt は stdin | 依頼の本文を引数 (`ps` で見える) に載せない |
 * | 指示は file (`--append-system-prompt-file`) | 同じ理由 |
 *
 * ## 使いすぎない (#387)
 *
 * `--max-turns` と `--max-budget-usd` を渡せる (既定は turn だけ)。起動の回数の上限は module の側 (依頼の module の
 * `createDispatcher`) が持つ。
 *
 * ## 指示 (D13)
 *
 * - agent 全体 (operator): 任意の file を `--append-system-prompt-file` で渡す
 * - 種類ごと: template の種類の説明。`read_file` の encoding に出るので、ここでは運ばない
 * - 依頼ごと: 依頼の本文。module が prompt に引くが、正は `read_file` で読む File の中である
 */

import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FileId } from '@conversensus/shared';
import type { McpScope } from '../mcpServer';

/** MCP の設定での conversensus の名前。道具の名前は `mcp__<これ>__<道具>` になる */
export const MCP_SERVER_NAME = 'conversensus';
/** 1 つの依頼に使ってよい時間の既定 */
export const DEFAULT_RUN_TIMEOUT_MS = 10 * 60_000;
/** 1 つの依頼に使ってよい turn の既定 (#387)。読んで答えるには十分で、往復が続けば止まる */
export const DEFAULT_MAX_TURNS = 30;
/** 持ち主だけが読み書きできる */
const OWNER_ONLY = 0o600;

/**
 * 起動した Claude Code に渡す環境変数 (#390)。ここに挙げたものと、前置きの合うものだけを渡す。
 * Claude Code のログイン (HOME の下と keychain) と、API key・クラウドの認証 (3P) が要る
 */
const PASSED_ENV = new Set([
  'HOME',
  'PATH',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
]);
const PASSED_ENV_PREFIXES = [
  'ANTHROPIC_',
  'CLAUDE_',
  'AWS_',
  'GOOGLE_',
  'CLOUD_ML_',
] as const;

/** 常駐の環境から、起動した Claude Code に渡すものだけを抜き出す (#390) */
export function agentEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (
      PASSED_ENV.has(name) ||
      PASSED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))
    ) {
      picked[name] = value;
    }
  }
  return picked;
}

/** `claude -p` に渡す MCP の設定 file を書く (token を含むので持ち主だけ) */
export function writeMcpConfig(path: string, url: string, token: string): void {
  const config = {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'http',
        url,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  };
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: OWNER_ONLY });
  // 既にあった file には mode が効かないので、改めて絞る
  chmodSync(path, OWNER_ONLY);
}

/** 起動 1 回に許す範囲 (#386)。module が決める */
export type TaskScope = {
  /** 触れてよい File */
  files: readonly FileId[];
  /** 使わせる conversensus の道具 (名前) */
  tools: readonly string[];
};

/** 言語モデルに頼む仕事 1 つ。何を頼むか (prompt) と、どこまで許すか (scope) は module が決める */
export type AgentTask = {
  /** log と失敗の理由に出す名前 (依頼の node など) */
  label: string;
  prompt: string;
  scope: TaskScope;
};

/** 言語モデルを起動する口 (既定は `claude -p`。試験では偽物) */
export interface AgentRunner {
  run(task: AgentTask): Promise<void>;
}

/** 常駐の MCP の口: URL と、範囲つきの token を出す口 (`serveMcpHttp` が返すもの) */
export type McpGrants = {
  url: string;
  grant: (scope: McpScope) => { token: string; revoke: () => void };
};

export type ClaudeRunnerOptions = {
  /** 起動するコマンド。既定は `['claude']`。後ろに引数を足す */
  command?: readonly string[];
  mcp: McpGrants;
  /** 起動ごとの MCP の設定 file を置く directory (置き場所。持ち主だけが読める所) */
  configDir: string;
  /** agent 全体の指示 (operator) を書いた file。無ければ渡さない */
  instructionsPath?: string;
  /** 使うモデル (`--model`)。無ければ Claude Code の既定 */
  model?: string;
  /** 1 つの依頼に使ってよい turn (#387)。既定 `DEFAULT_MAX_TURNS` */
  maxTurns?: number;
  /** 1 つの依頼に使ってよい費用 (USD、#387)。無ければ渡さない */
  maxBudgetUsd?: number;
  /** 起動したプロセスの作業 directory。repo の CLAUDE.md や設定を読ませないため、置き場所にする */
  cwd: string;
  timeoutMs?: number;
  /** 常駐の環境変数。渡すのは `agentEnv` で抜き出したものだけ (既定は常駐のプロセスのもの) */
  env?: Readonly<Record<string, string | undefined>>;
  /** 起動したプロセスの出力 (log に残す) */
  onOutput?: (task: AgentTask, text: string) => void;
};

/** `claude` に渡す引数。prompt は引数に載せず stdin で渡す */
export function claudeArgs(
  options: Pick<
    ClaudeRunnerOptions,
    'instructionsPath' | 'model' | 'maxTurns' | 'maxBudgetUsd'
  > & { mcpConfigPath: string },
): string[] {
  return [
    '-p',
    '--tools',
    '',
    '--mcp-config',
    options.mcpConfigPath,
    '--strict-mcp-config',
    '--allowedTools',
    `mcp__${MCP_SERVER_NAME}`,
    '--permission-mode',
    'dontAsk',
    '--no-session-persistence',
    '--setting-sources',
    '',
    '--max-turns',
    String(options.maxTurns ?? DEFAULT_MAX_TURNS),
    ...(options.maxBudgetUsd !== undefined
      ? ['--max-budget-usd', String(options.maxBudgetUsd)]
      : []),
    ...(options.instructionsPath
      ? ['--append-system-prompt-file', options.instructionsPath]
      : []),
    ...(options.model ? ['--model', options.model] : []),
  ];
}

/** 起動が失敗した (終了コードが 0 でない・時間切れ) */
export class AgentRunError extends Error {}

export function claudeRunner(options: ClaudeRunnerOptions): AgentRunner {
  const command = options.command ?? ['claude'];
  const timeoutMs = options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  const env = agentEnv(options.env ?? process.env);
  return {
    async run(task) {
      const grant = options.mcp.grant({
        files: new Set(task.scope.files),
        tools: new Set(task.scope.tools),
      });
      // 起動ごとに別の file (同時に走っても互いの token を上書きしない)
      const mcpConfigPath = join(
        options.configDir,
        `resident-mcp-${crypto.randomUUID()}.json`,
      );
      try {
        writeMcpConfig(mcpConfigPath, options.mcp.url, grant.token);
        const child = Bun.spawn(
          [...command, ...claudeArgs({ ...options, mcpConfigPath })],
          {
            cwd: options.cwd,
            env,
            // Blob ではなくバイト列で渡す (試験の happy-dom は Blob を差し替え、Bun.spawn が受けない)
            stdin: new TextEncoder().encode(task.prompt),
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        const timer = setTimeout(() => child.kill(), timeoutMs);
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          Bun.readableStreamToText(child.stdout),
          Bun.readableStreamToText(child.stderr),
        ]).finally(() => clearTimeout(timer));
        options.onOutput?.(task, stdout + stderr);
        if (child.signalCode !== null) {
          throw new AgentRunError(
            `時間切れで止めた (${timeoutMs} ms): ${task.label}`,
          );
        }
        if (code !== 0) {
          throw new AgentRunError(`終了コード ${code}: ${stderr.trim()}`);
        }
      } finally {
        grant.revoke();
        rmSync(mcpConfigPath, { force: true });
      }
    },
  };
}
