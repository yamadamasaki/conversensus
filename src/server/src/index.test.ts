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

// 有効な UUID を持つ最小 Batch (node.add 1 件) を作る
const uuid = (seed: number) =>
  `${seed.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
const sampleBatch = (clock: number) => ({
  id: uuid(clock),
  actor: 'local',
  clock,
  timestamp: clock,
  ops: [{ kind: 'node.add', target: uuid(1000 + clock), content: `n${clock}` }],
});

async function postBatches(fileId: string, batches: unknown[]) {
  return fetch(
    new Request(`http://localhost/files/${fileId}/batches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batches),
    }),
  );
}

describe('API routes', () => {
  describe('POST /files/:id/batches', () => {
    it('batches を追記して 201 と件数を返す', async () => {
      const created = await (await createFile('ログ')).json();
      const res = await postBatches(created.id, [
        sampleBatch(1),
        sampleBatch(2),
      ]);
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ appended: 2 });
    });

    it('同一 batch の再送はべき等 (appended=0)', async () => {
      const created = await (await createFile('ログ')).json();
      await postBatches(created.id, [sampleBatch(1)]);
      const res = await postBatches(created.id, [sampleBatch(1)]);
      expect(await res.json()).toEqual({ appended: 0 });
    });

    it('不正な Batch は 400 を返す', async () => {
      const created = await (await createFile('ログ')).json();
      const res = await postBatches(created.id, [{ id: 'not-a-uuid' }]);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /files/:id/batches', () => {
    // snapshot を持たない生 file_id を使い、W3d の lazy migration を発火させずに
    // append/retrieve のみを検証する (createFile は snapshot を書くため migration が走る)。
    const rawId = 'raw-log';

    it('追記した batches を clock 昇順で返す', async () => {
      await postBatches(rawId, [sampleBatch(2), sampleBatch(1)]);
      const res = await fetch(
        new Request(`http://localhost/files/${rawId}/batches`),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.map((b: { clock: number }) => b.clock)).toEqual([1, 2]);
    });

    it('since を渡すと clock > since のみ返す', async () => {
      await postBatches(rawId, [
        sampleBatch(1),
        sampleBatch(2),
        sampleBatch(3),
      ]);
      const res = await fetch(
        new Request(`http://localhost/files/${rawId}/batches?since=1`),
      );
      const body = await res.json();
      expect(body.map((b: { clock: number }) => b.clock)).toEqual([2, 3]);
    });

    it('ログも snapshot も無いファイルは空配列を返す', async () => {
      const res = await fetch(
        new Request(`http://localhost/files/${rawId}/batches`),
      );
      expect(await res.json()).toEqual([]);
    });
  });

  // W3d-1: GET が読み取り前に lazy migration (snapshot→genesis) を実行する
  describe('GET /files/:id/batches — W3d lazy migration', () => {
    it('新規作成ファイル (snapshot のみ) の初回 GET が genesis を返す', async () => {
      const created = await (await createFile('空')).json();
      const res = await fetch(
        new Request(`http://localhost/files/${created.id}/batches`),
      );
      const body = await res.json();
      // 空 snapshot でも file.setName / sheet.create の genesis batch が生成される
      expect(body.length).toBeGreaterThan(0);
      const kinds = body.flatMap((b: { ops: { kind: string }[] }) =>
        b.ops.map((o) => o.kind),
      );
      expect(kinds).toContain('file.setName');
    });

    it('migration はべき等: 二度目の GET も同じ genesis を返す', async () => {
      const created = await (await createFile('反復')).json();
      const first = await (
        await fetch(new Request(`http://localhost/files/${created.id}/batches`))
      ).json();
      const second = await (
        await fetch(new Request(`http://localhost/files/${created.id}/batches`))
      ).json();
      expect(second).toEqual(first);
    });

    it('初回 read 前に積まれた pre-W3 増分は migration で破棄される', async () => {
      const created = await (await createFile('破棄')).json();
      // openFile より前に増分 batch が積まれた状態を模す
      await postBatches(created.id, [sampleBatch(1)]);
      const res = await fetch(
        new Request(`http://localhost/files/${created.id}/batches`),
      );
      const body = await res.json();
      // 増分の node.add 'n1' は消え、genesis (空 snapshot 由来) だけが残る
      const contents = body.flatMap((b: { ops: { content?: string }[] }) =>
        b.ops.map((o) => o.content),
      );
      expect(contents).not.toContain('n1');
    });
  });

  describe('POST /files/:id/batches/received (Phase 4d-5)', () => {
    async function postReceived(fileId: string, batches: unknown[]) {
      return fetch(
        new Request(`http://localhost/files/${fileId}/batches/received`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batches),
        }),
      );
    }

    it('受信 batches を追記して 201 と件数を返す', async () => {
      const created = await (await createFile('受信')).json();
      const res = await postReceived(created.id, [
        sampleBatch(1),
        sampleBatch(2),
      ]);
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ appended: 2 });
    });

    it('同一 batch の再受信はべき等 (appended=0)', async () => {
      const created = await (await createFile('受信')).json();
      await postReceived(created.id, [sampleBatch(1)]);
      const res = await postReceived(created.id, [sampleBatch(1)]);
      expect(await res.json()).toEqual({ appended: 0 });
    });

    it('不正な Batch は 400 を返す', async () => {
      const created = await (await createFile('受信')).json();
      const res = await postReceived(created.id, [{ id: 'not-a-uuid' }]);
      expect(res.status).toBe(400);
    });

    it('🔴 受信 batch は lazy migration に破棄されない (§1.8 / 4d-0 の要)', async () => {
      // 上の「初回 read 前に積まれた pre-W3 増分は migration で破棄される」と
      // **同じ手順**で、書き込み口だけを受信用に替えたもの。marker が「正典宣言」
      // として働き、同じ状況で結果が逆になることを固定する。
      const created = await (await createFile('受信保護')).json();
      // openFile より前に受信 batch が着地した状態を模す (device B の未オープンファイル)
      await postReceived(created.id, [sampleBatch(1)]);
      const res = await fetch(
        new Request(`http://localhost/files/${created.id}/batches`),
      );
      const body = await res.json();
      const contents = body.flatMap((b: { ops: { content?: string }[] }) =>
        b.ops.map((o) => o.content),
      );
      // 通常 POST なら消える 'n1' が、受信経路なら残る
      expect(contents).toContain('n1');
    });

    it('通常 POST は marker を立てない (W3d-1 の破棄挙動を壊していない)', async () => {
      // 上の 4d-0 保護が「全ファイルで migration を無効化した」わけではないことの対照。
      const created = await (await createFile('破棄据置')).json();
      await postBatches(created.id, [sampleBatch(1)]);
      const body = await (
        await fetch(new Request(`http://localhost/files/${created.id}/batches`))
      ).json();
      const contents = body.flatMap((b: { ops: { content?: string }[] }) =>
        b.ops.map((o) => o.content),
      );
      expect(contents).not.toContain('n1');
    });

    it('受信 0 件では marker を立てない (lazy migration の機会を奪わない)', async () => {
      const created = await (await createFile('空受信')).json();
      const res = await postReceived(created.id, []);
      expect(await res.json()).toEqual({ appended: 0 });
      // marker が立っていないので、その後の通常 POST + GET は従来どおり破棄される
      await postBatches(created.id, [sampleBatch(1)]);
      const body = await (
        await fetch(new Request(`http://localhost/files/${created.id}/batches`))
      ).json();
      const contents = body.flatMap((b: { ops: { content?: string }[] }) =>
        b.ops.map((o) => o.content),
      );
      expect(contents).not.toContain('n1');
    });
  });

  // step1 Phase 5: ブランチ / コミットのメタ情報エンドポイント
  describe('POST/GET /files/:id/commits', () => {
    const sampleCommit = (seed: number, at: number) => ({
      id: uuid(2000 + seed),
      message: `commit ${seed}`,
      at,
      authorActor: 'local',
    });

    async function postCommit(fileId: string, commit: unknown) {
      return fetch(
        new Request(`http://localhost/files/${fileId}/commits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(commit),
        }),
      );
    }

    it('コミットを保存して 201 と保存内容を返す', async () => {
      const created = await (await createFile('ログ')).json();
      const commit = sampleCommit(1, 3);
      const res = await postCommit(created.id, commit);
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual(commit);
    });

    it('保存したコミットを at 昇順で取得できる', async () => {
      const created = await (await createFile('ログ')).json();
      await postCommit(created.id, sampleCommit(2, 5));
      await postCommit(created.id, sampleCommit(1, 2));
      const res = await fetch(
        new Request(`http://localhost/files/${created.id}/commits`),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.map((cm: { at: number }) => cm.at)).toEqual([2, 5]);
    });

    it('コミットが無ければ空配列を返す', async () => {
      const created = await (await createFile('ログ')).json();
      const res = await fetch(
        new Request(`http://localhost/files/${created.id}/commits`),
      );
      expect(await res.json()).toEqual([]);
    });

    it('不正なコミット (id が UUID でない) は 400 を返す', async () => {
      const created = await (await createFile('ログ')).json();
      const res = await postCommit(created.id, {
        ...sampleCommit(1, 3),
        id: 'not-a-uuid',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST/GET /files/:id/branches', () => {
    const sampleBranch = (
      seed: number,
      trunkFileId: string,
      at: number,
      overrides: Record<string, unknown> = {},
    ) => ({
      id: uuid(3000 + seed),
      name: `branch ${seed}`,
      base: {
        id: uuid(4000 + seed),
        message: `base ${seed}`,
        at,
        authorActor: 'local',
      },
      status: 'open',
      sheetId: uuid(5000 + seed),
      trunkFileId,
      branchFileId: uuid(6000 + seed),
      ...overrides,
    });

    async function postBranch(fileId: string, meta: unknown) {
      return fetch(
        new Request(`http://localhost/files/${fileId}/branches`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(meta),
        }),
      );
    }

    it('ブランチのメタを保存して 201 と保存内容を返す', async () => {
      const created = await (await createFile('trunk')).json();
      const meta = sampleBranch(1, created.id, 3);
      const res = await postBranch(created.id, meta);
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual(meta);
    });

    it('保存したブランチを base オフセット昇順で取得できる', async () => {
      const created = await (await createFile('trunk')).json();
      await postBranch(created.id, sampleBranch(2, created.id, 5));
      await postBranch(created.id, sampleBranch(1, created.id, 2));
      const res = await fetch(
        new Request(`http://localhost/files/${created.id}/branches`),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.map((b: { base: { at: number } }) => b.base.at)).toEqual([
        2, 5,
      ]);
    });

    it('trunk が異なるブランチは一覧に混ざらない', async () => {
      const trunkA = await (await createFile('trunk A')).json();
      const trunkB = await (await createFile('trunk B')).json();
      await postBranch(trunkA.id, sampleBranch(1, trunkA.id, 1));
      await postBranch(trunkB.id, sampleBranch(2, trunkB.id, 1));
      const res = await fetch(
        new Request(`http://localhost/files/${trunkA.id}/branches`),
      );
      const body = await res.json();
      expect(body.map((b: { id: string }) => b.id)).toEqual([uuid(3001)]);
    });

    // URL と body の trunk が食い違うと、以後 GET で取り出せないブランチが
    // 静かに生まれる。境界で弾くことを固定する。
    it('body の trunkFileId が URL と食い違えば 400 を返す', async () => {
      const trunkA = await (await createFile('trunk A')).json();
      const trunkB = await (await createFile('trunk B')).json();
      const res = await postBranch(trunkA.id, sampleBranch(1, trunkB.id, 1));
      expect(res.status).toBe(400);
      const listed = await (
        await fetch(new Request(`http://localhost/files/${trunkB.id}/branches`))
      ).json();
      expect(listed).toEqual([]);
    });

    it('不正なブランチ (status が未定義の値) は 400 を返す', async () => {
      const created = await (await createFile('trunk')).json();
      const res = await postBranch(
        created.id,
        sampleBranch(1, created.id, 1, { status: 'unknown' }),
      );
      expect(res.status).toBe(400);
    });

    it('ブランチが無ければ空配列を返す', async () => {
      const created = await (await createFile('trunk')).json();
      const res = await fetch(
        new Request(`http://localhost/files/${created.id}/branches`),
      );
      expect(await res.json()).toEqual([]);
    });

    describe('DELETE /files/:id/branches/:branchId (p5-4)', () => {
      async function deleteBranch(fileId: string, branchId: string) {
        return fetch(
          new Request(`http://localhost/files/${fileId}/branches/${branchId}`, {
            method: 'DELETE',
          }),
        );
      }

      it('ブランチを消すとメタと branch 専用 op-log が消える', async () => {
        const created = await (await createFile('trunk')).json();
        const meta = sampleBranch(1, created.id, 1);
        await postBranch(created.id, meta);
        // branch 専用 file_id へ編集を積む (branch の実体)
        await fetch(
          new Request(`http://localhost/files/${meta.branchFileId}/batches`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([sampleBatch(1)]),
          }),
        );

        const res = await deleteBranch(created.id, meta.id);
        expect(res.status).toBe(204);

        const listed = await (
          await fetch(
            new Request(`http://localhost/files/${created.id}/branches`),
          )
        ).json();
        expect(listed).toEqual([]);
        const batches = await (
          await fetch(
            new Request(`http://localhost/files/${meta.branchFileId}/batches`),
          )
        ).json();
        expect(batches).toEqual([]);
      });

      it('存在しないブランチは 404 を返す', async () => {
        const created = await (await createFile('trunk')).json();
        const res = await deleteBranch(created.id, uuid(3999));
        expect(res.status).toBe(404);
      });

      // trunk を URL で受けるのは、id だけを知る呼び出しが別ファイルのブランチを
      // 消せないようにするため。
      it('別の trunk を指定したブランチは消えない', async () => {
        const trunkA = await (await createFile('trunk A')).json();
        const trunkB = await (await createFile('trunk B')).json();
        const meta = sampleBranch(1, trunkA.id, 1);
        await postBranch(trunkA.id, meta);

        const res = await deleteBranch(trunkB.id, meta.id);
        expect(res.status).toBe(404);
        const listed = await (
          await fetch(
            new Request(`http://localhost/files/${trunkA.id}/branches`),
          )
        ).json();
        expect(listed).toHaveLength(1);
      });
    });
  });

  describe('GET /files', () => {
    it('初期状態では空配列を返す', async () => {
      const res = await fetch(new Request('http://localhost/files'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    // Phase 4e-2a: 一覧は snapshot storage と op-log の和集合 (4e 設計 §3.2b)

    /** file 構造 (file.setName + sheet.create) を持つ受信用 batch */
    const structureBatch = (clock: number, name: string) => ({
      id: uuid(9000 + clock),
      actor: 'did:plc:alice#dev-a',
      clock,
      timestamp: clock,
      ops: [
        { kind: 'file.setName', name },
        { kind: 'sheet.create', target: uuid(9100 + clock), name: 'S1' },
      ],
    });

    async function receive(fileId: string, batches: unknown[]) {
      return fetch(
        new Request(`http://localhost/files/${fileId}/batches/received`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batches),
        }),
      );
    }

    it('op-log にしか無いファイルも一覧に載る (受信 materialize の可視化)', async () => {
      const snap = await (await createFile('スナップ側')).json();
      const oplogId = uuid(42);
      await receive(oplogId, [structureBatch(1, '受信ファイル')]);

      const body = await (
        await fetch(new Request('http://localhost/files'))
      ).json();
      // 順序: snapshot 順 → op-log-only
      expect(body.map((f: { id: string }) => f.id)).toEqual([snap.id, oplogId]);
      expect(body[1].name).toBe('受信ファイル');
    });

    it('両方に在るファイルは snapshot 側の name を正とし重複しない', async () => {
      const snap = await (await createFile('スナップ名')).json();
      await receive(snap.id, [structureBatch(1, 'オプログ名')]);

      const body = await (
        await fetch(new Request('http://localhost/files'))
      ).json();
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('スナップ名');
    });

    it('構造を持たない孤児 batch だけの file_id は一覧に出さない (D-4)', async () => {
      await receive(uuid(77), [sampleBatch(1)]); // sheet.create の無い content batch
      const body = await (
        await fetch(new Request('http://localhost/files'))
      ).json();
      expect(body).toEqual([]);
    });

    // Phase 5 p5-1: branch 専用 file_id は snapshot を持たず op-log にしか無いので、
    // 一覧に出るとしたら op-log 側 (listOplogFiles) から。HTTP の口でも固定する。
    it('branch 専用 file_id は一覧に出ない (Phase 5 p5-1)', async () => {
      const trunk = await (await createFile('trunk')).json();
      const branchFileId = uuid(88);
      // branch の編集 = 分岐元シートを指す content batch のみ (構造 op を含まない)
      await postBatches(branchFileId, [sampleBatch(1), sampleBatch(2)]);

      const body = await (
        await fetch(new Request('http://localhost/files'))
      ).json();
      expect(body.map((f: { id: string }) => f.id)).toEqual([trunk.id]);
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
