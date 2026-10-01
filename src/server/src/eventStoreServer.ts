/**
 * サーバ用 EventStore アクセサ (step1 Phase 4 実配線)
 *
 * HTTP ハンドラから操作ログ永続層 (EventStore, SQLite) へアクセスするための入口。
 * `DATA_DIR` 配下の `events.db` を開く。テストは `DATA_DIR` をテスト毎に差し替えるため、
 * **解決したパスごとに** インスタンスをメモ化する (パスが変われば別 DB を開く)。
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { EventStore } from '@conversensus/shared';
import { BunSqliteDriver } from '@conversensus/shared/src/store/bunSqliteDriver';

/**
 * DB のファイル名。**v2 (step3 Phase 1) で名前を変えた** — batch が点と依存を持つ形になり、
 * 互換性は持たないと決めたので、古い DB (`events.db`) は開かずに新しく始める
 */
const EVENTS_DB_FILE = 'events-v2.db';

function dataDir(): string {
  return process.env.DATA_DIR ?? join(import.meta.dir, '../../../data');
}

function dbPath(): string {
  return join(dataDir(), EVENTS_DB_FILE);
}

const stores = new Map<string, EventStore>();

/** 現在の DATA_DIR に対応する EventStore を返す (パス単位でメモ化) */
export function getEventStore(): EventStore {
  const path = dbPath();
  let store = stores.get(path);
  if (!store) {
    mkdirSync(dataDir(), { recursive: true }); // DB を開く前にディレクトリを保証する
    store = new EventStore(new BunSqliteDriver(path));
    stores.set(path, store);
  }
  return store;
}
