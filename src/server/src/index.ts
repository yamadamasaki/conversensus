import { randomUUID } from 'node:crypto';
import {
  type Batch,
  BatchSchema,
  type BranchId,
  BranchMetaSchema,
  CommitSchema,
  ConversensusFileSchema,
  ConversensusFileV1Schema,
  ConversensusFileV2Schema,
  ConversensusFileV3Schema,
  CreateFileRequestSchema,
  type EdgeId,
  type FileId,
  type GraphFile,
  graphFileToBatches,
  migrateV1toV2,
  migrateV2toV3,
  migrateV3toV4,
  type NodeId,
  type SheetId,
} from '@conversensus/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getEventStore } from './eventStoreServer';
import { migrateAllFilesToOplog } from './migrateAllToOplog';
import { W3_SCHEMA_VERSION } from './migrateFileToOplog';
import { deleteFile } from './storage';

/**
 * 新規ファイルの op-log を genesis で初期化する (Phase 6 p6-1, 設計 §3.2)。
 *
 * `appendReceivedBatches` を使うのは **marker を同じ tx で立てる**ため。marker は
 * 4d-0 以来「この op-log は正典であり snapshot から作り直してはならない」宣言であり、
 * genesis 直書きしたファイルにこそ当てはまる (起動時の一括移行 §3.1 に拾わせない)。
 * メソッド名が「received」なのは受信経路が最初の利用者だった名残で、意味は
 * 「追記 + 正典宣言」。
 */
function initializeOplog(fileId: FileId, file: GraphFile): void {
  getEventStore().appendReceivedBatches(
    fileId,
    graphFileToBatches(file),
    W3_SCHEMA_VERSION,
  );
}

const DEFAULT_SERVER_PORT = 3000;
/**
 * 待受ポート。`PORT` で上書きできる (既定 3000)。
 * 2 台目の端末を模して 2 組目のデーモンをローカルに立てる検証 (W3d5-7) で使う。
 * データの隔離は `DATA_DIR` (storage.ts) と対で行う。
 */
const SERVER_PORT = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const LOCALHOST_ORIGIN_PREFIX = 'http://localhost:';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? null;
const DEFAULT_FILE_NAME = '無題';
const DEFAULT_SHEET_NAME = 'Sheet 1';

const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_SERVER_ERROR = 500;

const app = new Hono();

