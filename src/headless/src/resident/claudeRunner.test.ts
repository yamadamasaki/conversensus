import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileId } from '@conversensus/shared';
import type { McpScope } from '../mcpServer';
import type { AgentTask, McpGrants } from './claudeRunner';
import {
  AgentRunError,
  agentEnv,
  claudeArgs,
  claudeRunner,
  DEFAULT_MAX_TURNS,
  MCP_SERVER_NAME,
  writeMcpConfig,
} from './claudeRunner';

const FILE = '00000000-0000-4000-8000-0000000000f1' as FileId;
/** 頼む仕事 (prompt と範囲は module が決める。依頼の prompt は依頼の module の試験が見る) */
const TASK: AgentTask = {
  label: '依頼 x',
  prompt: 'この依頼に答えて',
  scope: { files: [FILE], tools: ['read_file', 'answer_request'] },
};
const FAKE_CLAUDE = join(import.meta.dir, '..', 'testing', 'fakeClaude.ts');
const MCP_URL = 'http://127.0.0.1:1234/mcp';

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
  const args = claudeArgs({ mcpConfigPath: '/x/mcp.json' });

  it('🔴 使わせる道具を conversensus の MCP だけに絞る (完了基準 4)', () => {
    expect(after(args, '--tools')).toBe('');
    expect(after(args, '--mcp-config')).toBe('/x/mcp.json');
    expect(args).toContain('--strict-mcp-config');
    expect(after(args, '--allowedTools')).toBe(`mcp__${MCP_SERVER_NAME}`);
    expect(after(args, '--permission-mode')).toBe('dontAsk');
  });

  it('🔴 operator の設定 (hooks・plugin・CLAUDE.md) を読まない (#390)', () => {
    expect(after(args, '--setting-sources')).toBe('');
  });

  it('🔴 prompt は引数に載せない (stdin で渡す、#390)', () => {
    // -p の直後は別の引数で、prompt ではない
    expect(after(args, '-p')).toBe('--tools');
    expect(args).not.toContain(TASK.prompt);
  });

  it('turn の上限は常に渡し、費用の上限はあるときだけ (#387)', () => {
    expect(after(args, '--max-turns')).toBe(String(DEFAULT_MAX_TURNS));
    expect(args).not.toContain('--max-budget-usd');
    const capped = claudeArgs({
      mcpConfigPath: '/x/mcp.json',
      maxTurns: 5,
      maxBudgetUsd: 0.5,
    });
    expect(after(capped, '--max-turns')).toBe('5');
    expect(after(capped, '--max-budget-usd')).toBe('0.5');
  });

  it('operator の指示 (file) とモデルは、あるときだけ渡す', () => {
    expect(args).not.toContain('--append-system-prompt-file');
    expect(args).not.toContain('--model');
    const more = claudeArgs({
      mcpConfigPath: '/x/mcp.json',
      instructionsPath: '/x/instructions.md',
      model: 'sonnet',
    });
    expect(after(more, '--append-system-prompt-file')).toBe(
      '/x/instructions.md',
    );
    expect(after(more, '--model')).toBe('sonnet');
  });
});

describe('agentEnv (#390)', () => {
  it('🔴 決めたものと前置きの合うものだけを渡す (app password は渡さない)', () => {
    expect(
      agentEnv({
        HOME: '/home/a',
        PATH: '/bin',
        ANTHROPIC_API_KEY: 'k',
        CLAUDE_CONFIG_DIR: '/c',
        CONVERSENSUS_APP_PASSWORD: 'secret',
        GITHUB_TOKEN: 'gh',
        UNSET: undefined,
      }),
    ).toEqual({
      HOME: '/home/a',
      PATH: '/bin',
      ANTHROPIC_API_KEY: 'k',
      CLAUDE_CONFIG_DIR: '/c',
    });
  });
});

describe('writeMcpConfig', () => {
  it('🔴 URL と token を持ち、持ち主だけが読める file に書く (既にある file も絞る)', () => {
    const path = join(dir, 'mcp.json');
    writeFileSync(path, '{}', { mode: 0o644 });
    writeMcpConfig(path, MCP_URL, 'secret');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: 'http',
          url: MCP_URL,
          headers: { Authorization: 'Bearer secret' },
        },
      },
    });
  });
});

