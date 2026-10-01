import {
  type Batch,
  BatchSchema,
  CreateFileRequestSchema,
  type FileId,
  isBlobCid,
  MAX_BLOB_SIZE,
} from '@conversensus/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { allowedOrigin } from './corsOrigin';
import { getEventStore, getLocalStore } from './eventStoreServer';
import { migrateAllFilesToOplog } from './migrateAllToOplog';
import { watchParent } from './parentWatch';
import { startServer } from './startServer';
import { deleteFile } from './storage';

const DEFAULT_SERVER_PORT = 3000;
/**
 * 待受ポート。`PORT` で上書きできる (既定 3000)。
 * 2 台目の端末を模して 2 組目のデーモンをローカルに立てる検証 (W3d5-7) で使う。
 * データの隔離は `DATA_DIR` (storage.ts) と対で行う。
 */
const SERVER_PORT = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
/**
 * 親プロセス (Tauri アプリ) の PID。渡されたときだけ生存を見張る (Phase 8 S2)。
 *
 * 開発中に手で起動する場合は渡されないので、見張りは働かない。
 */
const PARENT_PID = process.env.PARENT_PID
  ? Number(process.env.PARENT_PID)
  : null;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? null;

const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_UNSUPPORTED_MEDIA_TYPE = 415;
const HTTP_INTERNAL_SERVER_ERROR = 500;
/** `LocalStore.putBlob` が断った理由 → 状態コード */
const BLOB_REJECTION_STATUS = {
  unsupportedType: HTTP_UNSUPPORTED_MEDIA_TYPE,
  empty: HTTP_BAD_REQUEST,
  tooLarge: HTTP_PAYLOAD_TOO_LARGE,
} as const;

const app = new Hono();

app.use(
  '*',
  cors({
    // 判断は `corsOrigin.ts` にある (ここに直書きすると検査できない —
    // `Origin` は禁止ヘッダで、テストから付けられないため)
    origin: (origin) => allowedOrigin(origin, ALLOWED_ORIGIN),
  }),
);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal server error' }, HTTP_INTERNAL_SERVER_ERROR);
});

// GET /files - ファイル一覧 (op-log 単独, Phase 6 p6-2 / 設計 §3.3)
//
// 4e-2a の「snapshot ∪ op-log」から **op-log 単独**へ切り替えた。すべてのファイルが
// op-log を持つようになった (起動時の一括移行 §3.1 + 作成時の genesis 直書き §3.2) ため
// 和集合が不要になり、同時に「name は snapshot 側を正とする」という二重の正典も消える。
//
// 一括移行に失敗した snapshot はここに現れない。無言の消失にしないため、失敗は起動時に
// warn 出力される (migrateAllFilesToOplog)。
app.get('/files', (c) => {
  return c.json(getLocalStore().listFiles());
});

// GET /files/ids - この端末が op-log を持つ file_id の全集合 (ANA-127)
//
// `GET /files` と違い**表示のための除外をしない** — 削除済み (`file.remove`) も含む。
// 用途は remote からの発見 (`discoverRemoteFiles`) の既知集合で、ここから削除済みが
// 抜けると「未知ファイル」と判定されて PDS から materialize され、削除が取り消される。
// **`/files/:id` より先に定義する** — 静的セグメントが param に食われないようにする。
app.get('/files/ids', (c) => {
  return c.json(getLocalStore().listAllFileIds());
});

// POST /files - 新規ファイル作成
app.post('/files', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = CreateFileRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, HTTP_BAD_REQUEST);
  }
  // genesis の op-log まで書く (Phase 6 p6-1)。snapshot は書かない (p6-5a)
  return c.json(getLocalStore().createFile(parsed.data), HTTP_CREATED);
});

// GET /files/:id (snapshot 読取) と PUT /files/:id (全体保存) は Phase 6 p6-3 で
// 撤去した (設計 §3.4 の B 案 / §3.6)。
//
// - **読取**: server に「GraphFile を組み立てて返す」責務を残すと projection の実装が
//   client (`projectFile`) と server の 2 箇所に生まれ、R2 の二重モデルを別の形で
//   再生産する。client が `GET /files/:id/batches` → `projectFile` する。
// - **書込**: client の `persistFile` (snapshot 書込) が消え消費者を失った。状態の
//   書込口は `POST /files/:id/batches` (op-log への追記) ただ一つになった。

// POST /files/import - .conversensus ファイルをインポートして新規ファイルとして保存
app.post('/files/import', async (c) => {
  const raw = await c.req.json().catch(() => null);

  // 解釈・id の振り直し・genesis は `LocalStore.importFile` にある (step3 Phase 2 D2)
  const result = getLocalStore().importFile(raw);
  if (!result.ok) {
    return c.json({ error: result.error }, HTTP_BAD_REQUEST);
  }
  return c.json(result.file, HTTP_CREATED);
});

