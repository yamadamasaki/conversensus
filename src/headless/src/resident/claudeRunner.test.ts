import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileId, NodeId, SheetId } from '@conversensus/shared';
import {
  AgentRunError,
  claudeArgs,
  claudeRunner,
  MCP_SERVER_NAME,
  promptFor,
  writeMcpConfig,
} from './claudeRunner';
import type { RequestJob } from './dispatch';

const JOB: RequestJob = {
  fileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as FileId,
  sheetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as SheetId,
  nodeId: '11111111-1111-4111-8111-111111111111' as NodeId,
  sent: 2,
  content: '要約して',
};
const FAKE_CLAUDE = join(import.meta.dir, '..', 'testing', 'fakeClaude.ts');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'claude-runner-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 引数の直後の値 */
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('claudeArgs (段 5 S5)', () => {
  const args = claudeArgs(JOB, { mcpConfigPath: '/x/mcp.json' });

  it('🔴 使わせる道具を conversensus の MCP だけに絞る (完了基準 4)', () => {
    expect(after(args, '--tools')).toBe('');
    expect(after(args, '--mcp-config')).toBe('/x/mcp.json');
    expect(args).toContain('--strict-mcp-config');
    expect(after(args, '--allowedTools')).toBe(`mcp__${MCP_SERVER_NAME}`);
    expect(after(args, '--permission-mode')).toBe('dontAsk');
  });

  it('prompt は依頼の場所と回数と本文を持ち、MCP で答えるよう求める', () => {
    const prompt = after(args, '-p') ?? '';
    for (const part of [
      JOB.fileId,
      JOB.sheetId,
      JOB.nodeId,
      '2 回目',
      '要約して',
    ]) {
      expect(prompt).toContain(part);
    }
    expect(prompt).toContain('read_file');
    expect(prompt).toContain('answer_request');
    expect(prompt).toBe(promptFor(JOB));
  });

  it('operator の指示とモデルは、あるときだけ渡す', () => {
    expect(args).not.toContain('--append-system-prompt');
    expect(args).not.toContain('--model');
    const more = claudeArgs(JOB, {
      mcpConfigPath: '/x/mcp.json',
      instructions: '丁寧に答える',
      model: 'sonnet',
    });
    expect(after(more, '--append-system-prompt')).toBe('丁寧に答える');
    expect(after(more, '--model')).toBe('sonnet');
  });
});

describe('writeMcpConfig', () => {
  it('🔴 URL と token を持ち、持ち主だけが読める file に書く (既にある file も絞る)', () => {
    const path = join(dir, 'mcp.json');
    writeFileSync(path, '{}', { mode: 0o644 });
    writeMcpConfig(path, 'http://127.0.0.1:1234/mcp', 'secret');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: 'http',
          url: 'http://127.0.0.1:1234/mcp',
          headers: { Authorization: 'Bearer secret' },
        },
      },
    });
  });
});

describe('claudeRunner', () => {
  const runner = (
    fake: { mode?: string; out?: string },
    timeoutMs?: number,
    outputs: string[] = [],
  ) =>
    claudeRunner({
      command: ['bun', FAKE_CLAUDE],
      mcpConfigPath: join(dir, 'mcp.json'),
      cwd: dir,
      timeoutMs,
      env: {
        ...process.env,
        FAKE_CLAUDE_MODE: fake.mode,
        FAKE_CLAUDE_OUT: fake.out,
      },
      onOutput: (_, text) => outputs.push(text),
    });

  it('組み立てた引数で、置き場所を作業 directory にして起動し、出力を渡す', async () => {
    const out = join(dir, 'out.json');
    const outputs: string[] = [];
    await runner({ out }, undefined, outputs).run(JOB);
    const seen = JSON.parse(readFileSync(out, 'utf8'));
    expect(seen.argv).toEqual(
      claudeArgs(JOB, { mcpConfigPath: join(dir, 'mcp.json') }),
    );
    // macOS の tmpdir は /private を前に付けた実体を指す
    expect(seen.cwd.endsWith(dir.replace(/^\/private/, ''))).toBe(true);
    expect(outputs.join('')).toContain('fake claude: ok');
  });

  it('終了コードが 0 でなければ AgentRunError (理由に stderr)', async () => {
    const run = runner({ mode: 'fail' }).run(JOB);
    await expect(run).rejects.toBeInstanceOf(AgentRunError);
    await expect(run).rejects.toThrow('fake claude が失敗した');
  });

  it('🔴 時間を過ぎたら止めて AgentRunError', async () => {
    await expect(runner({ mode: 'hang' }, 300).run(JOB)).rejects.toThrow(
      '時間切れ',
    );
  });
});