app.use(
  '*',
  cors({
    origin: (origin) => {
      if (origin?.startsWith(LOCALHOST_ORIGIN_PREFIX)) return origin;
      if (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) return ALLOWED_ORIGIN;
      return null;
    },
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
  return c.json(getEventStore().listOplogFiles());
});

// POST /files - 新規ファイル作成
app.post('/files', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = CreateFileRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, HTTP_BAD_REQUEST);
  }
  const body = parsed.data;
  const id = randomUUID() as FileId;
  const data: GraphFile = {
    id,
    name: body.name ?? DEFAULT_FILE_NAME,
    description: body.description,
    sheets: [
      {
        id: randomUUID() as SheetId,
        name: body.sheet?.name ?? DEFAULT_SHEET_NAME,
        nodes: [],
        edges: [],
      },
    ],
  };
  // Phase 6 p6-1: op-log を作る。作られた時点で op-log 正典なので読取時の
  // lazy migration は不要になった (§3.2)。
  initializeOplog(id, data);
  // Phase 6 p6-5a: snapshot 書込はここから消えた。p6-3 で読取経路が全て消えて
  // write-only になっていたもので、これで **新しい snapshot は二度と作られない**
  // (設計 §5-2)。既存 snapshot の移行と後始末だけが `storage.ts` に残る。
  return c.json(data, HTTP_CREATED);
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

  // v4 を試み, 失敗したら v3→v4, v2→v3→v4, v1→v2→v3→v4 とマイグレーション
  let parsedFile: ReturnType<typeof ConversensusFileSchema.safeParse>;
  const parsedV4 = ConversensusFileSchema.safeParse(raw);
  if (parsedV4.success) {
    parsedFile = parsedV4;
  } else {
    const parsedV3 = ConversensusFileV3Schema.safeParse(raw);
    if (parsedV3.success) {
      parsedFile = ConversensusFileSchema.safeParse(
        migrateV3toV4(parsedV3.data),
      );
    } else {
      const parsedV2 = ConversensusFileV2Schema.safeParse(raw);
      if (parsedV2.success) {
        parsedFile = ConversensusFileSchema.safeParse(
          migrateV3toV4(migrateV2toV3(parsedV2.data)),
        );
      } else {
        const parsedV1 = ConversensusFileV1Schema.safeParse(raw);
        if (parsedV1.success) {
          parsedFile = ConversensusFileSchema.safeParse(
            migrateV3toV4(migrateV2toV3(migrateV1toV2(parsedV1.data))),
          );
        } else {
          return c.json({ error: parsedV4.error.flatten() }, HTTP_BAD_REQUEST);
        }
      }
    }
  }

  if (!parsedFile.success) {
    return c.json({ error: parsedFile.error.flatten() }, HTTP_BAD_REQUEST);
  }

  const { version: _, ...fileData } = parsedFile.data;
  // sheet/node/edge/layout の ID も再生成し, 参照 (source/target/parentId/nodeId) を付け替える
  const data: GraphFile = {
    ...fileData,
    id: randomUUID() as FileId,
    sheets: fileData.sheets.map((sheet) => {
      const nodeIdMap = new Map<string, NodeId>(
        sheet.nodes.map((n) => [n.id, randomUUID() as NodeId]),
      );
      const edgeIdMap = new Map<string, EdgeId>(
        sheet.edges.map((e) => [e.id, randomUUID() as EdgeId]),
      );
      return {
        ...sheet,
        id: randomUUID() as SheetId,
        nodes: sheet.nodes.map((n) => ({
          ...n,
          // biome-ignore lint/style/noNonNullAssertion: nodeIdMap は同じ nodes 配列から構築されるため必ず存在する
          id: nodeIdMap.get(n.id)!,
          ...(n.parentId
            ? { parentId: (nodeIdMap.get(n.parentId) ?? n.parentId) as NodeId }
            : {}),
        })),
        edges: sheet.edges.map((e) => ({
          ...e,
          // biome-ignore lint/style/noNonNullAssertion: edgeIdMap は同じ edges 配列から構築されるため必ず存在する
          id: edgeIdMap.get(e.id)!,
          source: (nodeIdMap.get(e.source) ?? e.source) as NodeId,
          target: (nodeIdMap.get(e.target) ?? e.target) as NodeId,
        })),
        layouts: sheet.layouts?.map((l) => ({
          ...l,
          nodeId: (nodeIdMap.get(l.nodeId) ?? l.nodeId) as NodeId,
        })),
        edgeLayouts: sheet.edgeLayouts?.map((l) => ({
          ...l,
          edgeId: (edgeIdMap.get(l.edgeId) ?? l.edgeId) as EdgeId,
        })),
      };
    }),
  };
  // Phase 6 p6-1: import も op-log を作る (§3.2)。ID 再生成後の `data` をそのまま
  // genesis 入力にするので、応答の GraphFile と op-log の projection は同じ内容になる。
  initializeOplog(data.id, data);
  // POST /files と同じく snapshot は書かない (p6-5a)
  return c.json(data, HTTP_CREATED);
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
  const appended = getEventStore().appendBatches(fileId, batches);
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
  const appended = getEventStore().appendReceivedBatches(
    fileId,
    batches,
    W3_SCHEMA_VERSION,
  );
  return c.json({ appended }, HTTP_CREATED);
});

// GET /files/:id/batches?since=<clock> - 操作ログを取得 (since より後の clock のみ)
//
// Phase 6 p6-1 で **読取時の lazy migration を撤去した**。ファイルは作られた時点で
// op-log を持ち (§3.2)、それ以前からある snapshot は起動時の一括移行が処理する (§3.1)。
// これにより「読んだだけで op-log が DELETE される」経路 (4d-0 §1.8 の事故) が消滅する。
app.get('/files/:id/batches', (c) => {
  const fileId = c.req.param('id') as FileId;
  const batches = getEventStore().getBatches(fileId);
  const since = c.req.query('since');
  const result: Batch[] =
    since === undefined
      ? batches
      : batches.filter((b) => b.clock > Number(since));
  return c.json(result);
});

