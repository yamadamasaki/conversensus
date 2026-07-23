/**
 * discoverRemoteFiles: remote の batch op-log から未知ファイルを発見し materialize する
 * (step1 Phase 4e-2b, 4e 設計 §3.2b)
 *
 * `receiveRemoteBatches` (開いているファイル 1 つの差分受信) と対になる、repo 全体
 * スコープの受信。`pullRemote` の結果を fileId ごとに束ね、ローカル正典に存在しない
 * fileId の batch 群をローカルへ書く。genesis を含む受信がそのままファイルの起源に
 * なる (§3.1: 受信した genesis を正とし、自前で `graphFileToBatches` し直さない)。
 * materialize されたファイルは `GET /files` の和集合 (4e-2a) 経由で Sidebar に現れる。
 *
 * - **書込口は受信 (a) と同じ marker 経路** (`POST /files/:id/batches/received`)。
 *   plain append だと次の `GET /files/:id/batches` が lazy migration を起動し、
 *   受信 genesis を破棄し得る (§1.8 と同型の事故)。
 * - **既知ファイルの batch はここでは書かない** — 開いているファイルは (a) が担い、
 *   開いていない既知ファイルへの追記は次に開いたときの (a) が回収する (べき等なので
 *   二重責務にしない)。
 * - **Lamport observe はしない** — clock は開いているファイルの tap が持ち、
 *   materialize したファイルに tap は無い。後で開いたとき `ensureRestored` が
 *   local pull の max(clock) から seed する (W3a) ので受信分を必ず追い越す。
 */

import type { Batch, FileId } from '@conversensus/shared';
import type { RemoteBatch } from '../atproto/types';

export type DiscoverRemoteDeps = {
  /** remote の全 batch を取得する (Phase 4d-4: 既読位置を持たず常に全件) */
  pullRemote: () => Promise<RemoteBatch[]>;
  /** ローカルに既知の fileId 一覧 (`GET /files` = snapshot と op-log の和集合, 4e-2a) */
  listLocalFileIds: () => Promise<FileId[]>;
  /** ローカル正典へ受信追記する (marker を立てる経路であること) */
  appendReceived: (fileId: FileId, batches: Batch[]) => Promise<number>;
};

export type DiscoverRemoteResult = {
  /** materialize した未知ファイル (発見順) */
  discovered: FileId[];
  /** ローカル正典に新規追記された batch 数 (全発見ファイルの合計) */
  appended: number;
  /** 既知ファイル宛だったため書かなかった batch 数 */
  skippedKnown: number;
};

/**
 * remote の batch を fileId ごとに束ね、ローカル未存在のファイルを materialize する。
 *
 * べき等: 同じ内容で 2 回呼んでも 2 回目は listLocalFileIds が発見済みファイルを
 * 含む (4e-2a の和集合) ため何も書かない。万一一覧に出る前に再実行しても
 * `appendReceivedBatches` の batch_id べき等性が二重追記を無害化する。
 * 途中のファイルで書き込みが失敗したら throw する — 残りは次回契機の再実行が
 * 拾う (べき等なので途中まで書けていても壊れない)。
 */
export async function discoverRemoteFiles(
  deps: DiscoverRemoteDeps,
): Promise<DiscoverRemoteResult> {
  const [entries, localIds] = await Promise.all([
    deps.pullRemote(),
    deps.listLocalFileIds(),
  ]);
  const known = new Set<FileId>(localIds);

  // fileId ごとに束ねる (発見順 = remote の返却順を保つ)
  const byFile = new Map<FileId, Batch[]>();
  let skippedKnown = 0;
  for (const entry of entries) {
    if (known.has(entry.fileId)) {
      skippedKnown += 1;
      continue;
    }
    const arr = byFile.get(entry.fileId);
    if (arr) arr.push(entry.batch);
    else byFile.set(entry.fileId, [entry.batch]);
  }

  const discovered: FileId[] = [];
  let appended = 0;
  for (const [fileId, batches] of byFile) {
    appended += await deps.appendReceived(fileId, batches);
    discovered.push(fileId);
  }

  return { discovered, appended, skippedKnown };
}
