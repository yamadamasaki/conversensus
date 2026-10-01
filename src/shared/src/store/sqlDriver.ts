/**
 * SQL ドライバの口 (step3 Phase 2 D1)
 *
 * `EventStore` は SQL を組み立てて結果を型に戻すだけで、DB の呼び方だけがエンジンに依る。
 * その差をここに閉じ込め、実装を 2 つ持つ:
 *
 * - `bun:sqlite` (`bunSqliteDriver.ts`): 単体・App 結合・(撤去までの) ローカルサーバ
 * - SQLite-WASM の `opfs` VFS: ブラウザ。dedicated Worker の中で動く
 *
 * **同期の口にする。**どちらのエンジンも、DB を持つスレッドの中では同期で呼べる
 * (SQLite-WASM は Worker の中で同期)。非同期になるのは Worker の外との境界 (`api.ts`) だけである。
 *
 * パラメータは名前付き (`$name`) か位置 (`?`) の 2 通り。どちらのエンジンも両方を受ける。
 */

/** SQLite に渡せる値 */
export type SqlValue = string | number | null | Uint8Array;

/** 位置パラメータ (`?`) か名前付きパラメータ (`$name`) */
export type SqlParams =
  | readonly SqlValue[]
  | Readonly<Record<string, SqlValue>>;

export interface SqlDriver {
  /** パラメータの無い SQL を (複数文でも) 実行する。スキーマの作成に使う */
  exec(sql: string): void;
  /** 書き込みを 1 文実行し、変更した行数を返す */
  run(sql: string, params?: SqlParams): { changes: number };
  /** 読み出しを 1 文実行し、全行をオブジェクトで返す */
  all<T>(sql: string, params?: SqlParams): T[];
  /** 読み出しを 1 文実行し、最初の行を返す (無ければ undefined) */
  get<T>(sql: string, params?: SqlParams): T | undefined;
  /**
   * `fn` を 1 トランザクションで実行する。例外が出れば巻き戻す。
   * **入れ子にしない** — `EventStore` の中で tx を開く関数どうしは互いを呼ばない
   */
  transaction<T>(fn: () => T): T;
  close(): void;
}
