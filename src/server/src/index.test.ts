import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import server from './index';

let tmpDir: string;
const fetch = server.fetch;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'conversensus-api-test-'));
  process.env.DATA_DIR = tmpDir;
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  await rm(tmpDir, { recursive: true, force: true });
});

async function createFile(name?: string) {
  return fetch(
    new Request('http://localhost/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name ?? '無題' }),
    }),
  );
}

describe('API routes', () => {
  describe('GET /files', () => {
    it('初期状態では空配列を返す', async () => {
      const res = await fetch(new Request('http://localhost/files'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });
  });

  describe('POST /files', () => {
    it('ファイルを作成して 201 を返す', async () => {
      const res = await createFile('新規ファイル');
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe('新規ファイル');
      expect(body.id).toBeTruthy();
      expect(body.sheets).toBeArrayOfSize(1);
    });

    it('name 省略時は "無題" になる', async () => {
      const res = await fetch(
        new Request('http://localhost/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      );
      const body = await res.json();
      expect(body.name).toBe('無題');
    });
  });

  describe('GET /files/:id', () => {
    it('作成したファイルを取得できる', async () => {
      const created = await (await createFile('テスト')).json();
      const res = await fetch(
        new Request(`http://localhost/files/${created.id}`),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).id).toBe(created.id);
    });

    it('存在しない ID は 404 を返す', async () => {
      const res = await fetch(
        new Request('http://localhost/files/nonexistent'),
      );
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /files/:id', () => {
    it('ファイルを更新できる', async () => {
      const created = await (await createFile('元の名前')).json();
      const res = await fetch(
        new Request(`http://localhost/files/${created.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...created, name: '新しい名前' }),
        }),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).name).toBe('新しい名前');
    });

    it('存在しない ID への PUT は 404 を返す', async () => {
      const res = await fetch(
        new Request('http://localhost/files/nonexistent', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: 'nonexistent',
            name: 'x',
            sheets: [{ id: 's', name: 's', nodes: [], edges: [] }],
          }),
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /files/:id', () => {
    it('ファイルを削除すると 204 を返す', async () => {
      const created = await (await createFile('削除対象')).json();
      const res = await fetch(
        new Request(`http://localhost/files/${created.id}`, {
          method: 'DELETE',
        }),
      );
      expect(res.status).toBe(204);
    });

    it('削除後は GET で 404 になる', async () => {
      const created = await (await createFile('削除対象')).json();
      await fetch(
        new Request(`http://localhost/files/${created.id}`, {
          method: 'DELETE',
        }),
      );
      const res = await fetch(
        new Request(`http://localhost/files/${created.id}`),
      );
      expect(res.status).toBe(404);
    });

    it('存在しない ID への DELETE は 404 を返す', async () => {
      const res = await fetch(
        new Request('http://localhost/files/nonexistent', { method: 'DELETE' }),
      );
      expect(res.status).toBe(404);
    });
  });

  describe('POST /files/import', () => {
    const validPayload = () => ({
      version: '1',
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      name: 'インポートファイル',
      description: 'テスト',
      sheets: [
        {
          id: 'ffffffff-0000-1111-2222-333333333333',
          name: 'Sheet 1',
          nodes: [],
          edges: [],
        },
      ],
    });

    it('正常なファイルをインポートして 201 を返す', async () => {
      const res = await fetch(
        new Request('http://localhost/files/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload()),
        }),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe('インポートファイル');
      expect(body.sheets).toBeArrayOfSize(1);
    });

    it('インポート後はファイル/シート/ノード/エッジの ID がすべて再生成される', async () => {
      const payload = validPayload();
      // ノードとエッジを含むシートに拡張
      const nodeId = '11111111-1111-1111-1111-111111111111';
      const edgeId = '22222222-2222-2222-2222-222222222222';
      payload.sheets[0].nodes = [
        { id: nodeId, content: 'テスト', style: { x: 0, y: 0 } },
      ];
      payload.sheets[0].edges = [
        { id: edgeId, source: nodeId, target: nodeId },
      ];
      const res = await fetch(
        new Request('http://localhost/files/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      );
      const body = await res.json();
      expect(body.id).not.toBe(payload.id);
      expect(body.sheets[0].id).not.toBe(payload.sheets[0].id);
      expect(body.sheets[0].nodes[0].id).not.toBe(nodeId);
      expect(body.sheets[0].edges[0].id).not.toBe(edgeId);
      // source/target も新 ID に付け替えられている
      expect(body.sheets[0].edges[0].source).toBe(body.sheets[0].nodes[0].id);
    });

    it('インポートしたファイルが一覧に現れる', async () => {
      await fetch(
        new Request('http://localhost/files/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPayload()),
        }),
      );
      const list = await (
        await fetch(new Request('http://localhost/files'))
      ).json();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('インポートファイル');
    });

    it('version フィールドがない場合は 400 を返す', async () => {
      const { version: _, ...noVersion } = validPayload();
      const res = await fetch(
        new Request('http://localhost/files/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(noVersion),
        }),
      );
      expect(res.status).toBe(400);
    });

    it('version が不正な値の場合は 400 を返す', async () => {
      const res = await fetch(
        new Request('http://localhost/files/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...validPayload(), version: '99' }),
        }),
      );
      expect(res.status).toBe(400);
    });

    it('sheets フィールドがない場合は 400 を返す', async () => {
      const { sheets: _, ...noSheets } = validPayload();
      const res = await fetch(
        new Request('http://localhost/files/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(noSheets),
        }),
      );
      expect(res.status).toBe(400);
    });
  });
});
