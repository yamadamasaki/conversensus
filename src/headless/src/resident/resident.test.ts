import { describe, expect, it } from 'bun:test';
import { parseResidentArgs } from './resident';

describe('parseResidentArgs', () => {
  it('--handle が要り、他は既定を持つ', () => {
    expect(() => parseResidentArgs([])).toThrow('--handle');
    const args = parseResidentArgs(['--handle', 'agent.test']);
    expect(args.handle).toBe('agent.test');
    expect(args.claude).toBe('claude');
    expect(args.timeoutMs).toBeUndefined();
  });

  it('秒は正の数だけ受け、ミリ秒にする', () => {
    const args = parseResidentArgs([
      '--handle',
      'a',
      '--timeout',
      '90',
      '--poll',
      '30',
    ]);
    expect(args.timeoutMs).toBe(90_000);
    expect(args.pollIntervalMs).toBe(30_000);
    expect(() => parseResidentArgs(['--handle', 'a', '--poll', '0'])).toThrow();
    expect(() =>
      parseResidentArgs(['--handle', 'a', '--poll', 'soon']),
    ).toThrow();
  });

  it('知らない引数・値の無い引数は断る', () => {
    expect(() => parseResidentArgs(['--handle', 'a', '--nope', 'x'])).toThrow(
      '知らない引数',
    );
    expect(() => parseResidentArgs(['--handle'])).toThrow('値が無い');
  });
});
