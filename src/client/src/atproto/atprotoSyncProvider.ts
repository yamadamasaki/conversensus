/**
 * AtprotoSyncProvider: ATProto の op-log コレクションを裏に隠す remote 実装 (step1 Phase 4c)
 *
 * architecture §6 / D3。外の層は境界インターフェースだけに依存し、この実装が ATProto の
 * op-log コレクション (`app.conversensus.v2.batch`) への読み書きに翻訳する。
 *
 * **実装するのは `SyncProvider` ではなく `RemoteBatchTarget`** (Phase 4d-1)。`SyncProvider` は
 * ファイル単位の境界だが、ATProto の batch コレクションは **repo 全体で 1 つ**なので、
 * 送信単位は fileId を伴う `RemoteBatch` になる。この非対称を型に出している。
 *
 * - pushRemote: batch を putRecord (rkey = `<fileId>~<actor>~<seq>`, step3 Phase 1 D9)。
 *   rkey が batch の不変属性だけから決まるのでべき等 (`batchRkey.ts`)。
 * - pullRemoteForFile: **1 ファイル分**を rkey prefix の範囲取得で得る (Phase 7 p7-2)。
 *   受信 (`receiveRemoteBatches`) と catch-up の経路はこちらに載る。
 * - listRemoteFiles: remote に存在するファイルを列挙する (Phase 7 p7-3)。発見経路が使う。
 *   削除済みか (ANA-127 の tombstone) も列挙の 1 レコードから判定して返す。
 *
 * **`subscribe` は p7-5 で撤去した** — 定期 poll + 全件 list という実装で、消費箇所は
 * 一度も 1 件にならなかった (受信は起動時 + `online` + 手動で駆動する, 4d 設計 §3.4)。
 * Jetstream 購読は別形式なので Phase 8 で作り直す。
 *
 * 依存 (batch collection) は注入可能にし、PDS 非依存にテストする。
 */

import {
  type BlobCid,
  type Did,
  type FileId,
  isFileDeleted,
  type Op,
} from '@conversensus/shared';
import { PartialPushError } from '../sync/outbox';
import {
  batchToRecord,
  isBatchRecordValue,
  recordToRemoteBatch,
} from './batchMapper';
import { batchRkey } from './batchRkey';
import type { BatchFileHead } from './rangeFetch';
import type { RemoteBatchTarget } from './remoteSyncQueue';
import type {
  BatchRecord,
  RecordResult,
  RemoteBatch,
  RemoteFileEntry,
} from './types';

/** `listRecords` が返すレコード 1 件分 (rkey は uri の末尾にしか無い) */
type RecordSummary = { uri: string; cid: string; value: unknown };

/** op-log コレクションの最小インターフェース (実体は collections.batches) */
export interface BatchCollection {
  put(rkey: string, data: Omit<BatchRecord, '$type'>): Promise<RecordResult>;
  /**
   * 1 ファイル分だけを rkey prefix の範囲で取得する (Phase 7 p7-2)。
   * `repo` を省くと自分の repo。**他 actor の op-log を読むのが step2 Phase 2 の用途**
   */
  listByFile(
    fileId: FileId,
    options?: { repo?: Did },
  ): Promise<RecordSummary[]>;
  /**
   * remote に存在するファイルを列挙する (Phase 7 p7-3, batch 本体は落とさない)。
   * 各ファイルの**着地レコード** (最大 clock の batch) を伴う (ANA-127 S3)。
   */
  listFileHeads(): Promise<BatchFileHead[]>;
}

/** blob 先出しの結果 (ANA-116 S5 / レビュー D2) */
export type BlobUploadResult = {
  /**
   * **実体がこの端末に無く上げられなかった** blob の cid。空なら全部上がった。
   *
   * これを参照するレコードは PDS が `Could not find blob` で拒むので、呼び出し側は
   * **その batch を送らずに飛ばせる** = 送れない 1 件が残りを止めない (D2)。
   */
  unavailable: readonly BlobCid[];
};

/**
 * レコードを書く**前に**、その op 列が参照する blob を PDS へ上げる関数 (ANA-116 S5)。
 *
 * 実体は `images/imageBlob.ts` の `createPdsBlobUploader`。ここが型でしか知らないのは
 * 依存の向きのためである — ローカル blob ストア (daemon) は ATProto と無関係なので、
 * `atproto/` から `images/` や `api.ts` へ降りない。
 */
export type BlobUploader = (ops: readonly Op[]) => Promise<BlobUploadResult>;

export type AtprotoSyncProviderDeps = {
  batches: BatchCollection;
  /**
   * blob の先出し。**必須にしてある** — 省略できると、配線を忘れた瞬間に
   * 「画像を含む batch だけが outbox に詰まり続ける」形で静かに壊れる。
   * blob を使わないテストは no-op を渡す。
   */
  uploadBlobs: BlobUploader;
};

