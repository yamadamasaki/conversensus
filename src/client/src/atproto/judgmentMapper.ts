/**
 * JudgmentBatch ↔ JudgmentRecord のマッピング (step2 Phase 1)
 *
 * `batchMapper.ts` と同形だが、**op を Zod で検証する点が違う。**
 *
 * グラフ側の op は projection が知らない種別を持っていても LWW / add-wins の外に
 * 落ちるだけで済むが、判断ログの畳み込みは **op の種別で pre 条件を分岐する**。
 * 語彙に無い op が混ざると `foldParticipation` の switch が黙って素通りし、
 * **捨てられもせず効きもしない**という第 3 の状態が生まれる。`rejected` に載らないので
 * UI にも出ない。それは「静かに捨てる経路を作らない」(W3d5-7 の教訓) に反する。
 *
 * したがって**境界で弾き、呼び出し側が数えて警告する**。
 */

import {
  type BatchId,
  type FileId,
  type ISODateString,
  type JudgmentBatch,
  JudgmentOpSchema,
} from '@conversensus/shared';
import type { JudgmentRecord, RemoteJudgment } from './types';

/** JudgmentBatch + fileId → レコードボディ ($type と rkey=batchId を除く) */
export function judgmentToRecord(
  batch: JudgmentBatch,
  fileId: FileId,
): Omit<JudgmentRecord, '$type'> {
  return {
    fileId,
    actor: batch.actor,
    clock: batch.clock,
    timestamp: batch.timestamp,
    ops: batch.ops,
    createdAt: new Date(batch.timestamp).toISOString() as ISODateString,
  };
}

/**
 * PDS レコード値が JudgmentRecord の**形**を満たすか (壊れた/他種レコードを弾く)。
 * op の中身までは見ない — それは `recordToJudgmentBatch` の仕事である。
 */
export function isJudgmentRecordValue(value: unknown): value is JudgmentRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.fileId === 'string' &&
    typeof v.actor === 'string' &&
    typeof v.clock === 'number' &&
    Number.isFinite(v.clock) &&
    typeof v.timestamp === 'number' &&
    Array.isArray(v.ops)
  );
}

/**
 * レコード → JudgmentBatch。**op が 1 つでも語彙に合わなければ `null` を返す。**
 *
 * batch ごと落とすのは、判断が**複数 op の原子性**を前提にしているためである
 * (「招待して同時に別の誰かを取り消す」)。一部だけ通すと、書いた側の意図と違う
 * 名簿になる。
 *
 * `null` を**数えて警告するのは呼び出し側の責務**である (silent skip にしない)。
 */
export function recordToJudgmentBatch(
  batchId: BatchId,
  value: JudgmentRecord,
): JudgmentBatch | null {
  const ops: JudgmentBatch['ops'] = [];
  for (const raw of value.ops) {
    const parsed = JudgmentOpSchema.safeParse(raw);
    if (!parsed.success) return null;
    ops.push(parsed.data);
  }
  if (ops.length === 0) return null; // op の無い batch は語彙上ありえない
  return {
    id: batchId,
    actor: value.actor,
    clock: value.clock,
    timestamp: value.timestamp,
    ops,
  };
}

/** レコード → `RemoteJudgment` (JudgmentBatch + 適用先 fileId) */
export function recordToRemoteJudgment(
  batchId: BatchId,
  value: JudgmentRecord,
): RemoteJudgment | null {
  const batch = recordToJudgmentBatch(batchId, value);
  if (!batch) return null;
  // 適用先の権威は**ボディの fileId**。rkey にも入るが索引であって復元元にしない
  return { fileId: value.fileId as FileId, batch };
}
