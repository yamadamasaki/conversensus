import { describe, expect, test } from 'bun:test';
import type { NodeId, Op } from '@conversensus/shared';
import { DETAIL_MAX_LENGTH, opDetail, opKindLabel } from './describeOp';

const N = 'n1' as NodeId;

describe('describeOp (#73 change inspector)', () => {
  test('種類は日本語の短い名前。知らない種類はそのまま', () => {
    expect(opKindLabel({ kind: 'node.add', target: N, content: 'x' })).toBe(
      'node を追加',
    );
    expect(opKindLabel({ kind: 'sheet.remove', target: 's' } as Op)).toBe(
      'sheet.remove',
    );
  });

  test('内容: 本文・種別名・property の名前。運ばない op は空', () => {
    expect(
      opDetail({ kind: 'node.setContent', target: N, content: '議事' }),
    ).toBe('議事');
    expect(opDetail({ kind: 'node.setLabel', target: N, label: '主張' })).toBe(
      '主張',
    );
    expect(
      opDetail({
        kind: 'node.setProperty',
        target: N,
        name: 'owner',
        value: 1,
      }),
    ).toBe('owner');
    expect(opDetail({ kind: 'node.remove', target: N })).toBe('');
  });

  test('長い本文は上限で切って … を付ける', () => {
    const long = 'あ'.repeat(DETAIL_MAX_LENGTH + 5);
    expect(opDetail({ kind: 'node.add', target: N, content: long })).toBe(
      `${'あ'.repeat(DETAIL_MAX_LENGTH)}…`,
    );
  });
});
