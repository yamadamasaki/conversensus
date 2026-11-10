import { describe, expect, it } from 'bun:test';
import type { FileId } from '@conversensus/shared';
import { describeDeclaration, parseArgs } from './cli';

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

describe('cli: profile (agent の宣言、設計 D2)', () => {
  it('operator と、任意の model・説明を読む。operator を省けば今の宣言を出すだけ', () => {
    expect(
      parseArgs([
        'profile',
        'alice.test',
        '--model',
        'claude',
        '--description',
        '要約する',
      ]).command,
    ).toEqual({
      kind: 'profile',
      operator: 'alice.test',
      model: 'claude',
      description: '要約する',
    });
    expect(parseArgs(['profile']).command).toEqual({ kind: 'profile' });
  });

  it('operator 無しの --model・profile 以外の --model・引数の多すぎは断る', () => {
    expect(() => parseArgs(['profile', '--model', 'x'])).toThrow('operator');
    expect(() => parseArgs(['whoami', '--model', 'x'])).toThrow('profile');
    expect(() => parseArgs(['profile', 'a', 'b'])).toThrow();
    expect(() => parseArgs(['profile', 'a', '--model'])).toThrow('値が無い');
  });

  it('宣言の状態を人に読める形で出す', () => {
    expect(describeDeclaration({ status: 'none' })).toBe('agent の宣言: なし');
    expect(
      describeDeclaration({
        status: 'claimed',
        operator: 'did:plc:alice',
        model: 'claude',
      }),
    ).toBe(
      'agent の宣言: 名乗りのみ (operator がまだ App で認めていない)\n  operator did:plc:alice\n  model claude',
    );
    expect(
      describeDeclaration({ status: 'verified', operator: 'did:plc:alice' }),
    ).toContain('裏付けあり');
  });
});
