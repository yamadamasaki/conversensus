/**
 * LocalServerSyncProvider: ローカル永続デーモン (Hono + EventStore) を宛先とする
 * `SyncProvider` 実装 (step1 Phase 4 実配線 W2)
 *
 * local-first ではローカル正典 = サーバの操作ログ (EventStore)。この provider は
 * `push` をローカルサーバへの batch 追記 (`pushBatches`) に、`pull` をログ取得
 * (`fetchBatches`) に翻訳する。Outbox の裏に置くことで、デーモンが一時的に落ちても
 * 編集は保留され復帰時に flush される。
 *
 * subscribe (他タブ/他プロセスからの追記購読) は本スライスでは no-op。
 */

import type { Batch, FileId } from '@conversensus/shared';
import { fetchBatches, pushBatches } from '../api';
import {
  type Cursor,
  INITIAL_CURSOR,
  type OnRemote,
  type PullResult,
  type SyncProvider,
  type Unsubscribe,
} from './syncProvider';

/** cursor (不透明) → clock。空・不正は 0 (最初から) */
function cursorToClock(cursor: Cursor): number {
  if (cursor === INITIAL_CURSOR) return 0;
  const n = Number(cursor);
  return Number.isFinite(n) ? n : 0;
}

export class LocalServerSyncProvider implements SyncProvider {
  constructor(private readonly fileId: FileId) {}

  async push(batches: Batch[]): Promise<void> {
    await pushBatches(this.fileId, batches);
  }

  async pull(since: Cursor): Promise<PullResult> {
    const sinceClock = cursorToClock(since);
    const batches = await fetchBatches(this.fileId, sinceClock);
    const maxClock = batches.reduce((m, b) => Math.max(m, b.clock), sinceClock);
    return { batches, cursor: String(maxClock) };
  }

  subscribe(_onRemote: OnRemote): Unsubscribe {
    return () => {
      // no-op (他プロセス購読は後続)
    };
  }
}
