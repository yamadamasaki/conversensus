/**
 * Outbox: remote へ未 push の batches を保持する送信キュー (step1 Phase 4b)
 *
 * architecture §6 の「オフライン時: provider 呼び出しをスキップし操作を outbox に積む。
 * 復帰時に flush」を担う。UI は常にローカル正典を読むので編集は途切れない。
 *
 * **オフライン分岐**は Outbox 内に online フラグを持たず、`flush` の結果で表現する:
 *   - `provider.push` が resolve → 該当 batches を除去 (送信完了)
 *   - `provider.push` が reject (オフライン等) → 保留を維持 (次回 flush で再送)
 * 呼び出し側 (再接続検知・定期 flush) が flush の起動タイミングを決める。
 *
 * 永続化 (リロードをまたぐ保留の生存) は、ローカル正典ログ (EventStore) 上の
 * watermark として持たせる配線で後続 (Phase 3 引き継ぎ) に委ねる。本スライスは
 * インメモリのデータ構造と flush 契約に集中する。
 */

import type { Batch } from '@conversensus/shared';
import type { SyncProvider } from './syncProvider';

/** `flush` の結果 */
export type FlushResult = {
  /** push が成功したか。false = オフライン等で保留継続、または flush 実行中 */
  ok: boolean;
  /** 送信・除去できた batch 数 */
  flushed: number;
  /** ok=false のときの原因 (push の reject 理由 / 実行中エラー) */
  error?: unknown;
};

export class Outbox {
  /** 未 push の batches (FIFO)。enqueue 順を保つ */
  private queue: Batch[] = [];
  /** 重複 enqueue 防止用の batch id 集合 (queue と同期) */
  private readonly ids = new Set<string>();
  /** flush 多重起動の防止 */
  private flushing = false;
  /**
   * 保持件数の上限 (bounded FIFO)。既定は無制限 (Infinity) で従来挙動。
   * remote 用途 (RemoteSyncQueue, W3d5-3) では有限値を渡し、無制限成長を防ぐ (D1)。
   */
  private readonly capacity: number;
  /** 上限超過で eviction が一度でも起きたか (latching)。UI の「N 件以上」表示用 */
  private overflowedFlag = false;

  constructor(capacity: number = Number.POSITIVE_INFINITY) {
    this.capacity = capacity;
  }

  /** batches をキュー末尾へ積む。既に保留中の id は無視する (べき等) */
  enqueue(batches: Batch[]): void {
    for (const batch of batches) {
      if (this.ids.has(batch.id)) continue;
      this.queue.push(batch);
      this.ids.add(batch.id);
    }
    this.evictToCapacity();
  }

  /** 上限を超えた分だけ最古 (FIFO の先頭) から落とす。溢れた batch はローカル正典に
   *  残るので catch-up で回収でき、データは失われない (D1)。 */
  private evictToCapacity(): void {
    while (this.queue.length > this.capacity) {
      const evicted = this.queue.shift();
      if (evicted) this.ids.delete(evicted.id);
      this.overflowedFlag = true;
    }
  }

  /** 上限超過で eviction が起きたか (このインスタンスの生存期間で一度でも) */
  get overflowed(): boolean {
    return this.overflowedFlag;
  }

  /** 現在の保留 batches (FIFO のコピー) */
  pending(): Batch[] {
    return [...this.queue];
  }

  get size(): number {
    return this.queue.length;
  }

  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * 保留 batches を provider へ送る。
   * push 成功時は「送信に出したスナップショット分だけ」を id 指定で除去する
   * (in-flight 中に enqueue された新規分は失わない)。
   * push 失敗 (オフライン) 時は保留を維持し、次回 flush で再送できる。
   */
  async flush(provider: SyncProvider): Promise<FlushResult> {
    if (this.flushing) {
      return {
        ok: false,
        flushed: 0,
        error: new Error('flush already in progress'),
      };
    }
    const snapshot = [...this.queue];
    if (snapshot.length === 0) return { ok: true, flushed: 0 };

    this.flushing = true;
    try {
      await provider.push(snapshot);
      this.remove(snapshot);
      return { ok: true, flushed: snapshot.length };
    } catch (error) {
      // オフライン等: 保留を維持し呼び出し側に通知する (再送は次回 flush)
      return { ok: false, flushed: 0, error };
    } finally {
      this.flushing = false;
    }
  }

  /** スナップショットに含まれる batch を id 一致で queue から除く */
  private remove(sent: Batch[]): void {
    const sentIds = new Set(sent.map((b) => b.id));
    this.queue = this.queue.filter((b) => !sentIds.has(b.id));
    for (const id of sentIds) this.ids.delete(id);
  }
}
