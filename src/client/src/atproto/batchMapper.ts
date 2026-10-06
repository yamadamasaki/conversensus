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

import {
  type Batch,
  type BatchId,
  type FileId,
  type ISODateString,
  ReceivedBatchSchema,
} from '@conversensus/shared';
import type { BatchRecord, RemoteBatch } from './types';

/**
 * `deps` が vector の形か (actor → 正の整数)。壊れたレコードで因果の判定を狂わせない
 */
export function isVersionVector(
  value: unknown,
): value is Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  return Object.values(value).every(
    (seq) => typeof seq === 'number' && Number.isInteger(seq) && seq > 0,
  );
}

/** 点 (`{ actor, seq }`) の形か */
function isDot(value: unknown): value is { actor: string; seq: number } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.actor === 'string' &&
    typeof v.seq === 'number' &&
    Number.isInteger(v.seq) &&
    v.seq > 0
  );
}

/** Batch + fileId → レコードボディ ($type を除く。rkey は `batchRkey` が組む) */
export function batchToRecord(
  batch: Batch,
  fileId: FileId,
): Omit<BatchRecord, '$type'> {
  return {
    id: batch.id,
    fileId,
    actor: batch.actor,
    clock: batch.clock,
    seq: batch.seq,
    deps: batch.deps,
    timestamp: batch.timestamp,
    ops: batch.ops,
    // content batch のみ sheetId を持つ。undefined なら省略し、往復で無 → 無を保つ。
    ...(batch.sheetId !== undefined && { sheetId: batch.sheetId }),
    // merge の写しだけが持つ (step3 Phase 1 D2)。無ければ省略し、往復で無 → 無を保つ
    ...(batch.copyOf !== undefined && { copyOf: batch.copyOf }),
    ...(batch.mergedIn !== undefined && { mergedIn: batch.mergedIn }),
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
    typeof v.id === 'string' &&
    typeof v.fileId === 'string' &&
    typeof v.actor === 'string' &&
    typeof v.clock === 'number' &&
    Number.isFinite(v.clock) &&
    typeof v.seq === 'number' &&
    Number.isInteger(v.seq) &&
    isVersionVector(v.deps) &&
    typeof v.timestamp === 'number' &&
    Array.isArray(v.ops) &&
    // sheetId は optional。無いレコード (file 構造 batch) も通すが、
    // 有るなら string でなければ壊れたレコードとして弾く。
    (v.sheetId === undefined || typeof v.sheetId === 'string') &&
    // merge の写しの印も optional。有るなら形 ({ actor, seq }) を満たさなければ弾く
    (v.copyOf === undefined || isDot(v.copyOf)) &&
    (v.mergedIn === undefined || typeof v.mergedIn === 'string')
  );
}

/**
 * レコードの値を素の JSON に戻す (step3 FPR の確認で発覚)。
 *
 * `@atproto/api` は読んだレコードの中の blob (`{"$type":"blob","ref":{"$link":…}}`) を
 * **`BlobRef` のインスタンス**に変える (`ref` は CID のオブジェクトで、`$type` も持たない)。
 * 元の形に戻るのは `toJSON` を通ったときだけである。step3 Phase 2 から受信した batch は
 * Worker へ `postMessage` (structured clone) で渡るので `toJSON` が呼ばれず、画像の参照が
 * 壊れて「画像 URL を入力」になった。**PDS から入る所で JSON に戻しておく**
 */
export function plainJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * レコード (batchId + value) → Batch。
 * value は事前に `isBatchRecordValue` で検証済みであること。
 * `batchId` は rkey から復元した値 (`batchIdFromRkey`) を渡す。
 */
export function recordToBatch(value: BatchRecord): Batch {
  return {
    id: value.id as BatchId,
    actor: value.actor,
    clock: value.clock,
    seq: value.seq,
    deps: value.deps,
    timestamp: value.timestamp,
    ops: plainJson(value.ops) as Batch['ops'],
    // sheetId 無しレコードは Batch にも sheetId を付けない (undefined を保つ)。
    ...(value.sheetId !== undefined && {
      sheetId: value.sheetId as Batch['sheetId'],
    }),
    ...(value.copyOf !== undefined && { copyOf: value.copyOf }),
    ...(value.mergedIn !== undefined && {
      mergedIn: value.mergedIn as Batch['mergedIn'],
    }),
  };
}

/**
 * レコード → `RemoteBatch` (Batch + 適用先 fileId)。
 * 受信経路 (Phase 4d-5) が適用先を復元するために使う。
 */
export function recordToRemoteBatch(value: BatchRecord): RemoteBatch {
  return {
    // 適用先の権威は**ボディの fileId**。rkey にも fileId が入る (Phase 7) が、
    // そちらは取得経路の索引であって復元元にしない (二重の真実を作らない)。
    fileId: value.fileId as FileId,
    batch: recordToBatch(value),
  };
}

/**
 * 受け取る clock の上限 (security review M2)。Lamport の受信規則は、受け取った最大の clock まで
 * 自分の clock を引き上げる。上限が無いと、他人が `Number.MAX_SAFE_INTEGER` 付近の clock を
 * 書いたときに全員の clock がそこへ飛び、`+1` しても値が変わらなくなって全順序が崩れる。
 * 2^48 は実際の編集では届かず (1 秒に 1000 回書いても 8 千年以上)、`+1` が正確な範囲に収まる
 */
export const MAX_REMOTE_CLOCK = 2 ** 48;

/**
 * PDS から読んだ batch を受け取ってよいか (security review M1・M2)。
 *
 * **1 件ずつ見る。**保存の Worker は受信した batch の配列を一括で検証するので、壊れた batch が
 * 1 件混ざると配列ごと例外になり、その File の受信が全員分止まり続けた。ここで弾けば、
 * 他の batch は受け取れる。知らない種類の op は通す (`ReceivedBatchSchema`, 案 A)
 */
export function isAcceptableRemoteBatch(batch: Batch): boolean {
  return (
    ReceivedBatchSchema.safeParse(batch).success &&
    batch.clock <= MAX_REMOTE_CLOCK
  );
}
