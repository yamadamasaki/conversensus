import { describe, expect, test } from 'bun:test';
import type { BatchId, FileId, JudgmentBatch } from '@conversensus/shared';
import {
  isJudgmentRecordValue,
  judgmentToRecord,
  recordToJudgmentBatch,
  recordToRemoteJudgment,
} from './judgmentMapper';
import type { JudgmentRecord } from './types';

const FILE = '11111111-1111-4111-8111-111111111111' as FileId;
const BID = '22222222-2222-4222-8222-222222222222' as BatchId;

const batch: JudgmentBatch = {
  id: BID,
  actor: 'did:plc:alice#dev-1',
  clock: 7,
  timestamp: 1_700_000_000_000,
  ops: [
    { kind: 'participation.genesis' },
    { kind: 'participation.invite', target: 'did:plc:bob' },
  ],
};

const record = (over: Partial<JudgmentRecord> = {}): JudgmentRecord =>
  ({
    $type: 'app.conversensus.graph.judgment',
    ...judgmentToRecord(batch, FILE),
    ...over,
  }) as JudgmentRecord;

describe('judgmentToRecord', () => {
  test('id を載せない — rkey が持つ', () => {
    expect('id' in judgmentToRecord(batch, FILE)).toBe(false);
  });

  test('fileId を載せる — collection は repo 全体で 1 つなので文脈が無い', () => {
    expect(judgmentToRecord(batch, FILE).fileId).toBe(FILE);
  });

  test('sheetId は載せない — 判断は File 単位である', () => {
    expect('sheetId' in judgmentToRecord(batch, FILE)).toBe(false);
  });
});

describe('往復', () => {
  test('レコードへ落として戻すと元の batch になる', () => {
    expect(recordToJudgmentBatch(BID, record())).toEqual(batch);
  });

  test('適用先は rkey ではなくボディの fileId から復元する', () => {
    // rkey にも fileId が入るが、そちらは取得経路の索引であって
    // 復元元にしない (二重の真実を作らない)
    expect(recordToRemoteJudgment(BID, record())?.fileId).toBe(FILE);
  });
});

describe('形の検証 (isJudgmentRecordValue)', () => {
  test('必須フィールドを欠くレコードを弾く', () => {
    expect(isJudgmentRecordValue({ ...record(), fileId: undefined })).toBe(
      false,
    );
    expect(isJudgmentRecordValue({ ...record(), actor: 123 })).toBe(false);
    expect(isJudgmentRecordValue({ ...record(), ops: 'not-an-array' })).toBe(
      false,
    );
    expect(isJudgmentRecordValue(null)).toBe(false);
  });

  test('clock が数でなければ弾く (NaN も含む)', () => {
    expect(isJudgmentRecordValue({ ...record(), clock: Number.NaN })).toBe(
      false,
    );
  });

  test('形が揃っていれば通す。op の中身までは見ない', () => {
    expect(isJudgmentRecordValue(record({ ops: [{ kind: 'なにか' }] }))).toBe(
      true,
    );
  });
});

describe('op の検証 — ここが batchMapper と違う点である', () => {
  test('語彙に無い op があれば batch ごと落とす', () => {
    // 判断ログの畳み込みは op の種別で pre 条件を分岐するので、知らない op が
    // 混ざると switch が黙って素通りする。捨てられもせず効きもしない第 3 の状態が
    // 生まれ、`rejected` に載らないので UI にも出ない
    expect(
      recordToJudgmentBatch(
        BID,
        record({ ops: [{ kind: 'participation.unknown' }] }),
      ),
    ).toBeNull();
  });

  test('一部だけ通さない — 判断は複数 op の原子性を前提にしている', () => {
    // 「招待して同時に別の誰かを取り消す」のような batch を割ると、
    // 書いた側の意図と違う名簿になる
    expect(
      recordToJudgmentBatch(
        BID,
        record({
          ops: [
            { kind: 'participation.invite', target: 'did:plc:bob' },
            { kind: 'participation.broken' },
          ],
        }),
      ),
    ).toBeNull();
  });

  test('target を欠く invite は語彙に合わないので落とす', () => {
    expect(
      recordToJudgmentBatch(
        BID,
        record({ ops: [{ kind: 'participation.invite' }] }),
      ),
    ).toBeNull();
  });

  test('op が 0 件の batch は語彙上ありえないので落とす', () => {
    expect(recordToJudgmentBatch(BID, record({ ops: [] }))).toBeNull();
  });
});
