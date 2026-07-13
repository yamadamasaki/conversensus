/**
 * Batch ↔ BatchRecord のマッピング (step1 Phase 4c, op-log コレクション)
 *
 * 統一語彙の `Batch` を PDS の op-log レコード (`BatchRecord`) と相互変換する。
 * id は rkey として持つためレコードボディには含めない。clock/timestamp/ops を
 * そのまま載せるので往復は非可逆にならない。
 */

import type { Batch, ISODateString } from '@conversensus/shared';
import type { BatchRecord } from './types';

/** Batch → レコードボディ ($type と rkey=batchId を除く) */
export function batchToRecord(batch: Batch): Omit<BatchRecord, '$type'> {
  return {
    actor: batch.actor,
    clock: batch.clock,
    timestamp: batch.timestamp,
    ops: batch.ops,
    createdAt: new Date(batch.timestamp).toISOString() as ISODateString,
  };
}

/** PDS レコード値が BatchRecord の構造を満たすか (壊れた/他種レコードを弾く) */
export function isBatchRecordValue(value: unknown): value is BatchRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.actor === 'string' &&
    typeof v.clock === 'number' &&
    Number.isFinite(v.clock) &&
    typeof v.timestamp === 'number' &&
    Array.isArray(v.ops)
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
  };
}
