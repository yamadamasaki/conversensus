import { randomUUID } from 'node:crypto';
import {
  ConversensusFileSchema,
  CreateFileRequestSchema,
  type EdgeId,
  type FileId,
  type GraphFile,
  type NodeId,
  type SheetId,
  UpdateFileRequestSchema,
} from '@conversensus/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { deleteFile, listFiles, readFile, writeFile } from './storage';

const SERVER_PORT = 3000;
const LOCALHOST_ORIGIN_PREFIX = 'http://localhost:';
const DEFAULT_FILE_NAME = '無題';
const DEFAULT_SHEET_NAME = 'Sheet 1';

const app = new Hono();

app.use(
  '*',
  cors({
    origin: (origin) =>
      origin?.startsWith(LOCALHOST_ORIGIN_PREFIX) ? origin : null,
  }),
);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
});

// GET /files - ファイル一覧
app.get('/files', async (c) => {
  const files = await listFiles();
  return c.json(files);
});

// POST /files - 新規ファイル作成
app.post('/files', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = CreateFileRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
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
  await writeFile(data);
  return c.json(data, 201);
});

// GET /files/:id - ファイル取得
app.get('/files/:id', async (c) => {
  const data = await readFile(c.req.param('id'));
  if (!data) return c.json({ error: 'Not found' }, 404);
  return c.json(data);
});

// PUT /files/:id - ファイル更新 (全体保存)
app.put('/files/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await readFile(id);
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const raw = await c.req.json().catch(() => null);
  const parsed = UpdateFileRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const data: GraphFile = { ...parsed.data, id: existing.id };
  await writeFile(data);
  return c.json(data);
});

// POST /files/import - .conversensus ファイルをインポートして新規ファイルとして保存
app.post('/files/import', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = ConversensusFileSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const { version: _, ...fileData } = parsed.data;
  // sheet/node/edge の ID も再生成し, 参照 (source/target/parentId) を付け替える
  const data: GraphFile = {
    ...fileData,
    id: randomUUID() as FileId,
    sheets: fileData.sheets.map((sheet) => {
      const nodeIdMap = new Map<string, NodeId>(
        sheet.nodes.map((n) => [n.id, randomUUID() as NodeId]),
      );
      return {
        ...sheet,
        id: randomUUID() as SheetId,
        nodes: sheet.nodes.map((n) => ({
          ...n,
          // biome-ignore lint/style/noNonNullAssertion: nodeIdMap は同じ nodes 配列から構築されるため必ず存在する
          id: nodeIdMap.get(n.id)!,
          parentId: n.parentId ? nodeIdMap.get(n.parentId) : undefined,
        })),
        edges: sheet.edges.map((e) => ({
          ...e,
          id: randomUUID() as EdgeId,
          source: (nodeIdMap.get(e.source) ?? e.source) as NodeId,
          target: (nodeIdMap.get(e.target) ?? e.target) as NodeId,
        })),
      };
    }),
  };
  await writeFile(data);
  return c.json(data, 201);
});

// DELETE /files/:id - ファイル削除
app.delete('/files/:id', async (c) => {
  const ok = await deleteFile(c.req.param('id'));
  if (!ok) return c.json({ error: 'Not found' }, 404);
  return c.body(null, 204);
});

export default {
  port: SERVER_PORT,
  fetch: app.fetch,
};

console.log(`server running on http://localhost:${SERVER_PORT}`);
