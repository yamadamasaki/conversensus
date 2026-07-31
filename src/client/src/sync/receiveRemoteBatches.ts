/**
 * receiveRemoteBatches: remote の batch op-log をローカル正典へ取り込む (step1 Phase 4d-5)
 *
 * 4d-0〜4d-4 で揃えた部品を繋ぐ層。設計 `step1-phase4d-receive.md` §3.3 の
 * **3 つの不変条件**をこの関数が引き受ける:
 *
 * - **(a) 受信は fanout を通さない** (§1.11 D-5)。`FanoutSyncProvider.push` を使うと
 *   `remoteQueue.enqueue` が走り、受信したものを remote へ送り返す (echo ループ)。
 *   → 書き込みは `appendReceived` (= `POST /files/:id/batches/received`) への直書きに限る。
 * - **(b) 書き込みは migration marker と整合する** (§1.8)。`appendReceived` は
 *   `EventStore.appendReceivedBatches` に届き、追記と marker 立てを 1 tx で行う。
 * - **(c) 自端末 clock を `observe` で前進させる** (§1.6 / §3.2a)。これが無いと
 *   端末をまたいだ `clock` 比較が「因果的に後」を表現しない。
 *
 * **スコープは開いているファイル 1 つ** (§2)。**Phase 7 p7-2 で取得もファイル単位になった** —
 * `pullRemoteForFile(fileId)` が rkey prefix の範囲取得でそのファイル分だけを返すので、
 * 他ファイル分を落として捨てることが無くなった (`skippedOtherFile` は構造的に 0)。
 * **fileId フィルタは残す** (Phase 7 設計 §3.5): 未知の fileId を書き込むと孤児 batch が
 * 生まれる (§1.11 D-4) ので、この不変条件を rkey 形式の正しさに依存させない。
 * 0 でない `skippedOtherFile` は「rkey とボディの fileId が食い違った」ことの検知器になる。
 * 新規ファイルの跨端末伝播は Phase 4e。
 *
 * **画面反映は行わない** (§1.9 → Phase 4e)。取り込みはローカル正典まで。受入基準 (§5) が
 * 画面を証拠にしていないので、画面反映が無くても 4d は検証できる。
 */

import type { Batch, FileId, Lamport } from '@conversensus/shared';
import type { RemoteBatch } from '../atproto/types';

export type ReceiveRemoteDeps = {
  /**
   * remote から**このファイル分**の batch を取得する (Phase 7 p7-2)。
   * 既読位置は持たない (毎回そのファイルの全履歴) — 取りこぼしゼロを構造で保証する
   * 契約は 4d-4 のまま変えていない。
   */
  pullRemoteForFile: (fileId: FileId) => Promise<RemoteBatch[]>;
  /** ローカル正典へ受信追記する (marker を立てる経路であること, 不変条件 b) */
  appendReceived: (fileId: FileId, batches: Batch[]) => Promise<number>;
  /** 自端末 clock を Lamport 受信規則で前進させる (不変条件 c) */
  observeRemote: (remoteClock: Lamport) => void;
};

export type ReceiveRemoteResult = {
  /** このファイル宛として remote から取得した batch 数 */
  received: number;
  /** ローカル正典に新規追記された batch 数 (既知分はべき等に無視される) */
  appended: number;
  /**
   * 他ファイル宛だったため捨てた batch 数。
   * **Phase 7 p7-2 以降は 0 が正常** — 0 でなければ rkey とボディの fileId が食い違っている。
   */
  skippedOtherFile: number;
};

/**
 * remote の batch を取得し、指定ファイル宛のものをローカル正典へ取り込む。
 *
 * べき等: 同じ内容で 2 回呼んでも `appended` が 0 になるだけで op-log は増えない
 * (`appendBatch` の batch_id べき等性)。既読位置を持たないので毎回そのファイルの
 * 全履歴を取得するが、この性質があるので取りこぼしも二重取り込みも起きない。
 */
export async function receiveRemoteBatches(
  fileId: FileId,
  deps: ReceiveRemoteDeps,
): Promise<ReceiveRemoteResult> {
  const entries = await deps.pullRemoteForFile(fileId);

  const mine: Batch[] = [];
  let skippedOtherFile = 0;
  for (const entry of entries) {
    if (entry.fileId === fileId) mine.push(entry.batch);
    else skippedOtherFile += 1;
  }

  // ファイル単位取得 (p7-2) の後は 1 件でも異常 — 静かに捨てない (Phase 7 設計 §3.6)
  if (skippedOtherFile > 0) {
    console.warn(
      `[sync] receive: dropped ${skippedOtherFile} batch(es) addressed to another ` +
        `file while fetching ${fileId} — rkey and record fileId disagree`,
    );
  }

  if (mine.length === 0) {
    return { received: 0, appended: 0, skippedOtherFile };
  }

  // (b) marker を立てる経路へ直書きする。(a) provider.push は使わない (echo ループ回避)。
  const appended = await deps.appendReceived(fileId, mine);

  // (c) 受信規則。書き込みが成功してから前進させる — 失敗して取り込めていないのに
  // clock だけ進むと、次に発番する batch が「取り込めなかった編集より後」を騙る。
  const maxClock = mine.reduce((m, b) => Math.max(m, b.clock), 0);
  deps.observeRemote(maxClock);

  return { received: mine.length, appended, skippedOtherFile };
}
