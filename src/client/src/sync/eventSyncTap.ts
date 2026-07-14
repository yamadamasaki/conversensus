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
 * - clock は Lamport。再起動後は初回 drain で永続ログ (provider.pull) の max clock を
 *   観測して `seed` し、発番を max+1 から再開する (W3)。復元前は event を保留し、
 *   restore 成功後に FIFO 順で tick を割り当てる (再起動をまたいだ単調性の保証)。
 */

import { type Batch, LamportClock, type SheetId } from '@conversensus/shared';
import type { GraphEvent } from '../events/GraphEvent';
import { graphEventToBatch, graphEventToOps } from '../events/toUnified';
import { type FlushResult, Outbox } from './outbox';
import { INITIAL_CURSOR, type SyncProvider } from './syncProvider';

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
  /** restore (clock の seed) の一度きり実行を保持する。失敗時は undefined に戻し再試行 */
  private restored?: Promise<void>;
  /**
   * restore 完了前に届いた event の保留 (FIFO)。tick は drain 時に割り当てる。
   * sheetId は content 経路の発生元シート (structure 経路は undefined)。
   */
  private pendingEvents: Array<{ event: GraphEvent; sheetId?: SheetId }> = [];

  constructor(deps: EventSyncTapDeps) {
    this.provider = deps.provider;
    this.clock = deps.clock ?? new LamportClock();
    this.outbox = deps.outbox ?? new Outbox();
    this.onError = deps.onError;
  }

  /**
   * dispatch された GraphEvent を記録する。
   * ops を生じる event だけを保留し、flush (restore→tick→push) をスケジュールする。
   * content 経路は発生元シートの `sheetId` を渡し、structure 経路は省略する (W3c2)。
   */
  record(event: GraphEvent, sheetId?: SheetId): void {
    // 同期対象の op を生じない event (空 ops) は clock も消費せずスキップ
    if (graphEventToOps(event).length === 0) return;
    // clock は restore 後に割り当てるため、ここでは event と sheetId を対で保留する
    this.pendingEvents.push({ event, sheetId });
    this.scheduleFlush();
  }

  /** 現在保留中の (未 push) 件数: restore 待ちの event + outbox の batch */
  get pending(): number {
    return this.pendingEvents.length + this.outbox.size;
  }

  /** これまでにスケジュールされた flush の完了を待つ (テスト・保存前フラッシュ用) */
  async settled(): Promise<void> {
    await this.flushChain;
  }

  /**
   * 永続ログの max clock を観測して clock を seed する (一度きり)。
   * provider-agnostic にするため cursor ではなく batch.clock の最大値を使う。
   * 失敗時は seed せず restored を落とし、次の drain で再試行する。
   */
  private ensureRestored(): Promise<void> {
    if (!this.restored) {
      this.restored = this.provider
        .pull(INITIAL_CURSOR)
        .then((result) => {
          const maxClock = result.batches.reduce(
            (m, b) => Math.max(m, b.clock),
            0,
          );
          this.clock.seed(maxClock);
        })
        .catch((error) => {
          this.restored = undefined;
          this.onError?.(error);
          throw error;
        });
    }
    return this.restored;
  }

  private scheduleFlush(): void {
    this.flushChain = this.flushChain.then(() => this.drain());
  }

  /**
   * restore→保留 event の Batch 化 (tick 割当)→flush を行う。
   * restore 失敗時は event を保留したまま打ち切り、次の record で再試行する。
   * flush 失敗 (オフライン) 時も Outbox が保留を維持し次回再送する。
   */
  private async drain(): Promise<void> {
    try {
      await this.ensureRestored();
    } catch {
      return; // restore 未了: event は pendingEvents に残し次回再試行 (onError 済み)
    }
    // restore 済み: 保留 event を FIFO 順に tick して Batch 化し Outbox へ移す
    while (this.pendingEvents.length > 0) {
      const { event, sheetId } = this.pendingEvents.shift() as {
        event: GraphEvent;
        sheetId?: SheetId;
      };
      const batch = graphEventToBatch(event, this.clock.tick(), sheetId);
      this.outbox.enqueue([batch]);
    }
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
