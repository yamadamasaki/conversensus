/**
 * ローカル永続層: 操作ログ (batches) + projection (step1 Phase 3)
 *
 * O1 の確定 (SQLite / `bun:sqlite`) に基づく永続層。
 * 保存モデルは「append-only な操作ログ + projection」:
 *   - batches テーブルへ Batch を追記するのみ (更新・削除しない)。
 *   - グラフ状態 (Sheet) は保存せず、batches の projection で導出する。
 *   - commits はログ上の**ラベル付きオフセット** (branchLog の `Commit`) を保持する。
 *
 * 現行 `storage.ts` (GraphFile を JSON スナップショットで丸ごと保存) の置換候補。
 * 非破壊: 本 Phase では EventStore を追加するのみで、HTTP API の載せ替えは Phase 4 以降。
 */

import { Database } from 'bun:sqlite';
import {
  type Batch,
  type Commit,
  type FileId,
  projectBatches,
  type Sheet,
  type SheetId,
  toSheet,
} from '@conversensus/shared';

/** インメモリ DB のパス指定 (テスト用) */
export const IN_MEMORY = ':memory:';

/** batches の 1 行 (ops は JSON 文字列で保持する) */
type BatchRow = {
  batch_id: string;
  actor: string;
  clock: number;
  timestamp: number;
  ops_json: string;
  // content batch の所属シート。structure (file-level) batch は NULL (W3c2)
  sheet_id: string | null;
};

/** commits の 1 行 */
type CommitRow = {
  id: string;
  message: string;
  at: number;
  author_actor: string;
};

