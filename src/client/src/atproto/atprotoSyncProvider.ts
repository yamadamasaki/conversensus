/**
 * AtprotoSyncProvider: ATProto の op-log コレクションを裏に隠す remote 実装 (step1 Phase 4c)
 *
 * architecture §6 / D3。外の層は境界インターフェースだけに依存し、この実装が ATProto の
 * op-log コレクション (`app.conversensus.graph.batch`) への読み書きに翻訳する。
 *
 * **実装するのは `SyncProvider` ではなく `RemoteBatchTarget`** (Phase 4d-1)。`SyncProvider` は
 * ファイル単位の境界だが、ATProto の batch コレクションは **repo 全体で 1 つ**なので、
 * 送信単位は fileId を伴う `RemoteBatch` になる。この非対称を型に出している。
 *
 * - pushRemote: batch を putRecord (rkey = `v1~<fileId>~<clock>~<batchId>`, Phase 7 p7-1)。
 *   rkey が batch の不変属性だけから決まるのでべき等 (`batchRkey.ts`)。
 * - pullRemoteForFile: **1 ファイル分**を rkey prefix の範囲取得で得る (Phase 7 p7-2)。
 *   受信 (`receiveRemoteBatches`) と catch-up の経路はこちらに載る。
 * - listRemoteFiles: remote に存在するファイルを列挙する (Phase 7 p7-3)。発見経路が使う。
 *   削除済みか (ANA-127 の tombstone) も列挙の 1 レコードから判定して返す。
 * - pullAllRemoteForMigration: batch レコードを**全件**取得。**移行 (p7-4) 専用の 1 回限りの口**で、
 *   旧 rkey のレコードを探せる唯一の経路である (新経路は `v1~` しか走査しない)。p7-5 で
 *   他の消費者はすべて上の 2 つへ移り、この名前が用途を型の面に固定している。
 *
 * **`subscribe` は p7-5 で撤去した** — 定期 poll + 全件 list という実装で、消費箇所は
 * 一度も 1 件にならなかった (受信は起動時 + `online` + 手動で駆動する, 4d 設計 §3.4)。
 * Jetstream 購読は別形式なので Phase 8 で作り直す。
 *
 * 依存 (batch collection) は注入可能にし、PDS 非依存にテストする。
 */

import { type FileId, isFileDeleted, type Op } from '@conversensus/shared';
import {
  batchToRecord,
  isBatchRecordValue,
  recordToRemoteBatch,
} from './batchMapper';
import { batchIdFromRkey, batchRkey, rkeyFromUri } from './batchRkey';
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
  /** **未存在**のレコードをまとめて作る (Phase 7 p7-4 の移行専用, applyWrites) */
  createMany(
    entries: readonly { rkey: string; data: Omit<BatchRecord, '$type'> }[],
  ): Promise<void>;
  /**
   * repo 全体 (Phase 4d-4)。**移行 (p7-4) 専用**である (p7-5)。
   *
   * 通常経路がこれを呼ばないのは Phase 7 の目的そのものだが、移行だけは代替が無い —
   * 旧 rkey (`v1~` で始まらない) のレコードは `listByFile` / `listFileHeads` の走査範囲に
   * 現れないので、探せるのは全件走査だけである。名前で用途を固定しておく。
   */
  listAllForMigration(): Promise<RecordSummary[]>;
  /** 1 ファイル分だけを rkey prefix の範囲で取得する (Phase 7 p7-2) */
  listByFile(fileId: FileId): Promise<RecordSummary[]>;
  /**
   * remote に存在するファイルを列挙する (Phase 7 p7-3, batch 本体は落とさない)。
   * 各ファイルの**着地レコード** (最大 clock の batch) を伴う (ANA-127 S3)。
   */
  listFileHeads(): Promise<BatchFileHead[]>;
}

/**
 * レコードを書く**前に**、その op 列が参照する blob を PDS へ上げる関数 (ANA-116 S5)。
 *
 * 実体は `images/imageBlob.ts` の `createPdsBlobUploader`。ここが型でしか知らないのは
 * 依存の向きのためである — ローカル blob ストア (daemon) は ATProto と無関係なので、
 * `atproto/` から `images/` や `api.ts` へ降りない。
 */
