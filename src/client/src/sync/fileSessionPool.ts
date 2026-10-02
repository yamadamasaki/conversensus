/**
 * FileSessionPool: 開いている File のセッションの置き場 (step3 Phase 3 S3-3c, 設計 §2.2)
 *
 * タブで複数の File を開くと、File ごとにセッション (tap・同期・受信) が要る。背後のタブの
 * File も同期を続ける (Q4) — 止めると切り替えた瞬間に古い姿が見え、受信の競合の通知も遅れる。
 *
 * 置き場が守ることは 2 つある。
 *
 * - **同じ File のセッションは 1 つ。**前に出ている view と背後のタブが同じ File を指しても、
 *   セッションを 2 つ作らない (同期が 2 本走り、outbox が 2 つに割れる)
 * - **発番器は File ごとに 1 つで、セッションより長く生きる。**ログインで remote キューが付くと
 *   セッションは作り直されるが、発番器は同じものを使い続ける。別々に作ると同じ点 `(actor, seq)` を
 *   2 回発番する (Phase 2 F4 と同じ壊れ方が 1 つのタブの中で起きる)
 *
 * ## 参照を「持ち手ごとの File の集合」で数える
 *
 * 持ち手 (前に出ている view、背後のタブ) は、自分が参照する File の集合を**丸ごと宣言する**
 * (`hold`)。数を足し引きしないので、同じ宣言を何度しても結果は変わらない。React の StrictMode は
 * 描画と effect を 2 度走らせるので、足し引きの参照数だと数がずれて、閉じたタブの File が同期を
 * 続ける。
 *
 * **止めるのは 1 拍遅らせる** (`setTimeout(0)`)。持ち手が離して (effect の後始末) すぐに持ち直す
 * (StrictMode の再実行、タブの切り替えで前と背後が入れ替わる) 間にセッションを作り直さない。
 */

import type { CausalClock, FileId } from '@conversensus/shared';

/** 置き場が扱うセッションの形。`start` は契機を張り、止める関数を返す */
export type PooledSession = {
  start: () => () => void;
};

/** File とその発番器からセッションを作る。remote キュー・名簿などの設定はこの中に閉じる */
export type SessionFactory<S extends PooledSession> = (
  fileId: FileId,
  causal: CausalClock,
) => S;

type Live<S> = { session: S; stop: () => void };

export class FileSessionPool<S extends PooledSession> {
  private readonly holds = new Map<string, ReadonlySet<FileId>>();
  private readonly live = new Map<FileId, Live<S>>();
  private readonly clocks = new Map<FileId, CausalClock>();
  private factory: SessionFactory<S> | null = null;
  private sweepTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly newClock: () => CausalClock;

  /** @param newClock File の発番器を作る (actor はこの中に閉じる) */
  constructor(newClock: () => CausalClock) {
    this.newClock = newClock;
  }

  /**
   * セッションの作り方を差し替える (ログインで remote キューが付いた、など)。
   * **生きているセッションは作り直す。発番器は引き継ぐ。**同じ作り方なら何もしない
   */
  setFactory(factory: SessionFactory<S>): void {
    if (this.factory === factory) return;
    this.factory = factory;
    for (const [fileId, entry] of this.live) {
      entry.stop();
      this.live.set(fileId, this.launch(fileId, factory));
    }
  }

  /** File の発番器。セッションが無くても返す (セッションより長く生きる) */
  causalOf(fileId: FileId): CausalClock {
    let clock = this.clocks.get(fileId);
    if (!clock) {
      clock = this.newClock();
      this.clocks.set(fileId, clock);
    }
    return clock;
  }

  /**
   * 持ち手が参照する File の集合を宣言する。足りないセッションはすぐ作り、要らなくなった
   * セッションは 1 拍遅れて止める。作り方がまだ無ければ作らない (`setFactory` の後で作る)
   */
  hold(holder: string, fileIds: Iterable<FileId>): void {
    const next = new Set(fileIds);
    const prev = this.holds.get(holder);
    // 同じ宣言なら止めるものは増えない (描画のたびに呼ばれる)
    const changed =
      !prev || prev.size !== next.size || [...next].some((id) => !prev.has(id));
    this.holds.set(holder, next);
    const factory = this.factory;
    if (factory) {
      for (const fileId of this.heldFileIds()) {
        if (!this.live.has(fileId))
          this.live.set(fileId, this.launch(fileId, factory));
      }
    }
    if (changed) this.scheduleSweep();
  }

  /** 持ち手が離す (= 何も参照しないと宣言する) */
  release(holder: string): void {
    this.holds.delete(holder);
    this.scheduleSweep();
  }

  /** File のセッション。誰も持っていなければ (または作り方がまだ無ければ) undefined */
  session(fileId: FileId): S | undefined {
    return this.live.get(fileId)?.session;
  }

  /** 生きているセッション (「今すぐ同期」を全部の File に効かせる) */
  sessions(): S[] {
    return [...this.live.values()].map((e) => e.session);
  }

  /** 全部止める (置き場ごと捨てるとき) */
  dispose(): void {
    clearTimeout(this.sweepTimer);
    for (const entry of this.live.values()) entry.stop();
    this.live.clear();
    this.holds.clear();
  }

  private launch(fileId: FileId, factory: SessionFactory<S>): Live<S> {
    const session = factory(fileId, this.causalOf(fileId));
    return { session, stop: session.start() };
  }

  private heldFileIds(): Set<FileId> {
    const all = new Set<FileId>();
    for (const ids of this.holds.values()) for (const id of ids) all.add(id);
    return all;
  }

  private scheduleSweep(): void {
    clearTimeout(this.sweepTimer);
    this.sweepTimer = setTimeout(() => this.sweep(), 0);
  }

  /** 誰も持っていないセッションを止める */
  private sweep(): void {
    const held = this.heldFileIds();
    for (const [fileId, entry] of this.live) {
      if (held.has(fileId)) continue;
      entry.stop();
      this.live.delete(fileId);
    }
  }
}