export class AtprotoSyncProvider implements RemoteBatchTarget {
  private readonly batches: BatchCollection;
  private readonly uploadBlobs: BlobUploader;

  constructor(deps: AtprotoSyncProviderDeps) {
    this.batches = deps.batches;
    this.uploadBlobs = deps.uploadBlobs;
  }

  /**
   * これから書く batch が参照する blob を PDS へ先に上げる (設計 D5)。
   *
   * **レコードを書く前に上げる。** 逆順 (レコードが先) は PDS が
   * `Could not find blob` で拒否するので不可 (S1)。
   *
   * `pushRemote` は **batch 1 件ずつ**呼ぶ — 失敗境界を batch 単位にするため (レビュー D2)。
   * 1 件ずつでも往復が増えないのは、`createPdsBlobUploader` が上げ済みの cid を
   * セッション内で覚えているためである。
   *
   * @returns 実体がこの端末に無く上げられなかった cid (空なら全部上がった)
   */
  private async uploadReferencedBlobs(
    entries: readonly RemoteBatch[],
  ): Promise<readonly BlobCid[]> {
    const { unavailable } = await this.uploadBlobs(
      entries.flatMap(({ batch }) => batch.ops),
    );
    return unavailable;
  }

  /**
   * batch を op-log レコードとして PDS へ書く (べき等)。
   *
   * rkey は `<fileId>~<actor>~<seq>` (step3 Phase 1 D9, `batchRkey.ts`)。**ファイル単位の
   * 範囲取得を成り立たせるために fileId を先頭に置く**。決定論的なので、同じ batch を
   * 再送しても同じレコードを上書きする (べき等)。
   *
   * 運搬単位が `Batch` ではなく `RemoteBatch` (Batch + fileId) なのは、ATProto の batch
   * コレクションが **repo 全体で 1 つ**で、レコード自身が適用先ファイルを持たないと
   * 受信側が復元できないため (Phase 4d-1, 設計 §3.1)。rkey にも fileId が入るが、
   * **適用先の権威はボディの `fileId`** — rkey は取得経路の索引にすぎない。
   *
   * ## 失敗の境界 (レビュー D2)
   *
   * 失敗を 2 種類に分ける。**送れないと分かっている batch で残りを止めない**ためである。
   *
   * - **その batch 固有** (参照する blob の実体がこの端末に無い): 上げられないと
   *   `uploadBlobs` が `unavailable` で教えるので、**PDS を叩かずに飛ばして次へ進む**。
   *   PDS に既にあれば書けるが、それはここでは判別できない (S5) ので送らない側に倒す。
   * - **全体的な失敗** (通信不調・認証切れ): 残りを試しても同じ結果なので**打ち切る**。
   *   オフライン編集中は編集ごとに flush が走るので、全件試すと失敗リクエストが
   *   保留件数の二乗で増えてしまう。
   *
   * どちらも `PartialPushError` で「送れた分」を Outbox へ返すので、**送れた batch は
   * 保留から消え、送れなかった batch だけが残る**。remote に隙間ができるが、projection は
   * 対象を欠く op を落とすので壊れず (`project.ts`)、catch-up が後で埋める。
   */
  async pushRemote(entries: readonly RemoteBatch[]): Promise<void> {
    const sentIds: string[] = [];
    let skipError: unknown;

    for (const { batch, fileId } of entries) {
      try {
        const unavailable = await this.uploadReferencedBlobs([
          { batch, fileId },
        ]);
        if (unavailable.length > 0) {
          skipError ??= new Error(
            `Cannot push batch ${batch.id}: blob(s) ${unavailable.join(', ')} are not in the local store`,
          );
          continue;
        }
        await this.batches.put(
          batchRkey(fileId, batch.actor, batch.seq),
          batchToRecord(batch, fileId),
        );
        sentIds.push(batch.id);
      } catch (error) {
        // 全体的な失敗: ここで打ち切り、送れた分だけを Outbox に伝える
        throw new PartialPushError(sentIds, error);
      }
    }

    if (skipError !== undefined) {
      throw new PartialPushError(sentIds, skipError);
    }
  }

