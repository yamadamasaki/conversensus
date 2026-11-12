import { describe, expect, it } from 'bun:test';
import { parseResidentArgs } from './resident';

/** 常駐は --pds が要る (#391) */
const PDS = ['--pds', 'https://pds.example'];

describe('parseResidentArgs', () => {
  it('--handle が要り、他は既定を持つ', () => {
    expect(() => parseResidentArgs([])).toThrow('--handle');
    const args = parseResidentArgs(['--handle', 'agent.test', ...PDS]);
    expect(args.handle).toBe('agent.test');
    expect(args.claude).toBe('claude');
    expect(args.timeoutMs).toBeUndefined();
  });

  it('秒は正の数だけ受け、ミリ秒にする', () => {
    const args = parseResidentArgs([
      '--handle',
      'a',
      ...PDS,
      '--timeout',
      '90',
      '--poll',
      '30',
    ]);
    expect(args.timeoutMs).toBe(90_000);
    expect(args.pollIntervalMs).toBe(30_000);
    expect(() =>
      parseResidentArgs(['--handle', 'a', ...PDS, '--poll', '0']),
    ).toThrow();
    expect(() =>
      parseResidentArgs(['--handle', 'a', ...PDS, '--poll', 'soon']),
    ).toThrow();
  });

  it('使いすぎない上限 (#387): turn は正の整数、費用は正の数', () => {
    const args = parseResidentArgs([
      '--handle',
      'a',
      ...PDS,
      '--max-turns',
      '10',
      '--max-budget',
      '0.5',
    ]);
    expect(args.maxTurns).toBe(10);
    expect(args.maxBudgetUsd).toBe(0.5);
    expect(() =>
      parseResidentArgs(['--handle', 'a', ...PDS, '--max-turns', '1.5']),
    ).toThrow('整数');
    expect(() =>
      parseResidentArgs(['--handle', 'a', ...PDS, '--max-budget', '0']),
    ).toThrow();
  });

  it('--answer-agents は値を取らない。既定は答えない (#387)', () => {
    expect(parseResidentArgs(['--handle', 'a', ...PDS]).answerAgents).toBe(
      false,
    );
    const args = parseResidentArgs([
      '--answer-agents',
      '--handle',
      'a',
      ...PDS,
      '--poll',
      '30',
    ]);
    expect(args.answerAgents).toBe(true);
    expect(args.handle).toBe('a');
    expect(args.pollIntervalMs).toBe(30_000);
  });

  it('🔴 --pds が要り、https だけを受ける。http は --allow-insecure-pds のときだけ (#391)', () => {
    expect(() => parseResidentArgs(['--handle', 'a'])).toThrow('--pds');
    expect(parseResidentArgs(['--handle', 'a', ...PDS]).pdsUrl).toBe(
      'https://pds.example',
    );
    const dev = ['--pds', 'http://localhost:3000'];
    expect(() => parseResidentArgs(['--handle', 'a', ...dev])).toThrow(
      '--allow-insecure-pds',
    );
    expect(
      parseResidentArgs(['--handle', 'a', ...dev, '--allow-insecure-pds'])
        .pdsUrl,
    ).toBe('http://localhost:3000');
    expect(() =>
      parseResidentArgs(['--handle', 'a', '--pds', 'file:///etc/passwd']),
    ).toThrow();
    expect(() =>
      parseResidentArgs(['--handle', 'a', '--pds', 'not a url']),
    ).toThrow('URL');
  });

  it('知らない引数・値の無い引数は断る', () => {
    expect(() =>
      parseResidentArgs(['--handle', 'a', ...PDS, '--nope', 'x']),
    ).toThrow('知らない引数');
    expect(() => parseResidentArgs(['--handle'])).toThrow('値が無い');
  });
});
