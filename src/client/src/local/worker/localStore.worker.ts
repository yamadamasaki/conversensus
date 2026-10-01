/**
 * ローカル正典の Worker (step3 Phase 2 D3)
 *
 * SQLite-WASM を `opfs` VFS で開き、`LocalStore` を `storeBackend` で包んで main からの
 * 呼び出しに答える。**App 結合テストが通しているのと同じ `storeBackend` がここで動く** —
 * 違うのは SQL のドライバと、Worker の境界だけである。
 *
 * 各タブがそれぞれ Worker を立て、同じ DB に接続を持つ (`opfs` VFS は複数接続を許す, S0-4)。
 */

import {
  EventStore,
  LocalStore,
  SQL_DRIVER_CONTRACT,
} from '@conversensus/shared';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { storeBackend } from '../storeBackend';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { WasmSqliteDriver } from './wasmSqliteDriver';

/** OPFS 上の DB のパス。**v2 (step3 Phase 1) の形式** — 古いものは無いので名前に版を入れない */
const DB_PATH = '/conversensus.sqlite3';

const post = (message: WorkerResponse) => self.postMessage(message);

async function open() {
  const sqlite3 = await sqlite3InitModule();
  // 使えるかは `oo1.OpfsDb` の有無で見る (S0-4 の注意 4)
  if (!sqlite3.oo1.OpfsDb) {
    throw new Error(
      self.crossOriginIsolated
        ? 'OPFS が使えない (プライベートブラウズなど、保存領域の無い窓の可能性)'
        : 'cross-origin isolation が無い (COOP/COEP ヘッダが配信されていない)',
    );
  }
  const store = new LocalStore(
    new EventStore(new WasmSqliteDriver(new sqlite3.oo1.OpfsDb(DB_PATH))),
  );
  return { sqlite3, backend: storeBackend(store) };
}

const opened = open();

opened.then(
  () => post({ kind: 'ready' }),
  (error: unknown) =>
    post({
      kind: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
    }),
);

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    const { sqlite3, backend } = await opened;
    if (request.kind === 'driverContract') {
      // 開発時の検査: `bun:sqlite` と同じ契約を、この Worker の SQLite-WASM に当てる
      const failures: string[] = [];
      for (const { name, check } of SQL_DRIVER_CONTRACT) {
        const driver = new WasmSqliteDriver(new sqlite3.oo1.DB(':memory:'));
        try {
          check(driver);
        } catch (error) {
          failures.push(`${name}: ${String(error)}`);
        } finally {
          driver.close();
        }
      }
      post({ id: request.id, kind: 'result', value: failures });
      return;
    }
    const method = backend[request.method] as (...args: unknown[]) => unknown;
    const value = await method(...request.args);
    post({ id: request.id, kind: 'result', value });
  } catch (error) {
    post({
      id: request.id,
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