  /**
   * remote の batch レコードのうち **1 ファイル分だけ**を取得する (Phase 7 p7-2)。
   *
   * rkey が `<fileId>~…` なので、そのファイルのレコードは rkey 空間で
   * 連続する。`collections.batches.listByFile` が合成 cursor で先頭へ seek し、prefix を
   * 外れた時点で止めるので、**取得量が repo 全体ではなくそのファイルの履歴に比例する**
   * (設計 §3.2)。
   *
   * **既読位置 (cursor) は持たない** — 全件版と同じ契約である。毎回そのファイルの
   * 先頭から読み、二重取り込みは受信側 (`EventStore.appendReceivedBatches`) のべき等性が
   * 無害化する。変わったのは 1 回の取得量だけで、取りこぼしゼロの保証は構造のまま (§2.2)。
   *
   * 返すのが `Batch` ではなく `RemoteBatch` なのは全件版と同じ理由 (§3.1) だが、
   * ここでは `fileId` は引数と一致するはずである。**一致しない場合の扱いは呼び出し側に
   * 委ねる** — 不変条件 (孤児 batch を作らない, 4d 設計 §1.11 D-4) を rkey の正しさに
   * 依存させないため、`receiveRemoteBatches` 側の fileId フィルタを防御として残している。
   *
   * **`repo` を省くと自分の repo** (step2 Phase 2 S2)。他 actor の DID を渡すとその actor の
   * op-log を読む。書き込みには `repo` が無い — ATProto の credential は自分の repo のものしか
   * 無いので、**「他者の repo は読めるが書けない」という非対称をそのまま型に出している**
   * (`collections.ts` の `ReadRepo`)。
   */
  async pullRemoteForFile(fileId: FileId, repo?: Did): Promise<RemoteBatch[]> {
    return toRemoteBatches(await this.batches.listByFile(fileId, { repo }));
  }

  /**
   * remote に存在するファイルを列挙する (Phase 7 p7-3 / ANA-127 S3)。
   *
   * 未知ファイルの発見 (`discoverRemoteFiles`) が必要とするのは、まず **fileId の集合**で
   * ある — batch 本体は未知ファイルの分だけあればよい。rkey が `<fileId>~…` なので
   * **1 ファイル 1 リクエスト・各 1 レコード**で列挙でき、既知ファイルの batch を
   * 落として捨てることが無くなる (設計 §3.3)。
   *
   * その 1 レコード (着地点 = 最大 clock の batch) を **tombstone かどうかの判定にも
   * 使う** (ANA-127)。削除は最大 clock の `file.remove` として置かれるので、
   * 削除済みファイルは**本体を 1 件も引かずに**除外できる。判定は正典と同じ
   * `isFileDeleted` に通す — remote 側だけ別の規則にしない。
   *
   * 着地レコードが壊れていて Batch に翻訳できない場合は `deleted: false` になる
   * (`toRemoteBatches` が数えて警告する)。取りこぼしは pull 後の検査が拾う。
   *
   * 旧 rkey のレコードしか無いファイルはここに現れない。それらは移行 (p7-4) が
   * 新 rkey で再 push するまで発見経路の外にある — 移行前に全件受信を 1 回通す順序
   * (§3.4) がその穴を塞ぐ。
   */
  async listRemoteFiles(): Promise<RemoteFileEntry[]> {
    const heads = await this.batches.listFileHeads();
    return heads.map(({ fileId, head }) => ({
      fileId,
      deleted: isFileDeleted(toRemoteBatches([head]).map((e) => e.batch)),
    }));
  }
}

/**
 * レコード列を `RemoteBatch[]` へ翻訳する (ファイル単位取得の後段)。
 *
 * v2 では `batch.id` を**レコードの本文**に持つので、rkey からは何も復元しない。
 */
function toRemoteBatches(records: readonly RecordSummary[]): RemoteBatch[] {
  let skipped = 0;
  const entries: RemoteBatch[] = [];
  for (const r of records) {
    if (!isBatchRecordValue(r.value)) {
      // 壊れた/他種/旧形式 (fileId 無し) レコードを飛ばす。
      // **数えて警告する** — silent skip にしない (§3.1)。W3d5-7 で「PDS が float を
      // 拒否して全 push が 400、しかしコンソールは無言」という事故があったため、
      // 静かに捨てる経路を新たに作らない。
      skipped += 1;
      continue;
    }
    entries.push(recordToRemoteBatch(r.value));
  }

  // 決定論的な順序で返す: clock → actor → id (`orderBatches` と同じ規則, 4d-3)。
  // **rkey 順には依存しない** — ファイル単位取得 (p7-2) は rkey 昇順で返るが、
  // 端末をまたぐと clock が単調でないので並べ替えはここが権威 (`batchRkey.ts` の設計注)。
  entries.sort(
    (x, y) =>
      x.batch.clock - y.batch.clock ||
      x.batch.actor.localeCompare(y.batch.actor) ||
      x.batch.id.localeCompare(y.batch.id),
  );

  if (skipped > 0) {
    console.warn(
      `[atproto] skipped ${skipped} batch record(s): not a valid BatchRecord ` +
        '(missing fileId, or a foreign/corrupt record)',
    );
  }

  return entries;
}
