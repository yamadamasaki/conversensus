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
 * - pullRemote: batch レコードを**全件**取得。**既読位置 (cursor) を持たない** (Phase 4d-4) —
 *   rkey が UUID で時系列順にならず、ATProto 側に既読位置へ使える値が無いため。
 *   取りこぼしゼロを構造で保証し、二重取り込みは受信側のべき等性が無害化する。
 * - subscribe: 定期 poll で新規 batch を配信 (観測済み id 集合との差分のみ)。
 *   消費箇所は 0 件。Jetstream 購読への置き換えは別 Phase (§3.4)。
 *
 * 依存 (batch collection / scheduler) は注入可能にし、PDS・タイマー非依存にテストする。
 */

import type { Unsubscribe } from '../sync';
import {
  batchToRecord,
  isBatchRecordValue,
  recordToRemoteBatch,
} from './batchMapper';
import { batchIdFromRkey, batchRkey } from './batchRkey';
import type { RemoteBatchTarget } from './remoteSyncQueue';
import type { BatchRecord, RecordResult, RemoteBatch } from './types';

/** 新着 remote batch の配信先。fileId が要るので `Batch[]` ではなく `RemoteBatch[]` */
export type OnRemoteBatches = (entries: readonly RemoteBatch[]) => void;

/** op-log コレクションの最小インターフェース (実体は collections.batches) */
export interface BatchCollection {
  put(batchId: string, data: Omit<BatchRecord, '$type'>): Promise<RecordResult>;
  list(): Promise<Array<{ uri: string; cid: string; value: unknown }>>;
}

/** 定期実行のスケジューラ (既定は setInterval)。テストで差し替え可能 */
export interface IntervalScheduler {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const DEFAULT_SCHEDULER: IntervalScheduler = {
  set: (cb, ms) => setInterval(cb, ms),
  clear: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

/** subscribe の既定 poll 間隔 (開発向け)。4d の Jetstream 化まで暫定 */
export const SUBSCRIBE_INTERVAL_MS = 10_000;

export type AtprotoSyncProviderDeps = {
  batches: BatchCollection;
  scheduler?: IntervalScheduler;
  intervalMs?: number;
};

function rkeyFromUri(uri: string): string {
  return uri.split('/').at(-1) ?? uri;
}

export class AtprotoSyncProvider implements RemoteBatchTarget {
  private readonly batches: BatchCollection;
  private readonly scheduler: IntervalScheduler;
  private readonly intervalMs: number;

  constructor(deps: AtprotoSyncProviderDeps) {
    this.batches = deps.batches;
    this.scheduler = deps.scheduler ?? DEFAULT_SCHEDULER;
    this.intervalMs = deps.intervalMs ?? SUBSCRIBE_INTERVAL_MS;
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
    for (const { batch, fileId } of entries) {
      await this.batches.put(
        batchRkey(fileId, batch.clock, batch.id),
        batchToRecord(batch, fileId),
      );
    }
  }

  /**
   * remote の batch レコードを**全件**取得する (Phase 4d-4)。
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
   * **Phase 7 で「repo 全体 → 1 ファイル」に絞る** (`v1~<fileId>~…` の rkey に対する
   * prefix 範囲取得, p7-2)。**既読位置を持たない契約自体は維持する** — 上記 3 つの理由は
   * 今も有効で、変わるのは 1 回の取得量だけ (設計 §1.4 / §2.2)。この関数は p7-5 で退役する。
   *
   * 返すのは `Batch` ではなく `RemoteBatch` (Batch + fileId)。remote の batch
   * コレクションは repo 全体で 1 つなので、適用先ファイルは受信側で復元できない (§3.1)。
   */
  async pullRemote(): Promise<RemoteBatch[]> {
    const records = await this.batches.list();

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

    // 決定論的な順序で返す: clock → actor → id (`orderBatches` と同じ規則, 4d-3)
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

  /**
   * remote の新規 batch を購読する。
   * 初回 poll は既知集合を埋める baseline 確立のみ (再配信を避ける)。
   * 以降の poll で**初めて見た id** の batch だけを onRemote へ渡す。
   *
   * **既読管理を cursor から「観測済み id 集合」へ変えた (Phase 4d-4)**。cursor 版には
   * baseline 確立が失敗すると次の成功 poll が baseline になり、その間の batch を
   * **恒久的に落とす**欠陥があった (設計 §1.5)。id 集合なら poll が失敗しても集合は
   * 前進しないので、次の成功 poll で取りこぼし分がそのまま現れる。
   *
   * 消費箇所は現在 0 件 — §3.4 のとおり subscribe は採用せず、起動時 + `online` + 手動で
   * 駆動する。Jetstream 化と `list()` のページングを併せて別 Phase で作り直す。
   */
  subscribe(onRemote: OnRemoteBatches): Unsubscribe {
    const seen = new Set<string>();
    let baselined = false;

    const tick = async () => {
      const entries = await this.pullRemote();
      const fresh = entries.filter((e) => !seen.has(e.batch.id));
      for (const e of entries) seen.add(e.batch.id);
      if (!baselined) {
        baselined = true; // 初回は基準確立のみ、配信しない
        return;
      }
      if (fresh.length > 0) onRemote(fresh);
    };

    const handle = this.scheduler.set(() => {
      tick().catch((err) =>
        console.warn('[atproto] subscribe poll error:', err),
      );
    }, this.intervalMs);

    return () => this.scheduler.clear(handle);
  }
}
