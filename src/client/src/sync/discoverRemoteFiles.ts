/**
 * discoverRemoteFiles: remote の batch op-log から未知ファイルを発見し materialize する
 * (step1 Phase 4e-2b, 4e 設計 §3.2b)
 *
 * `receiveRemoteBatches` (開いているファイル 1 つの差分受信) と対になる、repo 全体
 * スコープの受信。ローカル正典に存在しない fileId の batch 群をローカルへ書く。
 * genesis を含む受信がそのままファイルの起源になる (§3.1: 受信した genesis を正とし、
 * 自前で `graphFileToBatches` し直さない)。materialize されたファイルは
 * `GET /files` の和集合 (4e-2a) 経由で Sidebar に現れる。
 *
 * **Phase 7 p7-3 で「全件取得 → 既知分を捨てる」から「列挙 → 未知だけ取得」に変えた**
 * (Phase 7 設計 §3.3)。以前は repo 全体の batch を落としてから既知ファイルの分を
 * JS で捨てていたので、既に持っているファイルの履歴を毎回転送していた。今は:
 *
 * 1. `listRemoteFileIds()` で fileId を列挙する (1 ファイル 1 リクエスト・各 1 レコード)。
 * 2. ローカル既知の fileId を除く。
 * 3. **残った未知ファイルの分だけ** `pullRemoteForFile` で本体を取る。
 *
 * つまり既知ファイルの batch は 1 件も取得しない。
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
  /** remote に存在する fileId を列挙する (Phase 7 p7-3: batch 本体は伴わない) */
  listRemoteFileIds: () => Promise<FileId[]>;
  /** 未知ファイル 1 つ分の batch を取得する (Phase 7 p7-2 の範囲取得) */
  pullRemoteForFile: (fileId: FileId) => Promise<RemoteBatch[]>;
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
  /**
   * remote にあるが既知だったため**本体を取得しなかった**ファイル数 (Phase 7 p7-3)。
   * p7-2 までは「捨てた batch 数」だったが、既知ファイルの batch はもう落とさないので
   * 単位がファイル数に変わった (設計 §5.3)。
   */
  skippedKnownFiles: number;
};

/**
 * remote の fileId を列挙し、ローカル未存在のファイルを materialize する。
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
  const [remoteIds, localIds] = await Promise.all([
    deps.listRemoteFileIds(),
    deps.listLocalFileIds(),
  ]);
  const known = new Set<FileId>(localIds);

  // 列挙の重複は防御的に落とす (列挙側でも検知して warn する, Phase 7 設計 §3.6)
  const unknown = [...new Set(remoteIds)].filter((id) => !known.has(id));
  const skippedKnownFiles = new Set(remoteIds).size - unknown.length;

  const discovered: FileId[] = [];
  let appended = 0;
  for (const fileId of unknown) {
    const entries = await deps.pullRemoteForFile(fileId);
    // 適用先の権威はボディの fileId (rkey は取得経路の索引にすぎない)。取得が他ファイルを
    // 混ぜても未知の fileId を書かない — 孤児 batch を作らない不変条件 (4d 設計 §1.11 D-4)
    // を rkey 形式の正しさに依存させないための防御。
    const batches = entries
      .filter((e) => e.fileId === fileId)
      .map((e) => e.batch);
    if (batches.length !== entries.length) {
      console.warn(
        `[sync] discover: dropped ${entries.length - batches.length} batch(es) ` +
          `addressed to another file while fetching ${fileId} — rkey and record ` +
          'fileId disagree',
      );
    }
    // batch が 1 件も無いファイルは materialize しない (列挙にだけ現れた壊れた状態)
    if (batches.length === 0) continue;

    appended += await deps.appendReceived(fileId, batches);
    discovered.push(fileId);
  }

  return { discovered, appended, skippedKnownFiles };
}
