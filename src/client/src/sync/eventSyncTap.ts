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
 * - 点 (clock・seq・deps) は `CausalClock` が振る (step3 Phase 1 D1)。再起動後は初回 drain で
 *   永続ログ (provider.pull) から発番器を復元し、続きから振る (W3)。復元前は event を保留し、
 *   restore 成功後に FIFO 順で点を割り当てる (再起動をまたいだ単調性の保証)。
 * - 発番器は trunk・branch・判断ログで**共有する**ので、外から渡せる (`causal`)。
 */

import {
  type Actor,
  type Batch,
  CausalClock,
  type Lamport,
  type ObservedPoint,
  type SheetId,
} from '@conversensus/shared';
import type { GraphEvent } from '../events/GraphEvent';
import { graphEventToBatch, graphEventToOps } from '../events/toUnified';
import { type FlushResult, Outbox } from './outbox';
import { INITIAL_CURSOR, type SyncProvider } from './syncProvider';

export type EventSyncTapDeps = {
  provider: SyncProvider;
  /**
   * 因果の発番器。**trunk とその branch・判断ログで同じものを渡す** (`CausalClock` の冒頭)。
   * 省略すると、この tap だけの発番器を作る (テスト用)
   */
  causal?: CausalClock;
  outbox?: Outbox<Batch>;
  /**
   * この端末の操作主体 (Phase 4d-2)。`<did>#<deviceId>` (未ログインは `local#<deviceId>`)。
   * batch に載って remote へ渡り、受信側で因果順序と重複排除の単位を識別するのに使う。
   */
  actor: Actor;
  /**
   * この op-log の発番下限 (step1 Phase 5 p5-4)。restore 時に
   * `max(永続ログの max clock, clockFloor)` を seed する。
   *
   * branch 用: branch の op-log は空から始まるので、放っておくと発番が 1 から再開し
   * **base 時点の trunk batch より小さい clock** になる。`branchSheet` は
   * 「base までの trunk + branch batches」を projection するので、それでは branch の
   * 編集が base の内容に LWW で負ける。`clockFloor = base.at` で「branch は分岐点の
   * 続きから発番する」を成立させる。trunk では不要 (指定しない)。
   */
  clockFloor?: Lamport;
  /** flush がオフライン等で失敗したときの通知 (保留は維持される) */
  onError?: (error: unknown) => void;
};

export class EventSyncTap {
  private readonly provider: SyncProvider;
  private readonly causal: CausalClock;
  private readonly outbox: Outbox<Batch>;
  private readonly actor: Actor;
  private readonly clockFloor: Lamport;
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
    this.causal = deps.causal ?? new CausalClock(deps.actor);
    this.outbox = deps.outbox ?? new Outbox<Batch>((b) => b.id);
    this.actor = deps.actor;
    this.clockFloor = deps.clockFloor ?? 0;
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
          this.causal.restore(result.batches);
          // clockFloor は「このログが継ぐ分岐点」(branch のみ)。空ログでも下限を下回らない
          this.causal.seedClock(this.clockFloor);
        })
        .catch((error) => {
          this.restored = undefined;
          this.onError?.(error);
          throw error;
        });
    }
    return this.restored;
  }

  /**
   * 受信した batch (グラフ・判断ログとも) を観測し、発番器を追随させる。
   *
   * - **Lamport の受信規則** (Phase 4d-3): 以後に振る clock が受信分より必ず大きくなり、
   *   全順序が端末をまたいで「因果的に後」を表す
   * - **因果の知識への取り込み** (step3 Phase 1): 以後に書く batch の `deps` がこれを含む
   *
   * **書き込みが成功してから呼ぶこと**。取り込めなかった batch を知っていることにすると、
   * それに依存した batch を書いてしまう。
   */
  observeRemote(points: Iterable<ObservedPoint>): void {
    for (const point of points) this.causal.observe(point);
  }

  /**
   * この端末の clock を「自分で発番したが tap を通らなかった batch」のために操作する
   * (step1 Phase 5 p5-4)。merge の再スタンプが唯一の利用者。
   *
   * merge は branch batches を trunk 先端の後へ振り直して trunk op-log へ直接追記する
   * (`mergeBranchOnOplog`)。**その採番をこの clock で行わないと**、tap 側の clock は
   * 追記を知らないまま進み、次のローカル編集が merge 済み batch と**同じ actor で
   * 同じ clock** を発番しうる。同 (clock, actor) は順序が id 任せになり LWW の勝敗が
   * 不定になるため、発番器を分けずここへ集約する。
   */
  get clockControl(): { seed: (floor: Lamport) => void; tick: () => Lamport } {
    return {
      seed: (floor) => {
        this.causal.seedClock(floor);
      },
      tick: () => this.causal.tickClock(),
    };
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
      const batch = graphEventToBatch(event, {
        ...this.causal.issue(),
        actor: this.actor,
        sheetId,
      });
      this.outbox.enqueue([batch]);
    }
    while (!this.outbox.isEmpty) {
      const result: FlushResult = await this.outbox.flush((batches) =>
        this.provider.push(batches),
      );
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