export type BlobUploader = (ops: readonly Op[]) => Promise<void>;

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
   * **レコードを 1 件でも書く前に、送る全 batch 分をまとめて上げる。** 1 件ずつ
   * 交互にすると、途中で失敗したときに「blob だけ上がって参照が無い」状態が
   * 増えるうえ、同じ blob を参照する後続の batch で無駄な往復が起きる。
   * 逆順 (レコードが先) は PDS が `Could not find blob` で拒否するので不可 (S1)。
   */
  private async uploadReferencedBlobs(
    entries: readonly RemoteBatch[],
  ): Promise<void> {
    await this.uploadBlobs(entries.flatMap(({ batch }) => batch.ops));
  }

  /**
   * batch を op-log レコードとして PDS へ書く (べき等)。
   *
   * rkey は `v1~<fileId>~<clock>~<batchId>` (Phase 7 p7-1, `batchRkey.ts`)。**ファイル単位の
   * 範囲取得を成り立たせるために fileId を先頭に置く**。決定論的なので、同じ batch を
   * 再送しても同じレコードを上書きする = べき等性は rkey=batchId だった頃と変わらない。
   *
   * 運搬単位が `Batch` ではなく `RemoteBatch` (Batch + fileId) なのは、ATProto の batch
   * コレクションが **repo 全体で 1 つ**で、レコード自身が適用先ファイルを持たないと
   * 受信側が復元できないため (Phase 4d-1, 設計 §3.1)。rkey にも fileId が入るが、
   * **適用先の権威はボディの `fileId`** — rkey は取得経路の索引にすぎない。
   */
  async pushRemote(entries: readonly RemoteBatch[]): Promise<void> {
    await this.uploadReferencedBlobs(entries);
    for (const { batch, fileId } of entries) {
      await this.batches.put(
        batchRkey(fileId, batch.clock, batch.id),
        batchToRecord(batch, fileId),
      );
    }
  }

  /**
   * **remote にまだ無い** batch をまとめて書く (Phase 7 p7-4 の移行専用)。
   *
   * `pushRemote` (1 件 = 1 `putRecord` = repo commit 1 回) では、移行のように
   * ローカル正典の全 batch を書き直す規模で commit 費用が支配的になる。`applyWrites` は
   * 1 リクエスト = 1 commit に最大 200 件を畳めるので、実測で約 20 倍速い (設計 §5.4)。
   *
   * **べき等ではない** — 既存の rkey が 1 件でも混ざるとそのチャンクが丸ごと失敗する
   * (PDS は 500 を返し、書込は原子的に巻き戻る)。呼び出し側 (`migrateRemoteRkey`) が
   * 範囲取得で「新形式でまだ書かれていない batch」だけを渡す責務を負う。
   * 通常の送信 (outbox の再送) は**べき等な `pushRemote` のまま**である。
   */
  async createRemote(entries: readonly RemoteBatch[]): Promise<void> {
    // 移行でも blob は先に上げる。移行は「ローカル正典のうち新 rkey でまだ
    // 書かれていない batch」を書くので、S5 以降に作った画像がそこに混ざりうる
    await this.uploadReferencedBlobs(entries);
    await this.batches.createMany(
      entries.map(({ batch, fileId }) => ({
        rkey: batchRkey(fileId, batch.clock, batch.id),
        data: batchToRecord(batch, fileId),
      })),
    );
  }

  /**
   * remote の batch レコードを**全件**取得する — **移行 (p7-4) 専用** (Phase 4d-4 / p7-5)。
   *
   * **既読位置 (cursor) を持たない**。4d-3 までは clock を符号化した cursor を返して
   * いたが、clock は端末をまたぐと単調でないため取りこぼす (設計 §1.3)。かといって
   * ATProto 側にも既読位置に使える値が無い:
   *
   * - `listRecords` の cursor は **rkey 位置**。本実装の rkey は batchId (ランダム UUID)
   *   なので順序が時系列にならず、後から書いた batch の UUID が保存済み cursor より
   *   小さいと永久に取りこぼす。**clock cursor と同じバグの構造**。
   * - `indexedAt` は repo の `listRecords` 出力に存在しない (appview 側の概念)。
   * - `rev` はレコード単位では露出しない (`com.atproto.sync.*` が要る)。
   *
   * → **既読位置を持たない契約にした**。取りこぼしゼロを構造的に保証し、二重取り込みは
   * 受信側 (`EventStore.appendReceivedBatches`, 4d-0) のべき等性が無害化する。
   * 代償は毎回 O(全履歴) の list だが、起動契機は起動時 + `online` + 手動に限られる
   * (§3.4 で subscribe を不採用としたため) ので受容できる。
   *
   * **p7-5 で残った消費者は移行 (`migrateRemoteRkey`) だけになった**。受信・catch-up は
   * `pullRemoteForFile`、発見は `listRemoteFiles` へ移っている。移行だけが残るのは
   * 代替が無いためで、**旧 rkey のレコードは新経路の走査範囲に現れない** (§3.1 の
   * `v1~` 分離が効くのは新形式の側だけ)。名前で 1 回限りの用途を固定している。
   * 既読位置を持たない契約は新経路でも維持している (上記 3 つの理由は今も有効, §2.2)。
   *
   * 返すのは `Batch` ではなく `RemoteBatch` (Batch + fileId)。remote の batch
   * コレクションは repo 全体で 1 つなので、適用先ファイルは受信側で復元できない (§3.1)。
   */
  async pullAllRemoteForMigration(): Promise<RemoteBatch[]> {
    return toRemoteBatches(await this.batches.listAllForMigration());
  }

  /**
   * remote の batch レコードのうち **1 ファイル分だけ**を取得する (Phase 7 p7-2)。
   *
   * rkey が `v1~<fileId>~…` になった (p7-1) ので、そのファイルのレコードは rkey 空間で
   * 連続する。`collections.batches.listByFile` が合成 cursor で先頭へ seek し、prefix を
   * 外れた時点で止めるので、**取得量が repo 全体ではなくそのファイルの履歴に比例する**
   * (設計 §3.2)。旧 rkey のレコードは `v1~` より小さく、走査に現れない (§3.1)。
   *
   * **既読位置 (cursor) は持たない** — 全件版と同じ契約である。毎回そのファイルの
   * 先頭から読み、二重取り込みは受信側 (`EventStore.appendReceivedBatches`) のべき等性が
   * 無害化する。変わったのは 1 回の取得量だけで、取りこぼしゼロの保証は構造のまま (§2.2)。
   *
   * 返すのが `Batch` ではなく `RemoteBatch` なのは全件版と同じ理由 (§3.1) だが、
   * ここでは `fileId` は引数と一致するはずである。**一致しない場合の扱いは呼び出し側に
   * 委ねる** — 不変条件 (孤児 batch を作らない, 4d 設計 §1.11 D-4) を rkey の正しさに
   * 依存させないため、`receiveRemoteBatches` 側の fileId フィルタを防御として残している。
   */
  async pullRemoteForFile(fileId: FileId): Promise<RemoteBatch[]> {
    return toRemoteBatches(await this.batches.listByFile(fileId));
  }

  /**
   * remote に存在するファイルを列挙する (Phase 7 p7-3 / ANA-127 S3)。
   *
   * 未知ファイルの発見 (`discoverRemoteFiles`) が必要とするのは、まず **fileId の集合**で
   * ある — batch 本体は未知ファイルの分だけあればよい。rkey が `v1~<fileId>~…` なので
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
 * レコード列を `RemoteBatch[]` へ翻訳する (全件取得・ファイル単位取得の共通後段)。
 *
 * `batch.id` は**レコードボディに無く rkey にしかない**ので、ここが唯一の復元点である
 * (rkey 形式と復元が食い違うと、同じ編集が別 id として正典に入りべき等 dedup が効かなくなる)。
 */
function toRemoteBatches(records: readonly RecordSummary[]): RemoteBatch[] {
  let skipped = 0;
  let malformedRkey = 0;
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
    // rkey から batch.id を復元する (Phase 7 p7-1)。新形式は第 4 セグメント、
    // 旧形式 (rkey = batchId) はそのまま。`v1~` で始まるのに割れないものだけ
    // 復元不能で、これも**数えて警告する**。
    const batchId = batchIdFromRkey(rkeyFromUri(r.uri));
    if (batchId === null) {
      malformedRkey += 1;
      continue;
    }
    entries.push(recordToRemoteBatch(batchId, r.value));
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
  if (malformedRkey > 0) {
    console.warn(
      `[atproto] skipped ${malformedRkey} batch record(s): rkey starts with ` +
        "'v1~' but does not parse as v1~<fileId>~<clock>~<batchId>",
    );
  }

  return entries;
}
