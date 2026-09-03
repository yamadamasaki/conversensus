/**
 * 判断ログの読み書き (step2 Phase 1)
 *
 * `collections.judgments` の上に rkey の組み立てと mapper を重ねた薄い層である。
 * グラフの batch が `RemoteSyncQueue` / `AtprotoSyncProvider` を通るのに対し、
 * ここが直に `collections` を呼ぶのは 2 つの理由による。
 *
 * - **outbox が要らない。**判断は滅多に起きず、失敗したらユーザに見せて操作をやり直させる
 *   方がよい。グラフの編集のように「取りこぼすと編集が消える」性質を持たない
 * - **キューは batch の語彙で組まれている。**判断を通すには型を広げるか分岐を足すことに
 *   なり、collection を分けた意味が薄れる
 *
 * 読み出しは `repo` を受ける。**他 actor の名簿を読むのが本命の用途**である
 * (自分の repo だけでは名簿は作れない — 招待 op は招待者の repo にある)。
 */

import type { BatchId, Did, FileId, JudgmentBatch } from '@conversensus/shared';
import type { ReadRosterOptions, ReadRosterResult } from '../sync/readRoster';
import { readRoster } from '../sync/readRoster';
import { batchIdFromRkey, batchRkey } from './batchRkey';
import { judgments } from './collections';
import { buildLocalDidPredicate } from './identity';
import {
  isJudgmentRecordValue,
  judgmentToRecord,
  recordToJudgmentBatch,
} from './judgmentMapper';
import type { RecordSummary } from './rangeFetch';

/** 判断 batch を**自分の repo へ**書く。rkey は batch の不変属性だけから決まる */
export async function putJudgment(
  fileId: FileId,
  batch: JudgmentBatch,
): Promise<void> {
  await judgments.put(
    batchRkey(fileId, batch.clock, batch.id),
    judgmentToRecord(batch, fileId),
  );
}

/**
 * 1 ファイル分の判断ログを読む。`repo` を省くと自分の repo。
 *
 * **弾いたレコードは数えて警告する** (silent skip にしない)。判断ログは名簿そのものなので、
 * 静かに落ちると「招待したのに相手が参加者にならない」が理由不明のまま残る。
 */
export async function fetchJudgments(
  fileId: FileId,
  repo?: Did,
): Promise<JudgmentBatch[]> {
  return toJudgmentBatches(
    await judgments.listByFile(fileId, { repo }),
    fileId,
  );
}

/** 判断ログを持つ fileId を列挙する。`repo` を省くと自分の repo */
export async function listJudgmentFileIds(repo?: Did): Promise<FileId[]> {
  const heads = await judgments.listFileHeads({ repo });
  return heads.map((h) => h.fileId);
}

function toJudgmentBatches(
  records: readonly RecordSummary[],
  fileId: FileId,
): JudgmentBatch[] {
  const batches: JudgmentBatch[] = [];
  let malformedRecord = 0;
  let unknownOps = 0;

  for (const record of records) {
    const rkey = record.uri.split('/').pop() ?? '';
    const batchId = batchIdFromRkey(rkey);
    if (!batchId || !isJudgmentRecordValue(record.value)) {
      malformedRecord += 1;
      continue;
    }
    const batch = recordToJudgmentBatch(batchId as BatchId, record.value);
    if (!batch) {
      unknownOps += 1;
      continue;
    }
    batches.push(batch);
  }

  if (malformedRecord > 0 || unknownOps > 0) {
    console.warn(
      `[participation] ${fileId}: 判断レコードを ${malformedRecord} 件 (形が不正), ` +
        `${unknownOps} 件 (語彙に無い op) 落とした`,
    );
  }
  return batches;
}

/**
 * 名簿を読む。`readRoster` に本物の依存を束ねただけの入口である。
 *
 * 起点 (`seed`) は呼び出し側が決める — 既に参加している File なら自分自身、
 * まだ参加していない File なら参加コードが指す招待者である
 * (`deepse/architecture/step2.md` §2)。
 */
export function loadRoster(
  options: ReadRosterOptions,
): Promise<ReadRosterResult> {
  return readRoster(
    {
      fetchJudgments: (fileId, repo) => fetchJudgments(fileId, repo),
      buildLocalDidPredicate: (dids) => buildLocalDidPredicate(dids),
    },
    options,
  );
}
