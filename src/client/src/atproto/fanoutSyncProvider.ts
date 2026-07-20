/**
 * FanoutSyncProvider: ローカル正典 + remote 再送キューを束ねる合成 SyncProvider (step1 W3d5-4)
 *
 * tap の**単一 provider モデルを崩さず** (設計 §3.1)、1 つの `SyncProvider` の顔をしたまま
 * 内部で 2 系統へ配る:
 *
 * - **local (ブロッキング)**: `local.push` を await する。ここが編集フロー同期の**唯一の成功条件**で、
 *   ローカル正典の前進はここで確定する。失敗は throw して呼び出し側 (tap の `Outbox`) に保留させる。
 * - **remote (非ブロッキング)**: `RemoteSyncQueue` へ enqueue するだけで完了を待たない。
 *   remote が落ちていても `push` は local 成功で resolve し、編集も undo/redo も途切れない。
 *   genesis actor 除外・presentation 除外は `RemoteSyncQueue.enqueue` 内で適用される (§3.2/§3.5)。
 *
 * `pull` / `subscribe` は **local へ委譲**する。Lamport 復元 (`eventSyncTap.ensureRestored`) の
 * clock seed はローカル正典の max clock を正とし、remote の clock を混ぜない。batch op-log 経由の
 * remote 受信は非目標 (Phase 4d)。
 */

import type { Batch } from '@conversensus/shared';
import type { FlushResult } from '../sync/outbox';
import {
  type Cursor,
  INITIAL_CURSOR,
  type OnRemote,
  type PullResult,
  type SyncProvider,
  type Unsubscribe,
} from '../sync/syncProvider';
import type { RemoteSyncQueue } from './remoteSyncQueue';

export type FanoutSyncProviderDeps = {
  /** ローカル正典 (daemon op-log) 側の provider。push の成否が編集フローを支配する */
  local: SyncProvider;
  /** remote (ATProto) 側の再送キュー。push では待たずに積むだけ */
  remoteQueue: RemoteSyncQueue;
};

export class FanoutSyncProvider implements SyncProvider {
  private readonly local: SyncProvider;
  private readonly remoteQueue: RemoteSyncQueue;
  /**
   * remote flush の直列化チェーン。`Outbox.flush` は多重起動を弾く (in-flight は即 ok=false) ため、
   * push 連打で送信が取りこぼされないよう前の flush の完了後に次を繋ぐ。
   * テストや手動同期は `whenRemoteSettled()` でこの鎖の落ち着きを待てる。
   */
  private remoteFlush: Promise<void> = Promise.resolve();

  constructor(deps: FanoutSyncProviderDeps) {
    this.local = deps.local;
    this.remoteQueue = deps.remoteQueue;
  }

  /**
   * ローカル正典へ push し、成功した分だけ remote キューへ積む。
   * local が失敗した場合は remote へ積まずに throw する (ローカル正典に載っていない batch を
   * remote へ先行させない)。
   */
  async push(batches: Batch[]): Promise<void> {
    await this.local.push(batches);
    this.remoteQueue.enqueue(batches);
    this.scheduleRemoteFlush();
  }

  /** Lamport 復元の権威はローカル正典。remote の clock は seed に混ぜない (§3.1) */
  async pull(since: Cursor): Promise<PullResult> {
    return this.local.pull(since);
  }

  /** remote 受信の常時購読は Phase 4d。本スライスでは local へ委譲する (§3.1) */
  subscribe(onRemote: OnRemote): Unsubscribe {
    return this.local.subscribe(onRemote);
  }

  /**
   * 取りこぼし回収 (§3.6)。ローカル正典の全 batch を remote と突き合わせ、remote に無い分を
   * 積み直して flush する。best-effort push がオフライン中に落とした分をここで回収する。
   * 起動時 (tap 生成時) に呼ぶ。コスト: local 全件 pull 1 回 + remote 全件 pull 1 回 (D2)。
   *
   * push の flush と同じ鎖に載せて直列化する (`Outbox.flush` の多重起動を避ける)。
   * 失敗は握り潰す — 未送信はキューに残り、次の push か手動同期で再送される。
   */
  async catchUpRemote(): Promise<void> {
    const { batches } = await this.local.pull(INITIAL_CURSOR);
    this.remoteFlush = this.remoteFlush.then(async () => {
      await this.remoteQueue
        .catchUp(batches)
        .then(warnIfNotFlushed, warnRemoteFailure);
    });
    return this.remoteFlush;
  }

  /**
   * 進行中の remote flush が落ち着くまで待つ。編集フローはこれを待たない (待つと非ブロッキングで
   * なくなる)。単体テストと「今すぐ同期」(§3.7) の完了待ちのために公開する。
   */
  whenRemoteSettled(): Promise<void> {
    return this.remoteFlush;
  }

  /**
   * remote flush を直列に繋ぐ。`RemoteSyncQueue.flush` は失敗を FlushResult で返し reject しないが、
   * 想定外の例外で鎖が壊れないよう catch で握り潰す (未送信はキューに残り次回再送される)。
   */
  private scheduleRemoteFlush(): void {
    this.remoteFlush = this.remoteFlush.then(async () => {
      await this.remoteQueue.flush().then(warnIfNotFlushed, warnRemoteFailure);
    });
  }
}

/**
 * remote 送信の失敗を必ずログに残す (W3d5-7)。
 *
 * remote leg は編集フローを止めない設計上、失敗は握り潰して未送信キューに残す。しかし
 * **完全に無言だと障害に気づく手がかりが「未同期 N 件が減らない」だけになる** — 実際
 * W3d5-7 の実機検証で、PDS が float を拒否して全 push が 400 で失敗していたにもかかわらず
 * コンソールには何も出ず、原因特定にネットワーク層の観察が必要だった。
 * ユーザ向けの回復手段は §3.7 の UI が担うので、ここは開発者向けの診断に徹する。
 */
function warnRemoteFailure(error: unknown): void {
  console.warn('[sync] remote push failed:', error);
}

/** `flush` は失敗を throw せず FlushResult で返すので、そちらも拾う */
function warnIfNotFlushed(result: FlushResult): void {
  if (!result.ok) warnRemoteFailure(result.error);
}
