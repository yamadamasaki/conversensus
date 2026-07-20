/**
 * Batch ↔ BatchRecord のマッピング (step1 Phase 4c, op-log コレクション)
 *
 * 統一語彙の `Batch` を PDS の op-log レコード (`BatchRecord`) と相互変換する。
 * id は rkey として持つためレコードボディには含めない。clock/timestamp/ops を
 * そのまま載せるので往復は非可逆にならない。
 *
 * `fileId` は `Batch` の外から与える (Phase 4d-1)。ローカルでは op-log がファイル単位に
 * 仕切られていて文脈から復元できるが、remote の batch コレクションは repo 全体で 1 つなので
 * レコードには埋め込む必要がある。この非対称は `RemoteBatch` エンベロープで表現する。
 */

import type { Batch, FileId, ISODateString } from '@conversensus/shared';
import type { BatchRecord, RemoteBatch } from './types';

/** Batch + fileId → レコードボディ ($type と rkey=batchId を除く) */
export function batchToRecord(
  batch: Batch,
  fileId: FileId,
): Omit<BatchRecord, '$type'> {
  return {
    fileId,
    actor: batch.actor,
    clock: batch.clock,
    timestamp: batch.timestamp,
    ops: batch.ops,
    // content batch のみ sheetId を持つ。undefined なら省略し、往復で無 → 無を保つ。
    ...(batch.sheetId !== undefined && { sheetId: batch.sheetId }),
    createdAt: new Date(batch.timestamp).toISOString() as ISODateString,
  };
}

/**
 * PDS レコード値が BatchRecord の構造を満たすか (壊れた/他種レコードを弾く)。
 *
 * `fileId` は Phase 4d-1 で**必須**にした。持たないレコード (W3d5 以前に書かれたもの) は
 * ここで弾かれ、受信側は適用先を復元できないものを取り込まずに済む。
 * **弾いた件数は呼び出し側が数えて警告に出すこと** (silent skip にしない, §3.1) —
 * W3d5-7 で「PDS が float を拒否して全 push が 400、しかしコンソールは無言」という
 * 事故があったため、静かに捨てる経路を新たに作らない。
 */
export function isBatchRecordValue(value: unknown): value is BatchRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.fileId === 'string' &&
    typeof v.actor === 'string' &&
    typeof v.clock === 'number' &&
    Number.isFinite(v.clock) &&
    typeof v.timestamp === 'number' &&
    Array.isArray(v.ops) &&
    // sheetId は optional。無いレコード (file 構造 batch) も通すが、
    // 有るなら string でなければ壊れたレコードとして弾く。
    (v.sheetId === undefined || typeof v.sheetId === 'string')
  );
}

/**
 * レコード (rkey + value) → Batch。
 * value は事前に `isBatchRecordValue` で検証済みであること。
 * id は rkey (= batchId) から復元する。
 */
export function recordToBatch(rkey: string, value: BatchRecord): Batch {
  return {
    id: rkey as Batch['id'],
    actor: value.actor,
    clock: value.clock,
    timestamp: value.timestamp,
    ops: value.ops as Batch['ops'],
    // sheetId 無しレコードは Batch にも sheetId を付けない (undefined を保つ)。
    ...(value.sheetId !== undefined && {
      sheetId: value.sheetId as Batch['sheetId'],
    }),
  };
}

/**
 * レコード → `RemoteBatch` (Batch + 適用先 fileId)。
 * 受信経路 (Phase 4d-5) が適用先を復元するために使う。
 */
export function recordToRemoteBatch(
  rkey: string,
  value: BatchRecord,
): RemoteBatch {
  return {
    fileId: value.fileId as FileId,
    batch: recordToBatch(rkey, value),
  };
}
