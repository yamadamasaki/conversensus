import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { randomUUID } from 'node:crypto'
import type { GraphFile } from '@conversensus/shared'
import { listFiles, readFile, writeFile, deleteFile } from './storage'

const app = new Hono()

app.use('*', cors({ origin: 'http://localhost:5173' }))

// GET /files - ファイル一覧
app.get('/files', async (c) => {
  const files = await listFiles()
  return c.json(files)
})

// POST /files - 新規ファイル作成
app.post('/files', async (c) => {
  const body = await c.req.json<Partial<GraphFile>>()
  const id = randomUUID()
  const data: GraphFile = {
    id,
    name: body.name ?? '無題',
    description: body.description,
    sheet: {
      id: randomUUID(),
      name: body.sheet?.name ?? 'Sheet 1',
      nodes: [],
      edges: [],
    },
  }
  await writeFile(data)
  return c.json(data, 201)
})

// GET /files/:id - ファイル取得
app.get('/files/:id', async (c) => {
  const data = await readFile(c.req.param('id'))
  if (!data) return c.json({ error: 'Not found' }, 404)
  return c.json(data)
})

// PUT /files/:id - ファイル更新 (全体保存)
app.put('/files/:id', async (c) => {
  const id = c.req.param('id')
  const existing = await readFile(id)
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.json<GraphFile>()
  const data: GraphFile = { ...body, id }
  await writeFile(data)
  return c.json(data)
})

// DELETE /files/:id - ファイル削除
app.delete('/files/:id', async (c) => {
  const ok = await deleteFile(c.req.param('id'))
  if (!ok) return c.json({ error: 'Not found' }, 404)
  return c.body(null, 204)
})

export default {
  port: 3000,
  fetch: app.fetch,
}

console.log('server running on http://localhost:3000')
