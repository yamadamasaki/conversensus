import { describe, expect, it } from 'bun:test';
import type { Batch, FileId, NodeId, SheetId } from '@conversensus/shared';
import {
  batchToRecord,
  isBatchRecordValue,
  recordToBatch,
  recordToRemoteBatch,
} from './batchMapper';

const FILE = '22222222-2222-4222-8222-222222222222' as FileId;

const sampleBatch = (): Batch => ({
  id: 'batch-1' as Batch['id'],
  actor: 'did:plc:alice',
  clock: 3,
  timestamp: 1_700_000_000_000,
  ops: [{ kind: 'node.add', target: 'n1' as NodeId, content: 'ノード1' }],
});

/** content batch: 発生元シートの sheetId を持つ (W3d5-1) */
const sampleContentBatch = (): Batch => ({
  ...sampleBatch(),
  sheetId: '11111111-1111-4111-8111-111111111111' as SheetId,
});

describe('batchMapper', () => {
  describe('batchToRecord', () => {
    it('id を除いた clock/timestamp/ops/actor を載せ、createdAt を timestamp から導出する', () => {
      const record = batchToRecord(sampleBatch(), FILE);
      expect(record.actor).toBe('did:plc:alice');
      expect(record.clock).toBe(3);
      expect(record.timestamp).toBe(1_700_000_000_000);
      expect(record.ops).toHaveLength(1);
      expect(record.createdAt).toBe(new Date(1_700_000_000_000).toISOString());
      expect('id' in record).toBe(false);
    });

    it('sheetId 無しの batch は record に sheetId フィールドを付けない', () => {
      const record = batchToRecord(sampleBatch(), FILE);
      expect('sheetId' in record).toBe(false);
    });

    it('content batch の sheetId を record に載せる', () => {
      const record = batchToRecord(sampleContentBatch(), FILE);
      expect(record.sheetId).toBe('11111111-1111-4111-8111-111111111111');
    });

    it('外から渡した fileId を record に載せる (Batch 自身は持たない)', () => {
      const batch = sampleBatch();
      expect('fileId' in batch).toBe(false);
      expect(batchToRecord(batch, FILE).fileId).toBe(FILE);
    });
  });

  describe('fileId (Phase 4d-1)', () => {
    it('fileId 無しレコード (W3d5 以前) は isBatchRecordValue が弾く', () => {
      // 受信側は適用先を復元できないので取り込まない。
      // 弾いた件数は呼び出し側 (pull) が数えて警告に出す (counted skip)
      expect(
        isBatchRecordValue({
          actor: 'a',
          clock: 1,
          timestamp: 1,
          ops: [],
        }),
      ).toBe(false);
    });

    it('fileId が string 以外のレコードも弾く', () => {
      expect(
        isBatchRecordValue({
          fileId: 42,
          actor: 'a',
          clock: 1,
          timestamp: 1,
          ops: [],
        }),
      ).toBe(false);
    });

    it('recordToRemoteBatch が適用先 fileId と Batch の対を復元する', () => {
      const batch = sampleContentBatch();
      const record = {
        $type: 'app.conversensus.graph.batch' as const,
        ...batchToRecord(batch, FILE),
      };
      const remote = recordToRemoteBatch(batch.id, record);
      expect(remote.fileId).toBe(FILE);
      expect(remote.batch).toEqual(batch);
    });
  });

  describe('recordToBatch', () => {
    it('rkey を id として復元し、往復で元の Batch に一致する', () => {
      const batch = sampleBatch();
      const record = {
        $type: 'app.conversensus.graph.batch' as const,
        ...batchToRecord(batch, FILE),
      };
      const restored = recordToBatch(batch.id, record);
      expect(restored).toEqual(batch);
    });

    it('content batch を往復させても sheetId が保たれる', () => {
      const batch = sampleContentBatch();
      const record = {
        $type: 'app.conversensus.graph.batch' as const,
        ...batchToRecord(batch, FILE),
      };
      const restored = recordToBatch(batch.id, record);
      expect(restored).toEqual(batch);
      expect(restored.sheetId).toBe('11111111-1111-4111-8111-111111111111');
    });

    it('旧データ (sheetId 無しレコード) は sheetId undefined で復元する', () => {
      const record = {
        $type: 'app.conversensus.graph.batch' as const,
        fileId: FILE,
        actor: 'did:plc:alice',
        clock: 3,
        timestamp: 1_700_000_000_000,
        ops: [],
        createdAt: new Date(1_700_000_000_000).toISOString(),
      };
      const restored = recordToBatch('batch-1', record);
      expect('sheetId' in restored).toBe(false);
      expect(restored.sheetId).toBeUndefined();
    });
  });

  describe('isBatchRecordValue', () => {
    it('BatchRecord 構造を満たす値を受理する', () => {
      const record = {
        $type: 'app.conversensus.graph.batch',
        ...batchToRecord(sampleBatch(), FILE),
      };
      expect(isBatchRecordValue(record)).toBe(true);
    });

    it('null / 非オブジェクト / 型不一致を拒否する', () => {
      expect(isBatchRecordValue(null)).toBe(false);
      expect(isBatchRecordValue('x')).toBe(false);
      expect(
        isBatchRecordValue({
          fileId: FILE,
          actor: 1,
          clock: 1,
          timestamp: 1,
          ops: [],
        }),
      ).toBe(false);
      expect(
        isBatchRecordValue({
          fileId: FILE,
          actor: 'a',
          clock: Number.NaN,
          timestamp: 1,
          ops: [],
        }),
      ).toBe(false);
      expect(
        isBatchRecordValue({
          fileId: FILE,
          actor: 'a',
          clock: 1,
          timestamp: 1,
          ops: 'no',
        }),
      ).toBe(false);
    });

    it('sheetId 無しレコード (file 構造 batch) を通す', () => {
      expect(
        isBatchRecordValue({
          fileId: FILE,
          actor: 'a',
          clock: 1,
          timestamp: 1,
          ops: [],
        }),
      ).toBe(true);
    });

    it('sheetId が string のレコードを通す', () => {
      expect(
        isBatchRecordValue({
          fileId: FILE,
          actor: 'a',
          clock: 1,
          timestamp: 1,
          ops: [],
          sheetId: '11111111-1111-4111-8111-111111111111',
        }),
      ).toBe(true);
    });

    it('sheetId が string 以外のレコードは弾く', () => {
      expect(
        isBatchRecordValue({
          fileId: FILE,
          actor: 'a',
          clock: 1,
          timestamp: 1,
          ops: [],
          sheetId: 42,
        }),
      ).toBe(false);
    });
  });
});
