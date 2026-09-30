/**
 * S0-4 spike: SQLite-WASM を OPFS で動かす worker (step3 Phase 0, 投棄可)。
 *
 * page から `{ vfs, rows, mode }` を受け取り、測った結果を返す。
 *
 * - vfs `opfs`: 同期 OPFS を SharedArrayBuffer 越しに使う。**COOP/COEP が要る**。
 *   複数タブから同じ DB を開ける (ロックで順番を取る)
 * - vfs `sahpool`: SyncAccessHandle を先に確保しておく方式。**COOP/COEP 不要**。
 *   その代わり、同じ origin で同時に 1 つの接続しか持てない
 */

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

/** sqlite-wasm は OPFS の導入に失敗しても console に出すだけなので、結果に含める */
const logs: string[] = [];
for (const level of ['warn', 'error'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    logs.push(`${level}: ${args.map(String).join(' ')}`.slice(0, 300));
    original(...args);
  };
}

type Vfs = 'opfs' | 'sahpool';
type Mode = 'write' | 'read' | 'hold';
type Request = { vfs: Vfs; rows: number; mode: Mode };

const DB_NAME = '/spike.sqlite3';
/** 本物の batch レコード 1 件の大きさに近い本文 (S0-3 の実測で約 600 バイト) */
const PAYLOAD = JSON.stringify({
  fileId: crypto.randomUUID(),
  actor: 'did:plc:xxxxxxxxxxxxxxxxxxxxxxxx#device',
  ops: [
    { kind: 'node.add', target: crypto.randomUUID(), content: 'x'.repeat(300) },
  ],
});

// biome-ignore lint/suspicious/noExplicitAny: spike。sqlite-wasm の DB 型を追わない
type Db = any;

async function open(vfs: Vfs): Promise<{ db: Db; version: string }> {
  const sqlite3 = await sqlite3InitModule();
  const version = sqlite3.version.libVersion;
  if (vfs === 'opfs') {
    // 使えるかは `oo1.OpfsDb` の有無で見る (型定義の注)。`'opfs' in sqlite3` は当てにならない
    if (!sqlite3.oo1.OpfsDb) {
      throw new Error(
        `opfs VFS が無い (crossOriginIsolated=${self.crossOriginIsolated})`,
      );
    }
    return { db: new sqlite3.oo1.OpfsDb(DB_NAME), version };
  }
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'spike-pool' });
  return { db: new pool.OpfsSAHPoolDb(DB_NAME), version };
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { vfs, rows, mode } = event.data;
  const result: Record<string, unknown> = { vfs, mode };
  try {
    const t0 = performance.now();
    const { db, version } = await open(vfs);
    result.version = version;
    result.openMs = performance.now() - t0;
    db.exec(
      'CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, clock INTEGER, body TEXT)',
    );

    if (mode === 'write') {
      db.exec('DELETE FROM batches');
      const t1 = performance.now();
      db.transaction(() => {
        const stmt = db.prepare(
          'INSERT INTO batches (id, clock, body) VALUES (?, ?, ?)',
        );
        for (let i = 0; i < rows; i++) {
          stmt.bind([crypto.randomUUID(), i, PAYLOAD]).stepReset();
        }
        stmt.finalize();
      });
      result.insertMs = performance.now() - t1;
    }

    const t2 = performance.now();
    const all = db.selectArrays(
      'SELECT id, clock, body FROM batches ORDER BY clock',
    );
    result.readMs = performance.now() - t2;
    result.count = all.length;

    // 'hold' は接続を開いたまま返す (2 つ目のタブから開けるかを見るため)
    if (mode !== 'hold') db.close();
  } catch (error) {
    result.error =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
  }
  result.logs = logs.slice(0, 6);
  self.postMessage(result);
};