describe('claudeRunner', () => {
  /** 出した token と範囲、取り消した token を控える偽の MCP の口 */
  function fakeMcp() {
    const granted: { token: string; scope: McpScope }[] = [];
    const revoked: string[] = [];
    const mcp: McpGrants = {
      url: MCP_URL,
      grant: (scope) => {
        const token = `token-${granted.length + 1}`;
        granted.push({ token, scope });
        return { token, revoke: () => revoked.push(token) };
      },
    };
    return { mcp, granted, revoked };
  }

  const configDir = () => join(dir, 'config');

  const runner = (
    mcp: McpGrants,
    fake: { mode?: string; out?: string },
    timeoutMs?: number,
    outputs: string[] = [],
  ) => {
    const config = configDir();
    mkdirSync(config, { recursive: true });
    return claudeRunner({
      command: [
        'bun',
        FAKE_CLAUDE,
        ...(fake.mode ? [`--fake-mode=${fake.mode}`] : []),
        ...(fake.out ? [`--fake-out=${fake.out}`] : []),
      ],
      mcp,
      configDir: config,
      cwd: dir,
      timeoutMs,
      env: { ...process.env, CONVERSENSUS_APP_PASSWORD: 'secret' },
      onOutput: (_, text) => outputs.push(text),
    });
  };

  it('組み立てた引数で、置き場所を作業 directory にして起動し、prompt を stdin で渡し、出力を渡す', async () => {
    const { mcp } = fakeMcp();
    const out = join(dir, 'out.json');
    const outputs: string[] = [];
    await runner(mcp, { out }, undefined, outputs).run(TASK);
    const seen = JSON.parse(readFileSync(out, 'utf8'));
    const configPath = after(seen.argv, '--mcp-config') as string;
    expect(seen.argv).toEqual(claudeArgs({ mcpConfigPath: configPath }));
    expect(seen.stdin).toBe(TASK.prompt);
    // macOS の tmpdir は /private を前に付けた実体を指す
    expect(seen.cwd.endsWith(dir.replace(/^\/private/, ''))).toBe(true);
    expect(outputs.join('')).toContain('fake claude: ok');
  });

  it('🔴 起動ごとに範囲つきの token を出して渡し、終われば取り消して設定の file も消す (#386)', async () => {
    const { mcp, granted, revoked } = fakeMcp();
    const out = join(dir, 'out.json');
    await runner(mcp, { out }).run(TASK);
    expect(granted).toHaveLength(1);
    expect([...(granted[0]?.scope.files ?? [])]).toEqual([FILE]);
    expect([...(granted[0]?.scope.tools ?? [])]).toEqual([...TASK.scope.tools]);
    // 起動されたものが見た設定は、その起動の token を持つ
    const seen = JSON.parse(readFileSync(out, 'utf8'));
    expect(
      seen.mcpConfig.mcpServers[MCP_SERVER_NAME].headers.Authorization,
    ).toBe('Bearer token-1');
    expect(revoked).toEqual(['token-1']);
    expect(readdirSync(configDir())).toEqual([]);
  });

  it('🔴 失敗しても token を取り消し、設定の file を消す', async () => {
    const { mcp, revoked } = fakeMcp();
    await expect(runner(mcp, { mode: 'fail' }).run(TASK)).rejects.toThrow();
    expect(revoked).toEqual(['token-1']);
    expect(readdirSync(configDir())).toEqual([]);
  });

  it('🔴 app password を含む常駐の環境を渡さない (#390)', async () => {
    const { mcp } = fakeMcp();
    const out = join(dir, 'out.json');
    await runner(mcp, { out }).run(TASK);
    const seen = JSON.parse(readFileSync(out, 'utf8'));
    expect(seen.envNames).not.toContain('CONVERSENSUS_APP_PASSWORD');
    expect(seen.envNames).toContain('PATH');
  });

  it('終了コードが 0 でなければ AgentRunError (理由に stderr)', async () => {
    const { mcp } = fakeMcp();
    const run = runner(mcp, { mode: 'fail' }).run(TASK);
    await expect(run).rejects.toBeInstanceOf(AgentRunError);
    await expect(run).rejects.toThrow('fake claude が失敗した');
  });

  it('🔴 時間を過ぎたら止めて AgentRunError', async () => {
    const { mcp } = fakeMcp();
    await expect(runner(mcp, { mode: 'hang' }, 300).run(TASK)).rejects.toThrow(
      '時間切れ',
    );
  });
});
