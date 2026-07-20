/**
 * RemoteSyncQueue: remote (ATProto) への未送信を破棄せず保持する再送キュー (step1 W3d5-3)
 *
 * ローカル正典 (daemon op-log) 向けの `Outbox` とは**別建て**の、remote 専用キュー
 * (設計 §3.1 / §3.6)。remote が落ちても編集フロー (ローカル正典) は前進し、未送信は
 * このキューに残って UI に「クラウド未同期: N 件」として現れ、自動/手動再送で回復する。
 * 純 fire-and-forget (サイレント消失) を採らないための中核。
 *
 * - **enqueue**: remote leg のフィルタ (`filterBatchesForRemote`: genesis actor 除外 +
 *   presentation 除外, §3.2/§3.5) を内部で適用してから積む。フィルタで空になれば積まない。
 * - **flush (best-effort)**: 内包 `Outbox` 経由で remote provider へ push。成功→除去、
 *   失敗→保持 (破棄しない)。失敗は編集フローに波及しない。
 * - **catch-up**: remote を全件 pull し、remote に無いローカル batch を積み直して flush する
 *   (取りこぼし回収)。本スライスでは**メソッドのみ提供**し、起動時/再接続時の自動呼び出しは
 *   W3d5-5 で配線する。catch-up 1 回 = remote 全件 pull 1 回のコスト (D2)。
 * - **上限 (D1)**: 内包 `Outbox` に `REMOTE_QUEUE_MAX` を渡し無制限成長を防ぐ。溢れた分は
 *   ローカル正典に残るため catch-up で回収でき、データは失われない。
 * - **pending 公開**: 未送信件数を購読可能にし (§3.7 UI 用)、tap の pending に合流させる。
 */

import type { Batch, FileId } from '@conversensus/shared';
import type { FlushResult } from '../sync/outbox';
import { Outbox } from '../sync/outbox';
import type { Cursor, PullResult, Unsubscribe } from '../sync/syncProvider';
import { INITIAL_CURSOR } from '../sync/syncProvider';
import { filterBatchesForRemote } from './remoteFilter';
import type { RemoteBatch } from './types';

/**
 * remote op-log の送信先 (Phase 4d-1)。
 *
 * `SyncProvider` ではなく専用の型にする — `SyncProvider` はファイル単位の境界だが、
 * ATProto の batch コレクションは **repo 全体で 1 つ**なので、送信単位は fileId を
 * 添えた `RemoteBatch` になる。この非対称が型に現れるようにしている。
 */
export interface RemoteBatchTarget {
  pushRemote(entries: readonly RemoteBatch[]): Promise<void>;
  pull(since: Cursor): Promise<PullResult>;
}

/** remote キューのセッション内保持上限 (直近 N 件)。溢れは catch-up で回収 (D1) */
export const REMOTE_QUEUE_MAX = 500;

/** pending 件数の変化を受け取るリスナ */
export type PendingListener = (count: number) => void;

export type RemoteSyncQueueDeps = {
  /** remote op-log (AtprotoSyncProvider 等)。flush / catch-up の送信先・取得元 */
  provider: RemoteBatchTarget;
  /** 保持上限 (直近 N 件)。既定 REMOTE_QUEUE_MAX */
  capacity?: number;
};

export class RemoteSyncQueue {
  private readonly outbox: Outbox<RemoteBatch>;
  private readonly provider: RemoteBatchTarget;
  private readonly listeners = new Set<PendingListener>();

  constructor(deps: RemoteSyncQueueDeps) {
    this.provider = deps.provider;
    // 重複排除は batch id で行う (fileId は運搬のために添えるだけ)
    this.outbox = new Outbox<RemoteBatch>(
      (entry) => entry.batch.id,
      deps.capacity ?? REMOTE_QUEUE_MAX,
    );
  }

  /**
   * remote へ送る batch を積む。genesis actor 除外・presentation 除外は enqueue 内で適用する
   * ので、呼び出し側は生の batch 列を渡してよい。フィルタ後に何も残らなければ何もしない。
   */
  enqueue(batches: readonly Batch[], fileId: FileId): void {
    const filtered = filterBatchesForRemote(batches);
    if (filtered.length === 0) return;
    // fileId は remote レコードに埋め込む必要があるのでここで添える (§3.1)
    this.outbox.enqueue(filtered.map((batch) => ({ fileId, batch })));
    this.notify();
  }

  /**
   * 保留を remote provider へ best-effort に送る。成功→除去、失敗→保持 (破棄しない)。
   * 失敗は呼び出し側 (§3.7 の手動再送・catch-up) に FlushResult で通知される。
   */
  async flush(): Promise<FlushResult> {
    const result = await this.outbox.flush((entries) =>
      this.provider.pushRemote(entries),
    );
    this.notify();
    return result;
  }

  /**
   * 取りこぼし回収。remote を全件 pull し、remote に無いローカル batch を積み直して flush する。
   * `localBatches` はローカル正典の全 batch (呼び出し側が渡す)。genesis 除外は enqueue 内で
   * 適用されるので remote に genesis を積むことはない (C1)。
   *
   * 本スライスではメソッドのみ。起動時/再接続時の自動呼び出しは W3d5-5 で配線する。
   * コスト: pull は clock>cursor の全件 list なので catch-up 1 回 = 全件 pull 1 回 (D2)。
   */
  async catchUp(
    localBatches: readonly Batch[],
    fileId: FileId,
  ): Promise<FlushResult> {
    const { batches: remoteBatches } = await this.provider.pull(INITIAL_CURSOR);
    const remoteIds = new Set(remoteBatches.map((b) => b.id));
    const missing = localBatches.filter((b) => !remoteIds.has(b.id));
    this.enqueue(missing, fileId);
    return this.flush();
  }

  /** 現在の未送信件数 */
  get pendingCount(): number {
    return this.outbox.size;
  }

  /** 現在の未送信項目 (FIFO のコピー) */
  pending(): RemoteBatch[] {
    return this.outbox.pending();
  }

  /** 上限超過で eviction が起きたか (UI の「N 件以上」表示用, D1) */
  get overflowed(): boolean {
    return this.outbox.overflowed;
  }

  /**
   * pending 件数の変化を購読する (§3.7 UI 用)。登録直後に現在値を 1 回通知する。
   * 返り値で解除する。
   */
  subscribe(listener: PendingListener): Unsubscribe {
    this.listeners.add(listener);
    listener(this.pendingCount);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const count = this.pendingCount;
    for (const listener of this.listeners) listener(count);
  }
}
