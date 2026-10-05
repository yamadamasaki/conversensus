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
import {
  ACTOR_SEPARATOR,
  type Actor,
  type Batch,
  knownOpsOf,
  LOCAL_DID,
} from '../events/unified';
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

  /**
   * 未ログインの actor (`local#<deviceId>`) を数える (FPR 前 L-1)。ログインしたときに
   * 「この端末に未ログインで描いたものが N 件 (File: …) あります」と訊くために使う。
   * File ごと・actor ごとの件数を返す (branch 専用の file_id も含む)
   */
  listLocalActorBatches(): { fileId: FileId; actor: Actor; count: number }[] {
    return this.db
      .all<{ file_id: string; actor: string; n: number }>(
        `SELECT file_id, actor, COUNT(*) AS n FROM batches
          WHERE actor LIKE ? GROUP BY file_id, actor ORDER BY file_id, actor`,
        [`${LOCAL_DID}${ACTOR_SEPARATOR}%`],
      )
      .map((row) => ({
        fileId: row.file_id as FileId,
        actor: row.actor,
        count: row.n,
      }));
  }

  /**
   * actor を付け替える (FPR 前 L-1)。**1 トランザクション**で、保存の中にある `from` を
   * すべて `to` にする — batch の actor 列、`deps` の鍵、merge の写しの元 (`copyOf`)、
   * op の中 (branch のコミットの vector など actor を鍵や値に持つもの)。
   *
   * clock・seq・中身の順序は変えない。未ログインの batch は一度も送られていないので、
   * 手元で書き換えても誰とも食い違わない (写しを足すと二重に効き、末尾で他人の編集を
   * 上書きする — 設計 F4)。`to` は新しい actor でなければならない (同じ端末の
   * `did#<deviceId>` は連番がぶつかる, 設計 F5)。
   *
   * @returns 付け替えた batch の数 (actor が `from` だったもの)
   */
  renameActor(from: Actor, to: Actor): number {
    return this.db.transaction(() => {
      const owned = this.db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM batches WHERE actor = ?',
        [to],
      );
      if ((owned?.n ?? 0) > 0) {
        throw new Error(`renameActor: ${to} already has batches`);
      }
      const rows = this.db.all<{
        seq: number;
        actor: string;
        deps_json: string;
        ops_json: string;
        copy_of_json: string | null;
      }>('SELECT seq, actor, deps_json, ops_json, copy_of_json FROM batches');
      let renamed = 0;
      for (const row of rows) {
        const actor = row.actor === from ? to : row.actor;
        const deps = renameInJson(row.deps_json, from, to);
        const ops = renameInJson(row.ops_json, from, to);
        const copyOf =
          row.copy_of_json === null
            ? null
            : renameInJson(row.copy_of_json, from, to);
        if (
          actor === row.actor &&
          deps === row.deps_json &&
          ops === row.ops_json &&
          copyOf === row.copy_of_json
        )
          continue;
        this.db.run(
          `UPDATE batches SET actor = $actor, deps_json = $deps, ops_json = $ops,
                  copy_of_json = $copyOf WHERE seq = $seq`,
          {
            $actor: actor,
            $deps: deps,
            $ops: ops,
            $copyOf: copyOf,
            $seq: row.seq,
          },
        );
        if (actor !== row.actor) renamed += 1;
      }
      return renamed;
    });
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

/**
 * 保存の行 → Batch。**知らない種類の op はここで落とす** (`knownOpsOf`)。保存の JSON には
 * 残すので、クライアントを更新すればその時から効く
 */
function rowToBatch(row: BatchRow): Batch {
  return knownOpsOf({
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
  });
}

/**
 * JSON の中で `from` に**ちょうど一致する**文字列 (鍵と値) を `to` にする。actor は
 * `local#<uuid>` なので、一致すれば同じ actor である。変わらなければ同じ文字列を返す
 */
function renameInJson(json: string, from: string, to: string): string {
  if (!json.includes(from)) return json;
  const walk = (value: unknown): unknown => {
    if (value === from) return to;
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k === from ? to : k, walk(v)]),
      );
    }
    return value;
  };
  return JSON.stringify(walk(JSON.parse(json)));
}
