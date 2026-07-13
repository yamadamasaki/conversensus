/**
 * AtprotoSyncProvider: ATProto を裏に隠す `SyncProvider` 実装 (step1 Phase 4c)
 *
 * architecture §6 / D3。外の層は `SyncProvider` だけに依存し、この実装が ATProto の
 * op-log コレクション (`app.conversensus.graph.batch`) への読み書きに翻訳する。
 *
 * - push  : batch を putRecord (rkey = batchId)。batch は不変なのでべき等。
 * - pull  : clock > cursor の batch レコードを取得。cursor は clock を符号化した不透明値。
 * - subscribe: 定期 poll で新規 batch を配信 (baseline 確立後の差分のみ)。
 *   手動 polling は 4d で Jetstream 購読へ置き換える。
 *
 * 依存 (batch collection / scheduler) は注入可能にし、PDS・タイマー非依存にテストする。
 */

import type { Batch } from '@conversensus/shared';
import {
  type Cursor,
  INITIAL_CURSOR,
  type OnRemote,
  type PullResult,
  type SyncProvider,
  type Unsubscribe,
} from '../sync';
import {
  batchToRecord,
  isBatchRecordValue,
  recordToBatch,
} from './batchMapper';
import type { BatchRecord, RecordResult } from './types';

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

/** cursor (不透明) → clock 値。空・不正は 0 (最初から) とみなす */
function cursorToClock(cursor: Cursor): number {
  if (cursor === INITIAL_CURSOR) return 0;
  const n = Number(cursor);
  return Number.isFinite(n) ? n : 0;
}

export class AtprotoSyncProvider implements SyncProvider {
  private readonly batches: BatchCollection;
  private readonly scheduler: IntervalScheduler;
  private readonly intervalMs: number;

  constructor(deps: AtprotoSyncProviderDeps) {
    this.batches = deps.batches;
    this.scheduler = deps.scheduler ?? DEFAULT_SCHEDULER;
    this.intervalMs = deps.intervalMs ?? SUBSCRIBE_INTERVAL_MS;
  }

  /** ローカルの batches を op-log レコードとして PDS へ書く (rkey=batchId, べき等) */
  async push(batches: Batch[]): Promise<void> {
    for (const batch of batches) {
      await this.batches.put(batch.id, batchToRecord(batch));
    }
  }

  /**
   * since (cursor) より後 (clock 大) の batch レコードを取得する。
   * cursor は取得済みの最大 clock を符号化して前進させる (空でも進みうる)。
   */
  async pull(since: Cursor): Promise<PullResult> {
    const sinceClock = cursorToClock(since);
    const records = await this.batches.list();

    let maxClock = sinceClock;
    const batches: Batch[] = [];
    for (const r of records) {
      if (!isBatchRecordValue(r.value)) continue; // 壊れた/他種レコードを飛ばす
      const batch = recordToBatch(rkeyFromUri(r.uri), r.value);
      if (batch.clock > maxClock) maxClock = batch.clock;
      if (batch.clock > sinceClock) batches.push(batch);
    }

    // 決定論的な順序で返す: clock → timestamp → id
    batches.sort(
      (a, b) =>
        a.clock - b.clock ||
        a.timestamp - b.timestamp ||
        a.id.localeCompare(b.id),
    );

    return { batches, cursor: String(maxClock) };
  }

  /**
   * remote の新規 batch を購読する。
   * 初回 poll は現在の tip までカーソルを進める baseline 確立のみ (再配信を避ける)。
   * 以降の poll で現れた batch だけを onRemote へ渡す。
   */
  subscribe(onRemote: OnRemote): Unsubscribe {
    let cursor = INITIAL_CURSOR;
    let baselined = false;

    const tick = async () => {
      const { batches, cursor: next } = await this.pull(cursor);
      cursor = next;
      if (!baselined) {
        baselined = true; // 初回は基準確立のみ、配信しない
        return;
      }
      if (batches.length > 0) onRemote(batches);
    };

    const handle = this.scheduler.set(() => {
      tick().catch((err) =>
        console.warn('[atproto] subscribe poll error:', err),
      );
    }, this.intervalMs);

    return () => this.scheduler.clear(handle);
  }
}
