/**
 * `SqlDriver` の契約 (step3 Phase 2 D1)
 *
 * `EventStore` が頼っている振る舞いだけを並べる。**ドライバの実装ごとに同じ契約を当てる** —
 * `bun:sqlite` は単体テストで、SQLite-WASM はブラウザ (E2E) で。どちらで走らせても同じ
 * 結論になるよう、テストの道具に依らない形 (違反を例外にする関数の列) で書く。
 */

import type { SqlDriver } from './sqlDriver';

export type ContractCase = { name: string; check: (driver: SqlDriver) => void };

function assertEqual(actual: unknown, expected: unknown, what: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

const TABLE = 'CREATE TABLE t (k TEXT PRIMARY KEY, v INTEGER, b BLOB)';

export const SQL_DRIVER_CONTRACT: readonly ContractCase[] = [
  {
    name: '名前付きパラメータで書き、位置パラメータで読める',
    check: (db) => {
      db.exec(TABLE);
      assertEqual(
        db.run('INSERT INTO t (k, v) VALUES ($k, $v)', { $k: 'a', $v: 1 })
          .changes,
        1,
        'changes',
      );
      assertEqual(
        db.all('SELECT k, v FROM t WHERE k = ?', ['a']),
        [{ k: 'a', v: 1 }],
        'rows',
      );
    },
  },
  {
    name: 'INSERT OR IGNORE で無視した行は changes 0',
    check: (db) => {
      db.exec(TABLE);
      db.run('INSERT INTO t (k, v) VALUES (?, ?)', ['a', 1]);
      assertEqual(
        db.run('INSERT OR IGNORE INTO t (k, v) VALUES (?, ?)', ['a', 2])
          .changes,
        0,
        'changes',
      );
    },
  },
  {
    name: 'get は無い行で undefined を返す',
    check: (db) => {
      db.exec(TABLE);
      assertEqual(
        db.get('SELECT k FROM t WHERE k = ?', ['none']) === undefined,
        true,
        'undefined',
      );
    },
  },
  {
    name: 'BLOB は Uint8Array で往復する',
    check: (db) => {
      db.exec(TABLE);
      db.run('INSERT INTO t (k, b) VALUES (?, ?)', [
        'a',
        new Uint8Array([1, 2, 3]),
      ]);
      const row = db.get<{ b: Uint8Array }>('SELECT b FROM t WHERE k = ?', [
        'a',
      ]);
      assertEqual([...new Uint8Array(row?.b ?? [])], [1, 2, 3], 'bytes');
    },
  },
  {
    name: 'transaction は値を返し、例外で巻き戻す',
    check: (db) => {
      db.exec(TABLE);
      assertEqual(
        db.transaction(() => {
          db.run('INSERT INTO t (k, v) VALUES (?, ?)', ['a', 1]);
          return 'done';
        }),
        'done',
        'return value',
      );
      try {
        db.transaction(() => {
          db.run('INSERT INTO t (k, v) VALUES (?, ?)', ['b', 2]);
          throw new Error('abort');
        });
      } catch {
        // 巻き戻されたことを下で確かめる
      }
      assertEqual(
        db.all<{ k: string }>('SELECT k FROM t ORDER BY k').map((r) => r.k),
        ['a'],
        'rows after rollback',
      );
    },
  },
];
