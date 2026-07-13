/**
 * EventSyncTap: dispatch された GraphEvent を操作ログへ流す tap (step1 Phase 4 実配線 W2)
 *
 * 漸進移行の要。既存の `GraphEvent` / undo-redo 機構はそのまま残し、dispatch された
 * event を `toUnified` で `Batch` へ変換して Outbox に積み、`SyncProvider` へ flush する。
 * これにより「編集 = 操作ログの追記」が成立し、op-log が実際の永続になる。
 *
 * - 同期対象の op を生じない event (空 ops) はスキップする。
 * - flush はチェーンで直列化し、Outbox の多重起動を避ける。オフライン時は保留を維持し、
 *   次の record で再試行する (Outbox のオフライン分岐)。
 * - clock は Lamport。再起動後の復元 (server の max clock 観測) は後続で配線する。
 */

import { type Batch, LamportClock } from '@conversensus/shared';
import type { GraphEvent } from '../events/GraphEvent';
import { graphEventToBatch, graphEventToOps } from '../events/toUnified';
import { type FlushResult, Outbox } from './outbox';
import type { SyncProvider } from './syncProvider';

export type EventSyncTapDeps = {
  provider: SyncProvider;
  clock?: LamportClock;
  outbox?: Outbox;
  /** flush がオフライン等で失敗したときの通知 (保留は維持される) */
  onError?: (error: unknown) => void;
};

export class EventSyncTap {
  private readonly provider: SyncProvider;
  private readonly clock: LamportClock;
  private readonly outbox: Outbox;
  private readonly onError?: (error: unknown) => void;
  /** flush を直列化するチェーン */
  private flushChain: Promise<void> = Promise.resolve();

  constructor(deps: EventSyncTapDeps) {
    this.provider = deps.provider;
    this.clock = deps.clock ?? new LamportClock();
    this.outbox = deps.outbox ?? new Outbox();
    this.onError = deps.onError;
  }

  /**
   * dispatch された GraphEvent を記録する。
   * ops を生じる event だけを Batch 化して積み、flush をスケジュールする。
   */
  record(event: GraphEvent): void {
    // 同期対象の op を生じない event (空 ops) は clock も消費せずスキップ
    if (graphEventToOps(event).length === 0) return;
    const batch = graphEventToBatch(event, this.clock.tick());
    this.outbox.enqueue([batch]);
    this.scheduleFlush();
  }

  /** 現在保留中の (未 push) batch 数 */
  get pending(): number {
    return this.outbox.size;
  }

  /** これまでにスケジュールされた flush の完了を待つ (テスト・保存前フラッシュ用) */
  async settled(): Promise<void> {
    await this.flushChain;
  }

  private scheduleFlush(): void {
    this.flushChain = this.flushChain.then(() => this.drain());
  }

  /** 保留がなくなるまで flush する。失敗 (オフライン) 時は保留を残して打ち切る */
  private async drain(): Promise<void> {
    while (!this.outbox.isEmpty) {
      const result: FlushResult = await this.outbox.flush(this.provider);
      if (!result.ok) {
        if (result.error) this.onError?.(result.error);
        return; // 保留は次の record で再試行
      }
    }
  }

  /** テスト用: 積まれた batch のスナップショット */
  peekPending(): Batch[] {
    return this.outbox.pending();
  }
}