// --- ブランチ / コミットのメタ情報エンドポイント (step1 Phase 5) ---
// batches と違いこれらは**ログではなくメタ**なので上書き保存 (INSERT OR REPLACE)。
// いずれも local daemon 専用の経路で、remote へは同期しない (設計 §9.2 の不変条件)。

// POST /files/:id/commits - コミット (ログ上のラベル付きオフセット) を保存
app.post('/files/:id/commits', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = CommitSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, HTTP_BAD_REQUEST);
  }
  getEventStore().saveCommit(c.req.param('id') as FileId, parsed.data);
  return c.json(parsed.data, HTTP_CREATED);
});

// GET /files/:id/commits - ファイルのコミット一覧 (at 昇順)
app.get('/files/:id/commits', (c) => {
  return c.json(getEventStore().getCommits(c.req.param('id') as FileId));
});

// POST /files/:id/branches - ブランチのメタ情報を保存 (:id = 分岐元 trunk)
app.post('/files/:id/branches', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = BranchMetaSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, HTTP_BAD_REQUEST);
  }
  // URL の trunk と body の trunkFileId が食い違うと、以後 GET で取り出せない
  // ブランチが静かに生まれる。境界で弾く。
  const fileId = c.req.param('id');
  if (parsed.data.trunkFileId !== fileId) {
    return c.json(
      { error: 'trunkFileId does not match the URL file id' },
      HTTP_BAD_REQUEST,
    );
  }
  getEventStore().saveBranch(parsed.data);
  return c.json(parsed.data, HTTP_CREATED);
});

// GET /files/:id/branches - trunk のブランチ一覧 (base オフセット昇順)
app.get('/files/:id/branches', (c) => {
  return c.json(getEventStore().getBranches(c.req.param('id') as FileId));
});

// DELETE /files/:id/branches/:branchId - ブランチを削除 (:id = 分岐元 trunk)
//
// メタ行だけでなく branch 専用 file_id の op-log / commit もまとめて消す
// (`EventStore.deleteBranch`)。trunk を URL で受けるのは、他ファイルのブランチを
// id だけで消せないようにするため。
app.delete('/files/:id/branches/:branchId', (c) => {
  const deleted = getEventStore().deleteBranch(
    c.req.param('id') as FileId,
    c.req.param('branchId') as BranchId,
  );
  if (!deleted) return c.json({ error: 'Not found' }, HTTP_NOT_FOUND);
  return c.body(null, HTTP_NO_CONTENT);
});

// DELETE /files/:id - ファイル削除 (op-log 正典, Phase 6 p6-2 / 設計 §3.5)
//
// 正典は `EventStore.deleteFile` (batches / commits / branches / marker を 1 tx)。
// snapshot 削除も併せて呼ぶのは、まだ書かれているため (p6-5 でこの行ごと落とす) と、
// 一括移行に失敗して op-log を持たないファイルにも削除手段を残すため。
// どちらも「対象なし」なら 404 とする。
app.delete('/files/:id', async (c) => {
  const id = c.req.param('id');
  const oplogDeleted = getEventStore().deleteFile(id as FileId);
  // 不正な id 形式では storage が throw する (パストラバーサル対策)。op-log 側の結果で
  // 応答したいので握り潰す — 不正 id は op-log にも在り得ないので結果は 404 になる。
  const snapshotDeleted = await deleteFile(id).catch(() => false);
  if (!oplogDeleted && !snapshotDeleted) {
    return c.json({ error: 'Not found' }, HTTP_NOT_FOUND);
  }
  return c.body(null, HTTP_NO_CONTENT);
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
}

export default {
  port: SERVER_PORT,
  fetch: app.fetch,
};

console.log(`server running on http://localhost:${SERVER_PORT}`);
