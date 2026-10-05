import { describe, expect, it } from 'bun:test';
import { jsonToLex } from '@atproto/api';
import type { Batch, FileId, NodeId, SheetId } from '@conversensus/shared';
import { IMAGE_PROPERTY_KEY, readImageBlobLocation } from '../images/imageBlob';
import {
  batchToRecord,
  isBatchRecordValue,
  recordToBatch,
  recordToRemoteBatch,
} from './batchMapper';
import type { BatchRecord } from './types';

const FILE = '22222222-2222-4222-8222-222222222222' as FileId;

const sampleBatch = (): Batch => ({
  id: 'batch-1' as Batch['id'],
  actor: 'did:plc:alice',
  clock: 3,
  seq: 3,
  deps: {},
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
    it('id・clock・点 (seq/deps)・timestamp・ops・actor を載せ、createdAt を timestamp から導出する', () => {
      const record = batchToRecord(
        { ...sampleBatch(), deps: { 'did:plc:bob#d': 2 } },
        FILE,
      );
      expect(record.id).toBe('batch-1');
      expect(record.actor).toBe('did:plc:alice');
      expect(record.clock).toBe(3);
      expect(record.seq).toBe(3);
      expect(record.deps).toEqual({ 'did:plc:bob#d': 2 });
      expect(record.timestamp).toBe(1_700_000_000_000);
      expect(record.ops).toHaveLength(1);
      expect(record.createdAt).toBe(new Date(1_700_000_000_000).toISOString());
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
          seq: 1,
          deps: {},
          timestamp: 1,
          ops: [],
        }),
      ).toBe(false);
    });

    it('点 (id / seq / deps) が欠けた・壊れたレコードを弾く (v2)', () => {
      const valid = {
        id: 'b',
        fileId: FILE,
        actor: 'a',
        clock: 1,
        seq: 1,
        deps: { x: 1 },
        timestamp: 1,
        ops: [],
      };
      expect(isBatchRecordValue(valid)).toBe(true);
      const { id: _id, ...noId } = valid;
      expect(isBatchRecordValue(noId)).toBe(false);
      const { seq: _seq, ...noSeq } = valid;
      expect(isBatchRecordValue(noSeq)).toBe(false);
      expect(isBatchRecordValue({ ...valid, seq: 1.5 })).toBe(false);
      // deps の項目は正の整数。0 や文字列は因果の判定を狂わせる
      expect(isBatchRecordValue({ ...valid, deps: { x: 0 } })).toBe(false);
      expect(isBatchRecordValue({ ...valid, deps: { x: '1' } })).toBe(false);
      expect(isBatchRecordValue({ ...valid, deps: [1] })).toBe(false);
    });

    it('fileId が string 以外のレコードも弾く', () => {
      expect(
        isBatchRecordValue({
          fileId: 42,
          actor: 'a',
          clock: 1,
          seq: 1,
          deps: {},
          timestamp: 1,
          ops: [],
        }),
      ).toBe(false);
    });

    it('recordToRemoteBatch が適用先 fileId と Batch の対を復元する', () => {
      const batch = sampleContentBatch();
      const record = {
        $type: 'app.conversensus.v2.batch' as const,
        ...batchToRecord(batch, FILE),
      };
      const remote = recordToRemoteBatch(record);
      expect(remote.fileId).toBe(FILE);
      expect(remote.batch).toEqual(batch);
    });
  });

  describe('recordToBatch', () => {
    it('本文の id を復元し、往復で元の Batch に一致する', () => {
      const batch = sampleBatch();
      const record = {
        $type: 'app.conversensus.v2.batch' as const,
        ...batchToRecord(batch, FILE),
      };
      const restored = recordToBatch(record);
      expect(restored).toEqual(batch);
    });

    it('content batch を往復させても sheetId が保たれる', () => {
      const batch = sampleContentBatch();
      const record = {
        $type: 'app.conversensus.v2.batch' as const,
        ...batchToRecord(batch, FILE),
      };
      const restored = recordToBatch(record);
      expect(restored).toEqual(batch);
      expect(restored.sheetId as string).toBe(
        '11111111-1111-4111-8111-111111111111',
      );
    });

    it('sheetId 無しレコード (file 構造 batch) は sheetId undefined で復元する', () => {
      const record = {
        $type: 'app.conversensus.v2.batch' as const,
        id: 'batch-1',
        fileId: FILE,
        actor: 'did:plc:alice',
        clock: 3,
        seq: 3,
        deps: {},
        timestamp: 1_700_000_000_000,
        ops: [],
        createdAt: new Date(1_700_000_000_000).toISOString(),
      };
      const restored = recordToBatch(record);
      expect('sheetId' in restored).toBe(false);
      expect(restored.sheetId).toBeUndefined();
    });
  });

  describe('merge の写しの印 (step3 Phase 1 D2)', () => {
    const copied = (): Batch => ({
      ...sampleContentBatch(),
      copyOf: { actor: 'did:plc:carol#dev-c', seq: 4 },
      mergedIn: '33333333-3333-4333-8333-333333333333' as Batch['mergedIn'],
    });

    it('copyOf / mergedIn を往復させる', () => {
      const record = batchToRecord(copied(), FILE);
      expect(record.copyOf).toEqual({ actor: 'did:plc:carol#dev-c', seq: 4 });
      expect(
        recordToBatch({
          $type: 'app.conversensus.v2.batch',
          ...record,
        }),
      ).toEqual(copied());
    });

    it('写しでない batch は record にも Batch にも印を付けない', () => {
      const record = batchToRecord(sampleBatch(), FILE);
      expect('copyOf' in record).toBe(false);
      expect('mergedIn' in record).toBe(false);
    });

    it('印の形が違うレコードは弾く', () => {
      const base = batchToRecord(sampleBatch(), FILE);
      expect(isBatchRecordValue({ ...base, copyOf: 'did:plc:x#d' })).toBe(
        false,
      );
      expect(
        isBatchRecordValue({ ...base, copyOf: { actor: 'a', seq: 0 } }),
      ).toBe(false);
      expect(isBatchRecordValue({ ...base, mergedIn: {} })).toBe(false);
    });
  });

  describe('isBatchRecordValue', () => {
    it('BatchRecord 構造を満たす値を受理する', () => {
      const record = {
        $type: 'app.conversensus.v2.batch',
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
          seq: 1,
          deps: {},
          timestamp: 1,
          ops: [],
        }),
      ).toBe(false);
      expect(
        isBatchRecordValue({
          fileId: FILE,
          actor: 'a',
          clock: Number.NaN,
          seq: Number.NaN,
          deps: {},
          timestamp: 1,
          ops: [],
        }),
      ).toBe(false);
      expect(
        isBatchRecordValue({
          fileId: FILE,
          actor: 'a',
          clock: 1,
          seq: 1,
          deps: {},
          timestamp: 1,
          ops: 'no',
        }),
      ).toBe(false);
    });

    it('sheetId 無しレコード (file 構造 batch) を通す', () => {
      expect(
        isBatchRecordValue({
          id: 'b',
          fileId: FILE,
          actor: 'a',
          clock: 1,
          seq: 1,
          deps: {},
          timestamp: 1,
          ops: [],
        }),
      ).toBe(true);
    });

    it('sheetId が string のレコードを通す', () => {
      expect(
        isBatchRecordValue({
          id: 'b',
          fileId: FILE,
          actor: 'a',
          clock: 1,
          seq: 1,
          deps: {},
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
          seq: 1,
          deps: {},
          timestamp: 1,
          ops: [],
          sheetId: 42,
        }),
      ).toBe(false);
    });
  });
});

