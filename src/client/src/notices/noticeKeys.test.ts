import { describe, expect, test } from 'bun:test';
import {
  type BatchId,
  conflictKeyOf,
  type Did,
  type MergeConflict,
} from '@conversensus/shared';
import fc from 'fast-check';
import type { OverwriteReport } from '../sync/overwrites';
import { conflictNoticeKeyOf, overwriteNoticeKeyOf } from './noticeKeys';

const B = (n: number) =>
  `${String(n).repeat(8)}-1111-4111-8111-111111111111` as BatchId;

const report = (over: Partial<OverwriteReport> = {}): OverwriteReport => ({
  target: 'node-1',
  category: 'content',
  by: 'did:plc:bob' as Did,
  mine: B(1),
  theirs: B(2),
  ...over,
});

describe('overwriteNoticeKeyOf', () => {
  test('同じ上書きなら同じ鍵、batch のどちらかが違えば別の鍵 (将来の上書きを既読にしない)', () => {
    const arbBatch = fc.constantFrom(B(1), B(2), B(3));
    fc.assert(
      fc.property(arbBatch, arbBatch, arbBatch, arbBatch, (m1, t1, m2, t2) => {
        const a = overwriteNoticeKeyOf(report({ mine: m1, theirs: t1 }));
        const b = overwriteNoticeKeyOf(report({ mine: m2, theirs: t2 }));
        expect(a === b).toBe(m1 === m2 && t1 === t2);
      }),
    );
  });

  test('同じ batch の組でも、対象や単位が違えば別の鍵', () => {
    const base = overwriteNoticeKeyOf(report());
    expect(overwriteNoticeKeyOf(report({ target: 'node-2' }))).not.toBe(base);
    expect(
      overwriteNoticeKeyOf(report({ category: 'layout', aspect: 'position' })),
    ).not.toBe(base);
  });
});

describe('conflictNoticeKeyOf', () => {
  test('fork の同一性 (conflictKeyOf) と同じ値 — 競合を閉じた人に同じ競合の fork を出さない', () => {
    const conflict = {
      category: 'content',
      target: 'node-1',
      ours: { batchId: B(1) },
      theirs: { batchId: B(2) },
    } as unknown as MergeConflict;
    expect(conflictNoticeKeyOf(conflict)).toBe(conflictKeyOf(conflict));
  });
});