// --- 操作ログ (batches) エンドポイント (step1 Phase 4 実配線) ---
// 保存モデルは「操作ログ (append) + projection」。集約 (Sheet) の導出は
// projectBatches を持つクライアント側で行うため、サーバは batches の保存・配信に徹する。

// POST /files/:id/batches - 操作ログへ batches を追記 (べき等)
app.post('/files/:id/batches', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!Array.isArray(raw)) {
    return c.json({ error: 'Expected an array of batches' }, HTTP_BAD_REQUEST);
  }
  // 各要素を Batch として検証する (zod を server 直接依存にせず shared の schema を使う)
  const batches: Batch[] = [];
  for (const item of raw) {
    const parsed = BatchSchema.safeParse(item);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, HTTP_BAD_REQUEST);
    }
    batches.push(parsed.data);
  }
  const fileId = c.req.param('id') as FileId;
  const appended = getLocalStore().appendBatches(fileId, batches);
  return c.json({ appended }, HTTP_CREATED);
});

// POST /files/:id/batches/received - remote から受信した batches を追記 (べき等)
//
// **通常の POST /files/:id/batches とは別口にする** (Phase 4d-5)。受信は追記に加えて
// **op-log 正典 marker を同じ tx で立てる** (`appendReceivedBatches`)。
//
// Phase 6 p6-1 で読取時の lazy migration が消えたため、marker の役割は
// 「**起動時の一括移行 (§3.1) に snapshot から作り直させない**」だけになった。
// 受信で materialize されたファイルは元から snapshot を持たないので実害は無いが、
// 同 id の snapshot が残っている環境では依然として意味がある。
// marker 自体は snapshot が消える p6-5 で役目を終える。
app.post('/files/:id/batches/received', async (c) => {
  const raw = await c.req.json().catch(() => null);
  if (!Array.isArray(raw)) {
    return c.json({ error: 'Expected an array of batches' }, HTTP_BAD_REQUEST);
  }
  const batches: Batch[] = [];
  for (const item of raw) {
    const parsed = BatchSchema.safeParse(item);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, HTTP_BAD_REQUEST);
    }
    batches.push(parsed.data);
  }
  const fileId = c.req.param('id') as FileId;
  const appended = getLocalStore().appendReceived(fileId, batches);
  return c.json({ appended }, HTTP_CREATED);
});

// GET /files/:id/batches?since=<clock> - 操作ログを取得 (since より後の clock のみ)
//
// Phase 6 p6-1 で **読取時の lazy migration を撤去した**。ファイルは作られた時点で
// op-log を持ち (§3.2)、それ以前からある snapshot は起動時の一括移行が処理する (§3.1)。
// これにより「読んだだけで op-log が DELETE される」経路 (4d-0 §1.8 の事故) が消滅する。
app.get('/files/:id/batches', (c) => {
  const fileId = c.req.param('id') as FileId;
  const since = c.req.query('since');
  return c.json(
    getLocalStore().getBatches(
      fileId,
      since === undefined ? undefined : Number(since),
    ),
  );
});

// DELETE /files/:id - ファイル削除 (op-log 正典, Phase 6 p6-2 / 設計 §3.5)
//
// 正典は `EventStore.deleteFile` (batches / commits / branches / marker を 1 tx)。
// snapshot 削除も併せて呼ぶのは、まだ書かれているため (p6-5 でこの行ごと落とす) と、
// 一括移行に失敗して op-log を持たないファイルにも削除手段を残すため。
// どちらも「対象なし」なら 404 とする。
app.delete('/files/:id', async (c) => {
  const id = c.req.param('id');
  const oplogDeleted = getLocalStore().deleteFile(id as FileId);
  // 不正な id 形式では storage が throw する (パストラバーサル対策)。op-log 側の結果で
  // 応答したいので握り潰す — 不正 id は op-log にも在り得ないので結果は 404 になる。
  const snapshotDeleted = await deleteFile(id).catch(() => false);
  if (!oplogDeleted && !snapshotDeleted) {
    return c.json({ error: 'Not found' }, HTTP_NOT_FOUND);
  }
  return c.body(null, HTTP_NO_CONTENT);
});