describe('PDS から入る blob (step3 FPR の確認で発覚)', () => {
  const CID = 'bafkreihsx3nvipuczytg5qamiaibgbthipoujvli7jmog7ebi4agglpn7a';
  const NODE = '33333333-3333-4333-8333-333333333333';
  /** PDS が返す JSON の形のレコード (画像 node を 1 つ足す) */
  const json = {
    id: '22222222-2222-4222-8222-222222222222',
    fileId: '11111111-1111-4111-8111-111111111111',
    actor: 'did:plc:alice#dev',
    clock: 3,
    seq: 3,
    deps: {},
    timestamp: 3,
    createdAt: '2026-10-05T00:00:00.000Z',
    ops: [
      {
        kind: 'node.add',
        target: NODE,
        content: '',
        nodeType: 'image',
        properties: {
          [IMAGE_PROPERTY_KEY]: {
            $type: 'blob',
            ref: { $link: CID },
            mimeType: 'image/png',
            size: 10,
          },
        },
      },
    ],
  };

  it('@atproto/api が BlobRef に変えたレコードでも、Worker へ渡した後に画像の参照が読める', () => {
    // `agent.com.atproto.repo.listRecords` が返すのと同じ変換 (blob → BlobRef のインスタンス)
    const fromAgent = jsonToLex(json) as BatchRecord;
    // Worker への postMessage は structured clone で、`toJSON` を通らない
    const crossed = structuredClone(recordToBatch(fromAgent));
    const [op] = crossed.ops as { properties?: Record<string, unknown> }[];
    expect(readImageBlobLocation(op?.properties)).toEqual({
      cid: CID,
      mimeType: 'image/png',
    });
  });
});
