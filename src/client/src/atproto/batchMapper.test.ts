import { describe, expect, it } from 'bun:test';
import type { Batch, NodeId } from '@conversensus/shared';
import {
  batchToRecord,
  isBatchRecordValue,
  recordToBatch,
} from './batchMapper';

const sampleBatch = (): Batch => ({
  id: 'batch-1' as Batch['id'],
  actor: 'did:plc:alice',
  clock: 3,
  timestamp: 1_700_000_000_000,
  ops: [{ kind: 'node.add', target: 'n1' as NodeId, content: 'ノード1' }],
});

describe('batchMapper', () => {
  describe('batchToRecord', () => {
    it('id を除いた clock/timestamp/ops/actor を載せ、createdAt を timestamp から導出する', () => {
      const record = batchToRecord(sampleBatch());
      expect(record.actor).toBe('did:plc:alice');
      expect(record.clock).toBe(3);
      expect(record.timestamp).toBe(1_700_000_000_000);
      expect(record.ops).toHaveLength(1);
      expect(record.createdAt).toBe(new Date(1_700_000_000_000).toISOString());
      expect('id' in record).toBe(false);
    });
  });

  describe('recordToBatch', () => {
    it('rkey を id として復元し、往復で元の Batch に一致する', () => {
      const batch = sampleBatch();
      const record = {
        $type: 'app.conversensus.graph.batch' as const,
        ...batchToRecord(batch),
      };
      const restored = recordToBatch(batch.id, record);
      expect(restored).toEqual(batch);
    });
  });

  describe('isBatchRecordValue', () => {
    it('BatchRecord 構造を満たす値を受理する', () => {
      const record = {
        $type: 'app.conversensus.graph.batch',
        ...batchToRecord(sampleBatch()),
      };
      expect(isBatchRecordValue(record)).toBe(true);
    });

    it('null / 非オブジェクト / 型不一致を拒否する', () => {
      expect(isBatchRecordValue(null)).toBe(false);
      expect(isBatchRecordValue('x')).toBe(false);
      expect(
        isBatchRecordValue({ actor: 1, clock: 1, timestamp: 1, ops: [] }),
      ).toBe(false);
      expect(
        isBatchRecordValue({
          actor: 'a',
          clock: Number.NaN,
          timestamp: 1,
          ops: [],
        }),
      ).toBe(false);
      expect(
        isBatchRecordValue({ actor: 'a', clock: 1, timestamp: 1, ops: 'no' }),
      ).toBe(false);
    });
  });
});
