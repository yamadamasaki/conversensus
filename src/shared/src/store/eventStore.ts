/**
 * ローカル永続層: 操作ログ (batches) + projection (step1 Phase 3)
 *
 * O1 の確定 (SQLite) に基づく永続層。**SQL のエンジンには依らない** (`SqlDriver`, step3 Phase 2 D1) —
 * テストとローカルサーバは `bun:sqlite`、ブラウザは SQLite-WASM の `opfs` VFS で同じものが動く。
 * 保存モデルは「append-only な操作ログ + projection」:
 *   - batches テーブルへ Batch を追記するのみ (更新・削除しない)。
 *   - グラフ状態 (Sheet) は保存せず、batches の projection で導出する。
 *   - branch / commit のメタも op-log に載る (step2 Phase 3 T7-1)。専用のテーブルは持たない。
 *
 * 現行 `storage.ts` (GraphFile を JSON スナップショットで丸ごと保存) の置換候補。
 * 非破壊: 本 Phase では EventStore を追加するのみで、HTTP API の載せ替えは Phase 4 以降。
 */

import type { BlobCid, MimeType } from '../blob';
import {
  isFileDeleted,
  projectBatches,
  projectFile,
  toSheet,
} from '../events/project';
import type { Batch } from '../events/unified';
import type { FileId, GraphFileListItem, Sheet, SheetId } from '../schemas';
import type { SqlDriver } from './sqlDriver';

/** batches の 1 行 (ops は JSON 文字列で保持する) */
type BatchRow = {
  batch_id: string;
  actor: string;
  clock: number;
  dot_seq: number;
  deps_json: string;
  timestamp: number;
  ops_json: string;
  // content batch の所属シート。structure (file-level) batch は NULL (W3c2)
  sheet_id: string | null;
  // merge の写しだけが持つ (step2 Phase 3 T7-4)。それ以外は NULL
  copy_of_json: string | null;
  merged_in: string | null;
};