// POST /blobs - 画像などのバイナリを格納する (ANA-116 S2)
//
// content-addressed なストア: **cid はサーバが計算する**。クライアントの申告を鍵に
// 使うと、内容と一致しない cid で汚染できてしまうため。クライアントも同じ値を
// `computeBlobCid` で先に計算できる (CIDv1 / raw / sha-256) ので、往復は要らない。
//
// 同じ内容を 2 回送っても行は 1 つ、返る cid も同じ (冪等)。
// **ファイルには紐づけない** — blob はどのファイル・どのバージョンからも参照されうる。
app.post('/blobs', async (c) => {
  const mimeType = c.req.header('content-type');
  if (!mimeType) {
    return c.json({ error: 'Content-Type required' }, HTTP_BAD_REQUEST);
  }
  // 本文を読む前に申告された大きさで弾く。読み切ってから 413 を返すと、
  // 巨大な body をいったん全部メモリに載せることになる (申告は嘘をつけるので、
  // 読み終わった後の検査は `LocalStore.putBlob` が持つ)。
  const declaredLength = Number(c.req.header('content-length') ?? 0);
  if (declaredLength > MAX_BLOB_SIZE) {
    return c.json(
      { error: `Blob too large (max ${MAX_BLOB_SIZE} bytes)` },
      HTTP_PAYLOAD_TOO_LARGE,
    );
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  // **画像だけを受ける**・空と上限超過を断る判断は `LocalStore.putBlob` にある。
  // 保存した Content-Type は GET でそのまま返るので、任意の型を通すと daemon の origin で
  // HTML を配れてしまう
  const result = await getLocalStore().putBlob(bytes, mimeType);
  if (!result.ok) {
    return c.json(
      { error: result.message },
      BLOB_REJECTION_STATUS[result.reason],
    );
  }
  return c.json(result.blob, HTTP_CREATED);
});

// GET /blobs/:cid - blob の実体を返す
app.get('/blobs/:cid', (c) => {
  const cid = c.req.param('cid');
  if (!isBlobCid(cid)) {
    return c.json({ error: 'Invalid blob cid' }, HTTP_BAD_REQUEST);
  }
  const blob = getLocalStore().getBlob(cid);
  if (!blob) return c.json({ error: 'Not found' }, HTTP_NOT_FOUND);
  return c.body(blob.bytes as unknown as ArrayBuffer, {
    headers: {
      'Content-Type': blob.mimeType,
      'Content-Length': String(blob.size),
      // POST 側で image/* に絞ってあるが、**保存時の検査を最後の砦にしない** —
      // 既に入っている行や将来の用途拡張で型が広がっても、ブラウザが中身を
      // 見て HTML と解釈することは無くなる
      'X-Content-Type-Options': 'nosniff',
      // content-addressed なので内容は永久に変わらない
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

// 起動時の一括移行 (step1 Phase 6 p6-0, 設計 §3.1)。
// `import.meta.main` で **デーモンとして起動されたときだけ** 走らせる — テストは本
// モジュールを import するので、無条件に走らせると `DATA_DIR` 差し替え前 (既定 = リポジトリの
// `data/`) の開発者データを移行してしまう。
if (import.meta.main) {
  const migration = await migrateAllFilesToOplog(getEventStore());
  if (migration.scanned > 0) {
    console.log(
      `[migration] snapshot ${migration.scanned} 件を走査: ` +
        `${migration.migrated.length} 件を op-log 化 / ${migration.skipped} 件は移行済 / ` +
        `${migration.failed.length} 件失敗 (${migration.elapsedMs.toFixed(1)}ms)`,
    );
  }

  // **bind を終えてから「起動した」と名乗る** (Phase 8 S1)。
  // 以前は `export default { port, fetch }` を bun に渡して起動を任せており、
  // メッセージはモジュール評価の時点で出ていたので、ポートが埋まっていると
  // 「起動した」と言ってから落ちていた。`startServer` は実際に掴んだポートを返すので、
  // その値を使うこのメッセージは bind の後にしか組めない。
  const server = startServer({ port: SERVER_PORT, fetch: app.fetch });
  console.log(`server running on http://localhost:${server.port}`);

  // **親 (Tauri アプリ) が異常終了したら道連れに終わる** (Phase 8 S2)。
  // 正常終了なら Tauri が sidecar を kill するのでここは働かないが、強制終了された
  // 場合はアプリ側が何も実行できないため、こちらから気付くしかない。残った孤児は
  // 同じポートを掴んだまま次回の起動を壊す (実測は parentWatch.ts 冒頭)。
  if (PARENT_PID !== null) {
    watchParent({
      pid: PARENT_PID,
      onGone: () => {
        console.log(`親プロセス ${PARENT_PID} が居なくなったので終了します`);
        server.stop();
        process.exit(0);
      },
    });
  }
}

/**
 * テストが実 HTTP ハンドラを叩くための口。
 *
 * **`export default` にはしない** — 既定エクスポートがサーバ設定の形をしていると
 * bun が入口で自動的に待受を始めてしまい、上の `startServer` と二重に bind する。
 */
export { app };
