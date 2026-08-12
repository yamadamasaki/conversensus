/**
 * Outbox: remote へ未 push の項目を保持する送信キュー (step1 Phase 4b)
 *
 * architecture §6 の「オフライン時: provider 呼び出しをスキップし操作を outbox に積む。
 * 復帰時に flush」を担う。UI は常にローカル正典を読むので編集は途切れない。
 *
 * **オフライン分岐**は Outbox 内に online フラグを持たず、`flush` の結果で表現する:
 *   - push が resolve → 該当項目を除去 (送信完了)
 *   - push が reject (オフライン等) → 保留を維持 (次回 flush で再送)
 * 呼び出し側 (再接続検知・定期 flush) が flush の起動タイミングを決める。
 *
 * **保持する項目の型は呼び出し側が決める** (Phase 4d-1 で一般化)。ローカル正典向けは
 * `Batch`、remote 向けは `RemoteBatch` (Batch + fileId) を積む — remote の batch コレクションは
 * repo 全体で 1 つなので fileId を添えて運ぶ必要がある。重複排除に使う id の取り出し方だけ
 * `getId` で受け取り、キューの論理 (FIFO・べき等・上限) は型に依らず共通にする。
 *
 * 永続化 (リロードをまたぐ保留の生存) は、ローカル正典ログ (EventStore) 上の
 * watermark として持たせる配線で後続 (Phase 3 引き継ぎ) に委ねる。本スライスは
 * インメモリのデータ構造と flush 契約に集中する。
 */

/**
 * push が**一部だけ成功した**ことを伝える例外 (ANA-116 レビュー D2)。
 *
 * 既定の失敗 (素の例外) は「全件保留」— オフラインのように**どれも送れていない**
 * 原因ではそれが正しい。しかし 1 件だけが構造的に送れない場合 (例: 参照する画像 blob の
 * 実体がこの端末に無く、PDS が `Could not find blob` で拒む) は、全件保留にすると
 * **無関係なファイルの batch まで一緒に再送され続ける**。
 *
 * push 側が「どこまで送れたか」を知っているときはこれを投げる。Outbox は
 * `sentIds` の分だけ除去し、残りを保留に維持する = 失敗の境界が項目単位になる。
 */
export class PartialPushError extends Error {
  /** 送信できた項目の id (`getId` と同じ値) */
  readonly sentIds: readonly string[];

  constructor(
    sentIds: readonly string[],
    /** 送れなかった項目の最初の原因。`FlushResult.error` にはこれが入る */
    cause: unknown,
  ) {
    super('push partially failed', { cause });
    this.name = 'PartialPushError';
    this.sentIds = sentIds;
  }
}

/** `flush` の結果 */
export type FlushResult = {
  /** push が成功したか。false = オフライン等で保留継続、または flush 実行中 */
  ok: boolean;
  /** 送信・除去できた項目数 */
  flushed: number;
  /** ok=false のときの原因 (push の reject 理由 / 実行中エラー) */
  error?: unknown;
  /**
   * 部分成功 (`PartialPushError`) だったか。`ok=false` かつ `flushed>0` の状態を
   * 「オフラインで 0 件」と区別できるようにする — 呼び出し側の UI 文言が変わる。
   */
  partial?: boolean;
};

export class Outbox<T> {
  /** 未 push の項目 (FIFO)。enqueue 順を保つ */
  private queue: T[] = [];
  /** 重複 enqueue 防止用の id 集合 (queue と同期) */
  private readonly ids = new Set<string>();
  /** 項目から重複排除キーを取り出す */
  private readonly getId: (item: T) => string;
  /** flush 多重起動の防止 */
  private flushing = false;
  /**
   * 保持件数の上限 (bounded FIFO)。既定は無制限 (Infinity) で従来挙動。
   * remote 用途 (RemoteSyncQueue, W3d5-3) では有限値を渡し、無制限成長を防ぐ (D1)。
   */
  private readonly capacity: number;
  /** 上限超過で eviction が一度でも起きたか (latching)。UI の「N 件以上」表示用 */
  private overflowedFlag = false;

  constructor(
    getId: (item: T) => string,
    capacity: number = Number.POSITIVE_INFINITY,
  ) {
    this.getId = getId;
    this.capacity = capacity;
  }

  /** 項目をキュー末尾へ積む。既に保留中の id は無視する (べき等) */
  enqueue(items: readonly T[]): void {
    for (const item of items) {
      const id = this.getId(item);
      if (this.ids.has(id)) continue;
      this.queue.push(item);
      this.ids.add(id);
    }
    this.evictToCapacity();
  }

  /** 上限を超えた分だけ最古 (FIFO の先頭) から落とす。溢れた項目はローカル正典に
   *  残るので catch-up で回収でき、データは失われない (D1)。 */
  private evictToCapacity(): void {
    while (this.queue.length > this.capacity) {
      const evicted = this.queue.shift();
      if (evicted !== undefined) this.ids.delete(this.getId(evicted));
      this.overflowedFlag = true;
    }
  }

  /** 上限超過で eviction が起きたか (このインスタンスの生存期間で一度でも) */
  get overflowed(): boolean {
    return this.overflowedFlag;
  }

  /** 現在の保留項目 (FIFO のコピー) */
  pending(): T[] {
    return [...this.queue];
  }

  get size(): number {
    return this.queue.length;
  }

  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * 保留項目を `push` へ送る。
   * 成功時は「送信に出したスナップショット分だけ」を id 指定で除去する
   * (in-flight 中に enqueue された新規分は失わない)。
   * 失敗 (オフライン) 時は保留を維持し、次回 flush で再送できる。
   *
   * push が `PartialPushError` を投げた場合だけ、**送れた分は除去し残りを保留**する
   * (項目単位の失敗境界, ANA-116 レビュー D2)。
   */
  async flush(push: (items: T[]) => Promise<void>): Promise<FlushResult> {
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
      await push(snapshot);
      this.removeIds(snapshot.map((item) => this.getId(item)));
      return { ok: true, flushed: snapshot.length };
    } catch (error) {
      if (error instanceof PartialPushError) {
        // 項目単位の失敗境界: 送れた分だけ除去し、送れなかった分は保留に残す
        this.removeIds(error.sentIds);
        return {
          ok: false,
          flushed: error.sentIds.length,
          error: error.cause,
          partial: true,
        };
      }
      // オフライン等: 保留を維持し呼び出し側に通知する (再送は次回 flush)
      return { ok: false, flushed: 0, error };
    } finally {
      this.flushing = false;
    }
  }

  /** 指定 id の項目を queue から除く (in-flight 中に積まれた新規分は残る) */
  private removeIds(ids: readonly string[]): void {
    const sentIds = new Set(ids);
    this.queue = this.queue.filter((item) => !sentIds.has(this.getId(item)));
    for (const id of sentIds) this.ids.delete(id);
  }
}
