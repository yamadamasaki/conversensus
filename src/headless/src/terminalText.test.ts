import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import { forTerminal } from './terminalText';

/** 落とすべき制御文字か (改行・タブ以外の C0、DEL、C1) */
const isControl = (c: string) => {
  const code = c.codePointAt(0) ?? 0;
  return (
    (code <= 0x1f && c !== '\n' && c !== '\t') || (code >= 0x7f && code <= 0x9f)
  );
};

describe('forTerminal (#391)', () => {
  it('🔴 端末の命令 (ESC で始まる) の ESC を落とし、改行とタブは残す', () => {
    expect(forTerminal('a\u001b]0;title\u0007b\n\tc\u001b[2Jd')).toBe(
      'a]0;titleb\n\tc[2Jd',
    );
  });

  it('C1 の制御文字 (CSI 0x9b など) と DEL も落とす', () => {
    expect(forTerminal('x\u009b2Jy\u007fz')).toBe('x2Jyz');
  });

  it('性質: 出力に落とすべき制御文字は無く、それ以外の文字は順に残る', () => {
    // 制御文字を多めに混ぜる (広い生成器では当たらない)
    const char = fc.oneof(
      fc.constantFrom('\u001b', '\u0007', '\u009b', '\u007f', '\n', '\t', '\r'),
      fc.constantFrom('a', 'あ', '[', ']', ';', '😀'),
    );
    fc.assert(
      fc.property(fc.array(char), (chars) => {
        const out = forTerminal(chars.join(''));
        expect([...out].some(isControl)).toBe(false);
        expect(out).toBe(chars.filter((c) => !isControl(c)).join(''));
      }),
    );
  });
});
