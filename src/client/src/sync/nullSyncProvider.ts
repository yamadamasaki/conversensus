/**
 * NullSyncProvider: 完全ローカル (同期なし) の `SyncProvider` 実装 (step1 Phase 4a)
 *
 * remote を持たない構成 (未ログイン・完全オフライン運用) の既定 provider。
 * push は破棄、pull は常に空。
 * これにより外の層は「provider が常に存在する」前提でコードを書ける
 * (ATProto 有無で分岐しない)。architecture §6 の "null (完全ローカル)"。
 */

import type { Batch } from '@conversensus/shared';
import {
  type Cursor,
  INITIAL_CURSOR,
  type PullResult,
  type SyncProvider,
} from './syncProvider';

export class NullSyncProvider implements SyncProvider {
  /** ローカル専用なので送信先は無い。ローカル正典は既に確定済み */
  async push(_batches: Batch[]): Promise<void> {
    // no-op
  }

  /** remote が無いので常に空。カーソルは前進させず初期値を返す */
  async pull(_since: Cursor): Promise<PullResult> {
    return { batches: [], cursor: INITIAL_CURSOR };
  }
}
