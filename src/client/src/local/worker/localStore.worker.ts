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
import { STORAGE_FAILURE } from '../storageFailure';
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
    // 文ではなく理由の札を送る。worker は端末に覚えた画面の言語を読めない (`localStorage` が無い) ので、
    // 文にするのは画面の側である (`workerBackend.ts` の `startFailureReason`, #50)
    throw new Error(
      self.crossOriginIsolated
        ? STORAGE_FAILURE.noOpfs
        : STORAGE_FAILURE.noIsolation,
    );
  }
  const store = new LocalStore(
    new EventStore(new WasmSqliteDriver(new sqlite3.oo1.OpfsDb(DB_PATH))),
  );
  // 壊れて保存された画像の参照を直す (#264)。v1.0.0 の直前まで、他の人が貼った画像の参照が
  // 受け手の保存で壊れていた。直すものが無ければ何もしないので、開くたびに呼んでよい。
  // 失敗しても開くことは止めない (画像が「画像 URL を入力」のままになるだけ)
  try {
    const repaired = store.repairBlobRefs();
    if (repaired > 0)
      console.info(`[local] 壊れていた画像の参照を ${repaired} 件直した`);
  } catch (error) {
    console.warn('[local] 画像の参照を直せなかった:', error);
  }
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
