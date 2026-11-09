/**
 * 依頼ごとに `claude -p` を起動する (agent 段 5 S5、計画 F7・F8)
 *
 * 起動された Claude Code は、常駐のプロセスが HTTP で出す conversensus の MCP (S4) **だけ**を使って
 * File を読み、`answer_request` で答える。常駐の側は答えを読まない — 書いたものは MCP を通して
 * 同じ `Headless` に入り、次の同期で依頼した人に届く。
 *
 * ## 使わせる道具を絞る (完了基準 4)
 *
 * | 引数 | 何のため |
 * | --- | --- |
 * | `--tools ""` | 組み込みの道具 (Bash・Edit・Read …) を使わせない。依頼の本文は誰でも書けるので、機械に触らせない |
 * | `--mcp-config <file>` + `--strict-mcp-config` | conversensus の MCP だけを読む (operator の他の MCP server を使わせない) |
 * | `--allowedTools mcp__conversensus` | conversensus の道具は尋ねずに使う |
 * | `--permission-mode dontAsk` | 許していない道具は尋ねずに断る (尋ねる相手がいない) |
 * | `--no-session-persistence` | 会話を置き場所に残さない |
 *
 * MCP の設定は token を含むので、**引数ではなく持ち主だけが読める file** で渡す (`ps` で見えないように)。
 *
 * ## 指示 (D13)
 *
 * - agent 全体 (operator): 任意の file を `--append-system-prompt` で渡す
 * - 種類ごと: template の種類の説明。`read_file` の encoding に出るので、ここでは運ばない
 * - 依頼ごと: 依頼の本文。prompt に引くが、正は `read_file` で読む File の中である
 */

import { chmodSync, writeFileSync } from 'node:fs';
import type { AgentRunner, RequestJob } from './dispatch';

/** MCP の設定での conversensus の名前。道具の名前は `mcp__<これ>__<道具>` になる */
export const MCP_SERVER_NAME = 'conversensus';
/** 1 つの依頼に使ってよい時間の既定 */
export const DEFAULT_RUN_TIMEOUT_MS = 10 * 60_000;
/** 持ち主だけが読み書きできる */
const OWNER_ONLY = 0o600;

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

/** 依頼 1 つへの prompt */
export function promptFor(job: RequestJob): string {
  return [
    'あなたは conversensus という共同編集のグラフに参加している agent です。',
    'あなた宛てに依頼が送られてきました。conversensus の MCP の道具だけを使って答えてください。',
    '',
    `- File: ${job.fileId}`,
    `- Sheet: ${job.sheetId}`,
    `- 依頼の node: ${job.nodeId} (${job.sent} 回目の送信)`,
    '',
    '依頼の本文 (正は File の中です):',
    '```',
    job.content,
    '```',
    '',
    '手順:',
    '1. read_file でこの File を読み、依頼の前後の文脈と、依頼の種類の説明 (種類ごとの指示) を確かめる',
    '2. answer_request で答えを書く (答えは新しい node になり、依頼から edge が張られる)',
    '3. 答えられないときは、答えられない理由を答えとして書く',
  ].join('\n');
}

export type ClaudeRunnerOptions = {
  /** 起動するコマンド。既定は `['claude']`。後ろに引数を足す */
  command?: readonly string[];
  mcpConfigPath: string;
  /** agent 全体の指示 (operator)。無ければ渡さない */
  instructions?: string;
  /** 使うモデル (`--model`)。無ければ Claude Code の既定 */
  model?: string;
  /** 起動したプロセスの作業 directory。repo の CLAUDE.md や設定を読ませないため、置き場所にする */
  cwd: string;
  timeoutMs?: number;
  /** 起動したプロセスの環境変数。既定は常駐のプロセスのもの (Claude Code のログインは HOME の下にある) */
  env?: Record<string, string | undefined>;
  /** 起動したプロセスの出力 (log に残す) */
  onOutput?: (job: RequestJob, text: string) => void;
};

/** `claude` に渡す引数 */
export function claudeArgs(
  job: RequestJob,
  options: Pick<
    ClaudeRunnerOptions,
    'mcpConfigPath' | 'instructions' | 'model'
  >,
): string[] {
  return [
    '-p',
    promptFor(job),
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
    ...(options.instructions
      ? ['--append-system-prompt', options.instructions]
      : []),
    ...(options.model ? ['--model', options.model] : []),
  ];
}

/** 起動が失敗した (終了コードが 0 でない・時間切れ) */
export class AgentRunError extends Error {}

export function claudeRunner(options: ClaudeRunnerOptions): AgentRunner {
  const command = options.command ?? ['claude'];
  const timeoutMs = options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  return {
    async run(job) {
      const child = Bun.spawn([...command, ...claudeArgs(job, options)], {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const timer = setTimeout(() => child.kill(), timeoutMs);
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        Bun.readableStreamToText(child.stdout),
        Bun.readableStreamToText(child.stderr),
      ]).finally(() => clearTimeout(timer));
      options.onOutput?.(job, stdout + stderr);
      if (child.signalCode !== null) {
        throw new AgentRunError(
          `時間切れで止めた (${timeoutMs} ms): ${job.nodeId}`,
        );
      }
      if (code !== 0) {
        throw new AgentRunError(`終了コード ${code}: ${stderr.trim()}`);
      }
    },
  };
}
