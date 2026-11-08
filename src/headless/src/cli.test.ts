import { describe, expect, it } from 'bun:test';
import type { FileId } from '@conversensus/shared';
import { parseArgs } from './cli';

const FILE = '6f259ad5-4db5-4c61-99d5-4a0b72f0b6c4' as FileId;

describe('cli: parseArgs (H5)', () => {
  it('コマンドと引数を読む', () => {
    expect(parseArgs(['login', 'agent.test']).command).toEqual({
      kind: 'login',
      handle: 'agent.test',
    });
    expect(parseArgs(['add', FILE, '本文 です']).command).toEqual({
      kind: 'add',
      fileId: FILE,
      content: '本文 です',
    });
    expect(parseArgs(['files']).command).toEqual({ kind: 'files' });
  });

  it('選択肢はコマンドの前後どちらにあってもよい', () => {
    const parsed = parseArgs([
      'show',
      '--data',
      '/tmp/a',
      FILE,
      '--no-open',
      '--pds',
      'http://p',
    ]);
    expect(parsed).toEqual({
      command: { kind: 'show', fileId: FILE },
      dataDir: '/tmp/a',
      pdsUrl: 'http://p',
      open: false,
    });
  });

  it('既定は開発用の PDS で、同意のページを開く', () => {
    const parsed = parseArgs(['whoami']);
    expect(parsed.pdsUrl).toBe('http://localhost:3000');
    expect(parsed.open).toBe(true);
    expect(parsed.dataDir.endsWith('/.conversensus/agent')).toBe(true);
  });

  it('引数の数が違う・知らないコマンド・値の無い選択肢は読まない', () => {
    expect(() => parseArgs(['login'])).toThrow();
    expect(() => parseArgs(['files', 'extra'])).toThrow();
    expect(() => parseArgs(['fly'])).toThrow();
    expect(() => parseArgs([])).toThrow();
    expect(() => parseArgs(['files', '--data'])).toThrow();
    expect(() => parseArgs(['show', 'not-a-uuid'])).toThrow();
  });
});