/** file_migrations の 1 行 (op-log 読み取り正典化のスキーマ marker, W3d) */
type MigrationRow = {
  schema_version: number;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS batches (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id    TEXT    NOT NULL,
  batch_id   TEXT    NOT NULL,
  actor      TEXT    NOT NULL,
  clock      INTEGER NOT NULL,
  timestamp  INTEGER NOT NULL,
  ops_json   TEXT    NOT NULL,
  sheet_id   TEXT,
  UNIQUE(file_id, batch_id)
);
CREATE INDEX IF NOT EXISTS idx_batches_file_order
  ON batches (file_id, clock, timestamp, batch_id);

CREATE TABLE IF NOT EXISTS commits (
  id           TEXT    PRIMARY KEY,
  file_id      TEXT    NOT NULL,
  message      TEXT    NOT NULL,
  at           INTEGER NOT NULL,
  author_actor TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_commits_file ON commits (file_id);

-- op-log 読み取り正典化 (W3d) の per-file スキーマ marker。
-- 「破棄→genesis→marker 更新」を一度だけ実行するためのゲート。
CREATE TABLE IF NOT EXISTS file_migrations (
  file_id        TEXT    PRIMARY KEY,
  schema_version INTEGER NOT NULL
);
`;

/**
 * 操作ログの永続ストア。1 インスタンス = 1 データベース。
 * ファイル (グラフ) ごとに file_id で batches / commits を仕切る。
 */
export class EventStore {
  private readonly db: Database;

  /** @param path DB ファイルパス。テストでは `IN_MEMORY` を渡す */
  constructor(path: string) {
    this.db = new Database(path);
    // WAL: デーモン常駐からの並行アクセスで読み書きの競合を緩和する
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.run(SCHEMA);
    this.migrateSheetIdColumn();
  }

  /**
   * W3c2 マイグレーション: 既存 DB の batches に sheet_id 列を追加する。
   * `CREATE TABLE IF NOT EXISTS` は既存テーブルへ列を足さないため、
   * table_info で列の有無を検査し無ければ一度だけ ALTER する (べき等)。
   */
  private migrateSheetIdColumn(): void {
    const cols = this.db
      .query<{ name: string }, []>('PRAGMA table_info(batches)')
      .all();
    if (!cols.some((c) => c.name === 'sheet_id')) {
      this.db.run('ALTER TABLE batches ADD COLUMN sheet_id TEXT');
    }
  }

  /**
   * Batch を操作ログへ追記する。
   * (file_id, batch_id) が既存なら何もしない (べき等: 同一 Batch の重複適用を無視)。
   * @returns 新規に追記されたら true、重複で無視されたら false
   */
  appendBatch(fileId: FileId, batch: Batch): boolean {
    // 永続化の最小不変条件: 空 ops の Batch (no-op 行) をログに残さない。
    // UUID フォーマット等の検証は外部 API 境界 (HTTP) の責務 (CLAUDE.md)。
    if (batch.ops.length === 0) {
      throw new Error('Cannot append a batch with empty ops');
    }
    const result = this.db
      .query(
        `INSERT OR IGNORE INTO batches
           (file_id, batch_id, actor, clock, timestamp, ops_json, sheet_id)
         VALUES ($file, $id, $actor, $clock, $ts, $ops, $sheet)`,
      )
      .run({
        $file: fileId,
        $id: batch.id,
        $actor: batch.actor,
        $clock: batch.clock,
        $ts: batch.timestamp,
        $ops: JSON.stringify(batch.ops),
        // content batch は sheetId を持つ。structure batch は NULL (W3c2)
        $sheet: batch.sheetId ?? null,
      });
    return result.changes > 0;
  }

  /** 複数 Batch を 1 トランザクションで追記する。@returns 新規追記された件数 */
  appendBatches(fileId: FileId, batches: Batch[]): number {
    const tx = this.db.transaction((items: Batch[]) => {
      let inserted = 0;
      for (const batch of items) {
        if (this.appendBatch(fileId, batch)) inserted += 1;
      }
      return inserted;
    });
    return tx(batches);
  }

  /**
   * ファイルの全 Batch を取得する。
   * 追記順を安定させるため (clock, timestamp, batch_id) 昇順で返すが、
   * projection は決定論のため内部で再整列する (projectBatches)。
   */
  getBatches(fileId: FileId): Batch[] {
    const rows = this.db
      .query<BatchRow, string>(
        `SELECT batch_id, actor, clock, timestamp, ops_json, sheet_id
           FROM batches
          WHERE file_id = ?
          ORDER BY clock, timestamp, batch_id`,
      )
      .all(fileId);
    return rows.map((row) => rowToBatch(row));
  }

  /** ファイルの操作ログを projection し、Sheet として導出する */
  projectSheet(
    fileId: FileId,
    meta: { id: SheetId; name: string; description?: string },
  ): Sheet {
    return toSheet(projectBatches(this.getBatches(fileId)), meta);
  }

  /** コミット (ラベル付きオフセット) を保存する。同一 id は上書きする */
  saveCommit(fileId: FileId, commit: Commit): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO commits (id, file_id, message, at, author_actor)
         VALUES ($id, $file, $msg, $at, $author)`,
      )
      .run({
        $id: commit.id,
        $file: fileId,
        $msg: commit.message,
        $at: commit.at,
        $author: commit.authorActor,
      });
  }

  /**
   * ファイルの op-log スキーマ marker を返す (W3d)。未 migration なら null。
   * marker >= W3_SCHEMA_VERSION なら op-log は既に正典 (genesis 済)。
   */
  getSchemaVersion(fileId: FileId): number | null {
    const row = this.db
      .query<MigrationRow, string>(
        'SELECT schema_version FROM file_migrations WHERE file_id = ?',
      )
      .get(fileId);
    return row ? row.schema_version : null;
  }

  /**
   * op-log 読み取り正典化 (W3d): pre-W3 ログを破棄し、snapshot 由来の genesis batch で
   * 作り直して marker を立てる。**「破棄→genesis→marker 更新」を 1 トランザクションで**
   * 原子的に実行する (途中失敗はロールバックし marker 未更新 = 次回再試行)。
   *
   * 再入べき等: tx 内で marker を再検査し、既に `>= schemaVersion` なら何もしない。
   * genesis batch は呼び出し側が snapshot から生成して渡す (本層は DB 操作に徹する)。
   *
   * @returns migration を実行したら true、既に済で no-op なら false
   */
  migrateToOplog(
    fileId: FileId,
    genesisBatches: Batch[],
    schemaVersion: number,
  ): boolean {
    const tx = this.db.transaction(() => {
      // tx 内 re-check: 並行要求や再試行での二重 migration を防ぐ (再入べき等)
      const current = this.getSchemaVersion(fileId);
      if (current !== null && current >= schemaVersion) return false;
      // 破棄 → genesis → marker の順序を tx で構造的に保証する
      this.db
        .query('DELETE FROM batches WHERE file_id = $file')
        .run({ $file: fileId });
      for (const batch of genesisBatches) this.appendBatch(fileId, batch);
      this.db
        .query(
          `INSERT OR REPLACE INTO file_migrations (file_id, schema_version)
           VALUES ($file, $ver)`,
        )
        .run({ $file: fileId, $ver: schemaVersion });
      return true;
    });
    return tx();
  }

  /** ファイルのコミット一覧を、指すオフセット (at) 昇順で取得する */
  getCommits(fileId: FileId): Commit[] {
    const rows = this.db
      .query<CommitRow, string>(
        `SELECT id, message, at, author_actor
           FROM commits
          WHERE file_id = ?
          ORDER BY at, id`,
      )
      .all(fileId);
    return rows.map((row) => rowToCommit(row));
  }

  close(): void {
    this.db.close();
  }
}

function rowToBatch(row: BatchRow): Batch {
  return {
    id: row.batch_id as Batch['id'],
    actor: row.actor,
    clock: row.clock,
    timestamp: row.timestamp,
    ops: JSON.parse(row.ops_json) as Batch['ops'],
    // content batch のみ sheet_id を持つ (structure batch は NULL) (W3c2)
    ...(row.sheet_id !== null && { sheetId: row.sheet_id as SheetId }),
  };
}

function rowToCommit(row: CommitRow): Commit {
  return {
    id: row.id as Commit['id'],
    message: row.message,
    at: row.at,
    authorActor: row.author_actor,
  };
}
