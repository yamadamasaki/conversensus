/**
 * SQLite-WASM (oo1 API) の SQL ドライバ (step3 Phase 2 D1)
 *
 * **Worker の中でだけ使う** — `opfs` VFS は同期 OPFS を使うので dedicated Worker でしか
 * 動かない。oo1 の DB は Worker の中では同期で呼べるので、`SqlDriver` の同期の口にそのまま載る。
 *
 * 契約 (`sqlDriverContract.ts`) は `bun:sqlite` のドライバと同じものを当てる (E2E で、ブラウザの中で)。
 */

import type { SqlDriver, SqlParams } from '@conversensus/shared';
import type { Database, SqlValue } from '@sqlite.org/sqlite-wasm';

type Bind = readonly SqlValue[] | Record<string, SqlValue>;

export class WasmSqliteDriver implements SqlDriver {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, params?: SqlParams): { changes: number } {
    this.db.exec({ sql, bind: params as Bind | undefined });
    return { changes: this.db.changes() };
  }

  all<T>(sql: string, params?: SqlParams): T[] {
    return this.db.exec({
      sql,
      bind: params as Bind | undefined,
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as T[];
  }

  get<T>(sql: string, params?: SqlParams): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(() => fn());
  }

  close(): void {
    this.db.close();
  }
}
