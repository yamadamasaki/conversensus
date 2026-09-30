/**
 * ファイル削除の書き込み経路 (ANA-127)
 *
 * 削除は op-log の `file.remove` (tombstone) として表現する。**ローカル DB の行を消す
 * のではない** — 行ごと消すと tombstone まで消え、次の discovery が「ローカルに無い =
 * 未知ファイル」と判定して PDS から materialize し直す。これが ANA-127 の原因だった
 * (設計 `step1-refinement-ana118-file-deletion.md` §2.1)。
 *
 * **tap を使えないので独立した経路になっている。** `useEventSyncTap` は
 * `activeFile.id` に束ねられており (`useFileSheetOperations` の `useEventSyncTap`
 * 呼び出し)、削除はサイドバーから **開いていないファイルにも掛かる**。tap 経由で流すと
 * tombstone が別のファイルの op-log に載る。したがって宛先ファイルの provider をその場で
 * 組み立てて push する。組み立て方は tap と同一 (local、ログイン中は fanout) なので、
 * remote への送出・再送・presentation 除外はすべて既存の `RemoteSyncQueue` が担う。
 */

import {
  type Actor,
  type Batch,
  CausalClock,
  type FileId,
  type Lamport,
} from '@conversensus/shared';
import { makeEventBase } from '../events/GraphEvent';
import { graphEventToBatch } from '../events/toUnified';

/**
 * tombstone の clock を決める。**既存の最大 clock + 1** でなければならない。
 *
 * 畳み込みの全順序で tombstone が最後に来るようにするためである。
 *
 * v1 の rkey は clock 順だったので、tombstone が各ファイルの最大 rkey (発見の着地点) に
 * 現れ、他端末は本体を引かずに削除に気づけた。v2 の rkey は actor → seq 順なので
 * そうとは限らず、削除の判定は発見側の「引いた op-log に `file.remove` があるか」が持つ
 * (`discoverRemoteFiles` の検査 2)。
 */
export function nextTombstoneClock(batches: readonly Batch[]): Lamport {
  return batches.reduce((max, b) => Math.max(max, b.clock), 0) + 1;
}

/** ファイル削除の tombstone batch を組み立てる (sheetId を持たない file 構造 batch) */
export function buildTombstoneBatch(
  batches: readonly Batch[],
  actor: Actor,
): Batch {
  // その File の op-log から復元した使い捨ての発番器で振る (開いていない File にも掛かるので
  // tap の発番器は使えない)。clock は最大の次になり、nextTombstoneClock と一致する
  const causal = new CausalClock(actor);
  causal.restore(batches);
  return graphEventToBatch(
    { ...makeEventBase('file'), type: 'FILE_DELETED' },
    { ...causal.issue(), actor },
  );
}

export type FileDeletionDeps = {
  /** 宛先ファイルの op-log。clock の最大値を知るために読む */
  fetchBatches: (fileId: FileId) => Promise<Batch[]>;
  /**
   * 宛先ファイルへの push。ローカル正典への追記が成功条件で、remote は非ブロッキング
   * (`FanoutSyncProvider` の契約そのまま)。
   */
  push: (fileId: FileId, batches: Batch[]) => Promise<void>;
};

/**
 * ファイルを削除する = op-log へ tombstone を 1 件追記する。
 *
 * ローカル正典への追記が失敗したら throw する — 呼び出し側は UI から消してはいけない
 * (消すと「画面には無いが次の起動で戻る」という ANA-127 そのものの状態になる)。
 */
export async function deleteFileByTombstone(
  fileId: FileId,
  actor: Actor,
  deps: FileDeletionDeps,
): Promise<Batch> {
  const tombstone = buildTombstoneBatch(await deps.fetchBatches(fileId), actor);
  await deps.push(fileId, [tombstone]);
  return tombstone;
}