/** blobs の 1 行 (bytes は SQLite の BLOB として返る) */
type BlobRow = {
  mime_type: string;
  size: number;
  bytes: Uint8Array;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS batches (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id    TEXT    NOT NULL,
  batch_id   TEXT    NOT NULL,
  actor      TEXT    NOT NULL,
  clock      INTEGER NOT NULL,
  -- 因果の点と依存 (step3 Phase 1)。行の採番の seq 列と名前がぶつかるので dot_seq にする
  dot_seq    INTEGER NOT NULL,
  deps_json  TEXT    NOT NULL,
  timestamp  INTEGER NOT NULL,
  ops_json   TEXT    NOT NULL,
  sheet_id   TEXT,
  -- merge の写しなら元の点 ({ actor, seq } の JSON)。写しでなければ NULL (step3 Phase 1 D2)
  copy_of_json TEXT,
  merged_in  TEXT,
  UNIQUE(file_id, batch_id)
);
CREATE INDEX IF NOT EXISTS idx_batches_file_order
  ON batches (file_id, clock, timestamp, batch_id);

-- 画像などのバイナリ (ANA-116)。content-addressed なので cid が主キーで、
-- 同じ内容は 1 行しか持たない。**ファイルには紐づけない** — blob は
-- どのファイル・どのバージョンからも参照されうる共有ストアである。
CREATE TABLE IF NOT EXISTS blobs (
  cid        TEXT    PRIMARY KEY,
  mime_type  TEXT    NOT NULL,
  size       INTEGER NOT NULL,
  bytes      BLOB    NOT NULL
);
`;

/**
 * 操作ログの永続ストア。1 インスタンス = 1 データベース。
 * ファイル (グラフ) ごとに file_id で batches を仕切る。
 */
export class EventStore {
  private readonly db: SqlDriver;

  /** @param db SQL ドライバ。テストでは `new BunSqliteDriver(IN_MEMORY)` を渡す */
  constructor(db: SqlDriver) {
    this.db = db;
    this.db.exec(SCHEMA);
  }

  /**
   * Batch を操作ログへ追記する。
   *
   * (file_id, batch_id) が既存なら何もしない (べき等: 同一 Batch の重複適用を無視)。
   *
   * step2 では merge の写しだけがこの例外で、同じ id が別の clock で届くと位置を置き換えていた。
   * step3 Phase 1 D2 で写しは merge した人自身の batch (新しい id) になったので、**例外は無くなり、
   * 追記のみに戻った**。同じ元を指す写しの重複は畳み込み (`orderBatches`) が除く。
   *
   * @returns 新規に追記されたら true。既存なら false
   */
  appendBatch(fileId: FileId, batch: Batch): boolean {
    // 永続化の最小不変条件: 空 ops の Batch (no-op 行) をログに残さない。
    // UUID フォーマット等の検証は外部 API 境界 (HTTP) の責務 (CLAUDE.md)。
    if (batch.ops.length === 0) {
      throw new Error('Cannot append a batch with empty ops');
    }
    const result = this.db.run(
      `INSERT OR IGNORE INTO batches
         (file_id, batch_id, actor, clock, dot_seq, deps_json, timestamp,
          ops_json, sheet_id, copy_of_json, merged_in)
       VALUES ($file, $id, $actor, $clock, $dotSeq, $deps, $ts, $ops, $sheet,
               $copyOf, $mergedIn)`,
      {
        $file: fileId,
        $id: batch.id,
        $actor: batch.actor,
        $clock: batch.clock,
        $dotSeq: batch.seq,
        $deps: JSON.stringify(batch.deps),
        $ts: batch.timestamp,
        $ops: JSON.stringify(batch.ops),
        // content batch は sheetId を持つ。structure batch は NULL (W3c2)
        $sheet: batch.sheetId ?? null,
        $copyOf: batch.copyOf ? JSON.stringify(batch.copyOf) : null,
        $mergedIn: batch.mergedIn ?? null,
      },
    );
    return result.changes > 0;
  }

  /** 複数 Batch を 1 トランザクションで追記する。@returns 新規追記された件数 */
  appendBatches(fileId: FileId, batches: Batch[]): number {
    return this.db.transaction(() => {
      let inserted = 0;
      for (const batch of batches) {
        if (this.appendBatch(fileId, batch)) inserted += 1;
      }
      return inserted;
    });
  }

  /**
   * ファイルの全 Batch を取得する。
   * 追記順を安定させるため (clock, timestamp, batch_id) 昇順で返すが、
   * projection は決定論のため内部で再整列する (projectBatches)。
   */
  getBatches(fileId: FileId): Batch[] {
    const rows = this.db.all<BatchRow>(
      `SELECT batch_id, actor, clock, dot_seq, deps_json, timestamp, ops_json,
              sheet_id, copy_of_json, merged_in
         FROM batches
        WHERE file_id = ?
        ORDER BY clock, timestamp, batch_id`,
      [fileId],
    );
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
   * op-log に batch を持つ file_id を**すべて**返す (ANA-127)。
   *
   * `listOplogFiles` との違いは「表示のための除外を一切しない」ことである。
   * 削除済み・0 シート・branch 専用 file_id もそのまま含む。用途は 1 つで、
   * remote からの発見 (`discoverRemoteFiles`) が「この端末が知らない fileId」を
   * 求めるときの既知集合になる。
   *
   * 一覧 (`listOplogFiles`) を既知集合に流用してはいけない — 削除済みファイルが
   * 「未知」に化けて PDS から materialize され、削除が取り消される (ANA-127 の再発)。
   */
  listAllFileIds(): FileId[] {
    return this.db
      .all<{ file_id: string }>(
        'SELECT file_id FROM batches GROUP BY file_id ORDER BY MIN(seq)',
      )
      .map((row) => row.file_id as FileId);
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
    const rows = this.db.all<{ file_id: string }>(
      'SELECT file_id FROM batches GROUP BY file_id ORDER BY MIN(seq)',
    );
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

  /**
   * ファイルを op-log ごと削除する (step1 Phase 6 p6-2, 設計 §3.5)。
   *
   * **1 tx** で、当該 file_id と、その trunk から作られた branch の file_id の
   * batches をまとめて消す。
   *
   * branch を巻き込むのは、branch の中身へは trunk の op-log の `branch.create` からしか
   * 辿れないためである — trunk だけ消すと参照者のいない batch が永久に残る。
   * **消された branch (`branch.remove`) も含める** — 中身の op-log は残っているので。
   *
   * step2 T7-1 で branch のメタが op-log へ移って以降、ここは SQLite の branches テーブルから
   * branch を引いていて、**そのテーブルには何も入らなくなっていた** (branch の op-log が孤児として
   * 残っていた)。step3 Phase 1 でテーブルごと撤去し、op-log から引くようにした。
   *
   * 【§1.3 の穴】これ以前の `DELETE /files/:id` は snapshot しか消していなかった。
   * Phase 4e で snapshot を持たない op-log-only ファイル (受信 materialize) が
   * 生まれて以降、それらは削除不能で、削除できたファイルも op-log が残っていた。
   *
   * @returns 1 行でも消したら true、対象が何も無ければ false (= 404 の根拠)
   */
  deleteFile(fileId: FileId): boolean {
    return this.db.transaction(() => {
      const branchFileIds = branchFileIdsOf(this.getBatches(fileId));
      let removed = 0;
      for (const id of [fileId, ...branchFileIds]) {
        removed += this.db.run('DELETE FROM batches WHERE file_id = $file', {
          $file: id,
        }).changes;
      }
      return removed > 0;
    });
  }

  /**
   * blob を格納する (ANA-116)。
   *
   * **cid は呼び出し側が `computeBlobCid` で計算したものを渡す** — 検証を含めた
   * content-addressed の担保は API 境界 (HTTP) の責務である (`appendBatch` と同じ方針)。
   * 同じ cid が既にあれば何もしない: 内容が同じであることは cid が保証しているので、
   * 上書きしても結果は変わらない。
   *
   * @returns 新規に格納したら true、既存で無視したら false
   */
  putBlob(cid: BlobCid, bytes: Uint8Array, mimeType: MimeType): boolean {
    const result = this.db.run(
      `INSERT OR IGNORE INTO blobs (cid, mime_type, size, bytes)
       VALUES ($cid, $mime, $size, $bytes)`,
      {
        $cid: cid,
        $mime: mimeType,
        $size: bytes.byteLength,
        $bytes: bytes,
      },
    );
    return result.changes > 0;
  }

  /** blob を取り出す。無ければ null */
  getBlob(
    cid: BlobCid,
  ): { bytes: Uint8Array; mimeType: MimeType; size: number } | null {
    const row = this.db.get<BlobRow>(
      'SELECT mime_type, size, bytes FROM blobs WHERE cid = ?',
      [cid],
    );
    if (!row) return null;
    return {
      bytes: new Uint8Array(row.bytes),
      mimeType: row.mime_type,
      size: row.size,
    };
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
    seq: row.dot_seq,
    deps: JSON.parse(row.deps_json) as Batch['deps'],
    timestamp: row.timestamp,
    ops: JSON.parse(row.ops_json) as Batch['ops'],
    // content batch のみ sheet_id を持つ (structure batch は NULL) (W3c2)
    ...(row.sheet_id !== null && { sheetId: row.sheet_id as SheetId }),
    // merge の写しだけが持つ (T7-4)
    ...(row.copy_of_json !== null && {
      copyOf: JSON.parse(row.copy_of_json) as NonNullable<Batch['copyOf']>,
    }),
    ...(row.merged_in !== null && {
      mergedIn: row.merged_in as Batch['mergedIn'],
    }),
  };
}

/** trunk の op-log の `branch.create` が指す branch の file_id (消された branch も含む) */
function branchFileIdsOf(batches: Batch[]): FileId[] {
  const ids = new Set<FileId>();
  for (const batch of batches) {
    for (const op of batch.ops) {
      if (op.kind === 'branch.create') ids.add(op.branchFileId);
    }
  }
  return [...ids];
}
