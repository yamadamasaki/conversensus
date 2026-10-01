/**
 * `bun:sqlite` の SQL ドライバ (step3 Phase 2 D1)
 *
 * **`index.ts` からは出さない。**`bun:sqlite` はブラウザの bundle に入れられないので、
 * 使う側 (テスト・ローカルサーバ) がパスで import する
 * (`@conversensus/shared/src/store/bunSqliteDriver`)。
 */

import { Database, type SQLQueryBindings } from 'bun:sqlite';
import type { SqlDriver, SqlParams } from './sqlDriver';

/** インメモリ DB のパス指定 (テスト用) */
export const IN_MEMORY = ':memory:';

export class BunSqliteDriver implements SqlDriver {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    // WAL: デーモン常駐からの並行アクセスで読み書きの競合を緩和する
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  exec(sql: string): void {
    this.db.run(sql);
  }

  run(sql: string, params?: SqlParams): { changes: number } {
    const statement = this.db.query(sql);
    const result = Array.isArray(params)
      ? statement.run(...(params as SQLQueryBindings[]))
      : statement.run((params ?? {}) as SQLQueryBindings);
    return { changes: result.changes };
  }

  all<T>(sql: string, params?: SqlParams): T[] {
    const statement = this.db.query<T, SQLQueryBindings[]>(sql);
    return Array.isArray(params)
      ? statement.all(...(params as SQLQueryBindings[]))
      : statement.all((params ?? {}) as SQLQueryBindings);
  }

  get<T>(sql: string, params?: SqlParams): T | undefined {
    const statement = this.db.query<T, SQLQueryBindings[]>(sql);
    const row = Array.isArray(params)
      ? statement.get(...(params as SQLQueryBindings[]))
      : statement.get((params ?? {}) as SQLQueryBindings);
    return row ?? undefined;
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }
}
