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
  type BranchId,
  type BranchMeta,
  type BranchStatus,
  type Commit,
  type CommitId,
  type FileId,
  type GraphFileListItem,
  isFileDeleted,
  projectBatches,
  projectFile,
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

/** branches の 1 行 (base コミットは列へインライン展開する, step1 Phase 5) */
type BranchRow = {
  id: string;
  branch_file_id: string;
  name: string;
  sheet_id: string;
  status: string;
  base_commit_id: string;
  base_message: string;
  base_at: number;
  base_author_actor: string;
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

-- ブランチのメタ情報 (step1 Phase 5)。branch batches 自体は batches テーブルへ
-- branch_file_id で分けて貯め、ここは「どの trunk のどのシートから、どの base で
-- 分岐したか」だけを持つ。base コミットは低頻度メタなので commits への FK を張らず
-- 列へインライン展開する (読取が 1 クエリで閉じ、branch と commit の生存期間が絡まない)。
CREATE TABLE IF NOT EXISTS branches (
  id                TEXT    PRIMARY KEY,
  trunk_file_id     TEXT    NOT NULL,
  branch_file_id    TEXT    NOT NULL,
  name              TEXT    NOT NULL,
  sheet_id          TEXT    NOT NULL,
  status            TEXT    NOT NULL,
  base_commit_id    TEXT    NOT NULL,
  base_message      TEXT    NOT NULL,
  base_at           INTEGER NOT NULL,
  base_author_actor TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_branches_trunk ON branches (trunk_file_id);

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

  /**
   * op-log に batch を持つファイルの一覧を返す (Phase 4e-2a, 4e 設計 §3.2b)。
   *
   * `GET /files` を snapshot storage と op-log の和集合にするための op-log 側。
   * 受信で materialize されたファイルは snapshot を持たないため、ここに出ないと
   * 一覧から永久に見えない。name/description は file 構造 op を `projectFile` で
   * 畳んで得る (fold の第 2 実装を作らない)。
   *
   * - 順序は初出順 (file_id ごとの最小 seq)。和集合では snapshot 側の後に足される。
   * - projection が 0 シートの file_id は除外する — 有効な GraphFile は必ず
   *   1 シート以上持つ (W3d-2 の読取失敗判定と同じ基準)。genesis を持たない
   *   孤児 batch だけの file_id を出すと、開いても描画できない項目が並ぶため。
   * - **削除済み (`file.remove`) の file_id も除外する** (ANA-127)。batches の行は
   *   残したまま一覧からだけ落とす — 行を消すと tombstone ごと消えて、次の discovery が
   *   「未知ファイル」と誤判定して PDS から materialize し直してしまう (設計 D1 の層 1)。
   */
  listOplogFiles(): GraphFileListItem[] {
    const rows = this.db
      .query<{ file_id: string }, []>(
        'SELECT file_id FROM batches GROUP BY file_id ORDER BY MIN(seq)',
      )
      .all();
    const items: GraphFileListItem[] = [];
    for (const row of rows) {
      const fileId = row.file_id as FileId;
      const batches = this.getBatches(fileId);
      if (isFileDeleted(batches)) continue;
      const projected = projectFile(batches, fileId);
      if (projected.sheets.length === 0) continue;
      items.push({
        id: fileId,
        name: projected.name,
        ...(projected.description !== undefined && {
          description: projected.description,
        }),
      });
    }
    return items;
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
   * ブランチのメタ情報を保存する。同一 id は上書きする (step1 Phase 5)。
   *
   * `saveCommit` と違い trunk file_id を別引数で取らない — `BranchMeta` 自身が
   * `trunkFileId` を持つため、引数で二重に受けると食い違いを作れてしまう。
   */
  saveBranch(meta: BranchMeta): void {
    this.db
      .query(
        `INSERT OR REPLACE INTO branches
           (id, trunk_file_id, branch_file_id, name, sheet_id, status,
            base_commit_id, base_message, base_at, base_author_actor)
         VALUES ($id, $trunk, $branch, $name, $sheet, $status,
                 $baseId, $baseMsg, $baseAt, $baseAuthor)`,
      )
      .run({
        $id: meta.id,
        $trunk: meta.trunkFileId,
        $branch: meta.branchFileId,
        $name: meta.name,
        $sheet: meta.sheetId,
        $status: meta.status,
        $baseId: meta.base.id,
        $baseMsg: meta.base.message,
        $baseAt: meta.base.at,
        $baseAuthor: meta.base.authorActor,
      });
  }

  /** trunk のブランチ一覧を base オフセット (at) 昇順で取得する */
  getBranches(trunkFileId: FileId): BranchMeta[] {
    const rows = this.db
      .query<BranchRow, string>(
        `SELECT id, branch_file_id, name, sheet_id, status,
                base_commit_id, base_message, base_at, base_author_actor
           FROM branches
          WHERE trunk_file_id = ?
          ORDER BY base_at, id`,
      )
      .all(trunkFileId);
    return rows.map((row) => rowToBranch(row, trunkFileId));
  }

  /**
   * ブランチを削除する (step1 Phase 5 p5-4)。
   *
   * メタ行だけでなく **branch 専用 file_id に貯めた op-log と commit も同じ tx で消す**。
   * branch の中身へは `branch_file_id` からしか辿れないので、メタだけ消すと参照者の
   * いない batch が永久に残る (孤児)。`DELETE /files/:id` (ファイル削除) と違い
   * snapshot は存在しない — branch は op-log 専業のため (設計 §3.1-B)。
   *
   * @param trunkFileId 分岐元 trunk。他ファイルのブランチを id 指定で消せないようにする
   * @returns 削除したら true、該当ブランチが無ければ false
   */
  deleteBranch(trunkFileId: FileId, branchId: BranchId): boolean {
    const tx = this.db.transaction(() => {
      const row = this.db
        .query<{ branch_file_id: string }, [string, string]>(
          'SELECT branch_file_id FROM branches WHERE id = ? AND trunk_file_id = ?',
        )
        .get(branchId, trunkFileId);
      if (!row) return false;
      const branchFileId = row.branch_file_id;
      this.db
        .query('DELETE FROM branches WHERE id = $id')
        .run({ $id: branchId });
      this.db
        .query('DELETE FROM batches WHERE file_id = $file')
        .run({ $file: branchFileId });
      this.db
        .query('DELETE FROM commits WHERE file_id = $file')
        .run({ $file: branchFileId });
      return true;
    });
    return tx();
  }

  /**
   * ファイルを op-log ごと削除する (step1 Phase 6 p6-2, 設計 §3.5)。
   *
   * `deleteBranch` の trunk 版。**1 tx** で以下をまとめて消す:
   *
   * - 当該 file_id の batches / commits / file_migrations
   * - trunk にぶら下がる branches のメタ行と、その branch 専用 file_id の batches / commits
   *
   * branch を巻き込むのは、branch の中身へは `branches.branch_file_id` からしか
   * 辿れないため — trunk のメタ行だけ消すと参照者のいない batch が永久に残る
   * (`deleteBranch` と同じ理由)。
   *
   * 【§1.3 の穴】これ以前の `DELETE /files/:id` は snapshot しか消していなかった。
   * Phase 4e で snapshot を持たない op-log-only ファイル (受信 materialize) が
   * 生まれて以降、それらは削除不能で、削除できたファイルも op-log が残っていた。
   *
   * @returns 1 行でも消したら true、対象が何も無ければ false (= 404 の根拠)
   */
  deleteFile(fileId: FileId): boolean {
    const tx = this.db.transaction(() => {
      const branchFileIds = this.db
        .query<{ branch_file_id: string }, string>(
          'SELECT branch_file_id FROM branches WHERE trunk_file_id = ?',
        )
        .all(fileId)
        .map((row) => row.branch_file_id);
      let removed = 0;
      for (const id of [fileId, ...branchFileIds]) {
        for (const table of ['batches', 'commits', 'file_migrations']) {
          removed += this.db
            .query(`DELETE FROM ${table} WHERE file_id = $file`)
            .run({ $file: id }).changes;
        }
      }
      removed += this.db
        .query('DELETE FROM branches WHERE trunk_file_id = $file')
        .run({ $file: fileId }).changes;
      return removed > 0;
    });
    return tx();
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

  /**
   * remote から受信した Batch を追記し、**同じ tx で op-log 正典 marker を立てる** (Phase 4d-0)。
   *
   * marker は W3d-1 では「snapshot からの lazy migration 済」を表したが、ここでは
   * **「この op-log は正典であり snapshot から作り直してはならない」宣言**として使う。
   * marker を立てずに受信 batch を書くと、次の `GET /files/:id/batches` が
   * `migrateToOplog` を起動し `DELETE FROM batches` で**受信内容を丸ごと破棄する**
   * (設計 `step1-phase4d-receive.md` §1.8)。受信 batch は remote にしか無いので、
   * 受信側 cursor が前進していれば二度と取り直せない。
   *
   * `migrateToOplog` 側に「op-log が空でなければ migration しない」ガードを置く案は採らない。
   * W3d-1 が仕様化した「pre-W3 の増分ログを破棄して genesis で作り直す」挙動
   * (`migrateFileToOplog.test.md`) を壊すため。**受信していないファイルの lazy migration は
   * 従来どおり動く** — 両者を分けるのが marker の役割になる。
   *
   * @returns 新規に追記された件数 (既存 batch_id は appendBatch のべき等性で無視される)
   */
  appendReceivedBatches(
    fileId: FileId,
    batches: Batch[],
    schemaVersion: number,
  ): number {
    // 受信 0 件で正典宣言だけ立てない (lazy migration の機会を無意味に奪わない)
    if (batches.length === 0) return 0;
    const tx = this.db.transaction((items: Batch[]) => {
      let inserted = 0;
      for (const batch of items) {
        if (this.appendBatch(fileId, batch)) inserted += 1;
      }
      // marker は下げない: 既により新しい版で正典化済ならそのまま残す
      const current = this.getSchemaVersion(fileId);
      if (current === null || current < schemaVersion) {
        this.db
          .query(
            `INSERT OR REPLACE INTO file_migrations (file_id, schema_version)
             VALUES ($file, $ver)`,
          )
          .run({ $file: fileId, $ver: schemaVersion });
      }
      return inserted;
    });
    return tx(batches);
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

/** trunk_file_id は絞り込みキーなので行に含めず、呼び出し側から復元する */
function rowToBranch(row: BranchRow, trunkFileId: FileId): BranchMeta {
  return {
    id: row.id as BranchId,
    name: row.name,
    base: {
      id: row.base_commit_id as CommitId,
      message: row.base_message,
      at: row.base_at,
      authorActor: row.base_author_actor,
    },
    // status は保存時に BranchMetaSchema で検証済 (API 境界の責務)
    status: row.status as BranchStatus,
    sheetId: row.sheet_id as SheetId,
    trunkFileId,
    branchFileId: row.branch_file_id as FileId,
  };
}
