import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectFile } from '@conversensus/shared';
import server from './index';
import { writeFile } from './storage';

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
    // genesis を持たない生 file_id を使い、append/retrieve だけを裸で検証する。
    // (W3d では「createFile が snapshot を書くと GET が migration を発火する」のを
    //  避けるためでもあったが、p6-1 でその副作用は消えた。素の観点としては引き続き有効)
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

    it('ログの無いファイルは空配列を返す', async () => {
      const res = await fetch(
        new Request(`http://localhost/files/${rawId}/batches`),
      );
      expect(await res.json()).toEqual([]);
    });
  });

  // Phase 6 p6-1: ファイルは作成時に op-log を持ち (genesis 直書き)、読取時の
  // lazy migration は撤去された。「読んだだけで op-log が消える」経路がもう無いことを固定する。
  describe('GET /files/:id/batches — 作成時 genesis と読取の無害性 (Phase 6 p6-1)', () => {
    it('新規作成ファイルの初回 GET が genesis を返す', async () => {
      const created = await (await createFile('空')).json();
      const res = await fetch(
        new Request(`http://localhost/files/${created.id}/batches`),
      );
      const body = await res.json();
      // 空ファイルでも file.setName / sheet.create の genesis batch が作られている
      expect(body.length).toBeGreaterThan(0);
      const kinds = body.flatMap((b: { ops: { kind: string }[] }) =>
        b.ops.map((o) => o.kind),
      );
      expect(kinds).toContain('file.setName');
    });

    it('二度目の GET も同じ genesis を返す (読取に副作用が無い)', async () => {
      const created = await (await createFile('反復')).json();
      const first = await (
        await fetch(new Request(`http://localhost/files/${created.id}/batches`))
      ).json();
      const second = await (
        await fetch(new Request(`http://localhost/files/${created.id}/batches`))
      ).json();
      expect(second).toEqual(first);
    });

    it('🔴 初回 read 前に積まれた batch が読取で破棄されない', async () => {
      // W3d-1 では lazy migration がここで `DELETE FROM batches` を実行し、
      // 積んだ増分を捨てていた (4d-0 §1.8 の事故はこれが原因)。p6-1 で読取時の
      // migration ごと撤去したので、**書いたものは読んでも消えない**。
      const created = await (await createFile('保持')).json();
      await postBatches(created.id, [sampleBatch(1)]);
      const res = await fetch(
        new Request(`http://localhost/files/${created.id}/batches`),
      );
      const body = await res.json();
      const contents = body.flatMap((b: { ops: { content?: string }[] }) =>
        b.ops.map((o) => o.content),
      );
      expect(contents).toContain('n1');
      // genesis も残っている (置き換えではなく追記)
      const kinds = body.flatMap((b: { ops: { kind: string }[] }) =>
        b.ops.map((o) => o.kind),
      );
      expect(kinds).toContain('file.setName');
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

    it('受信 batch が後続の GET で失われない', async () => {
      // 4d-0 (§1.8) では marker がこれを守っていた。p6-1 で読取時の migration ごと
      // 撤去されたので、いまは経路の有無に関わらず消えない。受信経路の end-to-end 契約
      // としては引き続き成立する必要があるため残す。
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
      expect(contents).toContain('n1');
    });

    // marker (正典宣言) そのものの性質 — 受信 0 件で立てない / ファイル境界で分離する など —
    // は `eventStore.test.ts` の appendReceivedBatches / migrateToOplog 群が固定している。
    // p6-1 で読取時 migration が消え、HTTP 越しに marker の有無を観測する手段が無くなったため、
    // ここで重ねて検査していた 2 件は EventStore 側の担当に一本化した。
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

    // Phase 6 p6-2: 一覧は **op-log 単独** (設計 §3.3)。
    // 4e-2a の「snapshot ∪ op-log」から切り替わった。

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
      const created = await (await createFile('作成側')).json();
      const oplogId = uuid(42);
      await receive(oplogId, [structureBatch(1, '受信ファイル')]);

      const body = await (
        await fetch(new Request('http://localhost/files'))
      ).json();
      // 順序は op-log の初出順 (file_id ごとの最小 seq)
      expect(body.map((f: { id: string }) => f.id)).toEqual([
        created.id,
        oplogId,
      ]);
      expect(body[1].name).toBe('受信ファイル');
    });

    // p6-2 の切り替えの核心: 一覧の name はどちらの正典から来るか。
    // 和集合だった頃は snapshot 側が勝っていた (二重の正典)。今は op-log projection だけ。
    it('snapshot だけを更新しても一覧には反映されない (op-log projection が正)', async () => {
      const created = await (await createFile('op-log の名前')).json();
      // snapshot を直接書き換える (HTTP からは書けなくなった — p6-3 で PUT を撤去)
      await writeFile({ ...created, name: 'snapshot だけの名前' });

      const body = await (
        await fetch(new Request('http://localhost/files'))
      ).json();
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('op-log の名前');
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

  // Phase 6 p6-3 (設計 §3.4 / §3.6): snapshot の読取・全体保存の口を撤去した。
  // 「消えたこと」を固定するのは、client 側の消費者を戻したときに気づくため
  // (読取は op-log の projection、書込は batch 追記が唯一の口)。
  describe('🔴 撤去した snapshot endpoint (Phase 6 p6-3)', () => {
    it('GET /files/:id は存在しない', async () => {
      const created = await (await createFile('テスト')).json();
      const res = await fetch(
        new Request(`http://localhost/files/${created.id}`),
      );
      expect(res.status).toBe(404);
    });

    it('PUT /files/:id は存在しない', async () => {
      const created = await (await createFile('元の名前')).json();
      const res = await fetch(
        new Request(`http://localhost/files/${created.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...created, name: '新しい名前' }),
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  // Phase 6 p6-2 (設計 §3.5, §1.3): 削除の正典が snapshot から op-log へ移った。
  describe('DELETE /files/:id', () => {
    async function deleteFileReq(id: string) {
      return fetch(
        new Request(`http://localhost/files/${id}`, { method: 'DELETE' }),
      );
    }

    async function listFileIds(): Promise<string[]> {
      const body = await (
        await fetch(new Request('http://localhost/files'))
      ).json();
      return body.map((f: { id: string }) => f.id);
    }

    async function getBatches(fileId: string): Promise<unknown[]> {
      return (
        await fetch(new Request(`http://localhost/files/${fileId}/batches`))
      ).json();
    }

    it('ファイルを削除すると 204 を返す', async () => {
      const created = await (await createFile('削除対象')).json();
      expect((await deleteFileReq(created.id)).status).toBe(204);
    });

    it('削除後は GET で 404 になる', async () => {
      const created = await (await createFile('削除対象')).json();
      await deleteFileReq(created.id);
      const res = await fetch(
        new Request(`http://localhost/files/${created.id}`),
      );
      expect(res.status).toBe(404);
    });

    it('存在しない ID への DELETE は 404 を返す', async () => {
      expect((await deleteFileReq('nonexistent')).status).toBe(404);
    });

    // §1.3 の穴: snapshot しか消していなかったため、削除したファイルの op-log が残り、
    // 同じ id が受信で materialize されると消したはずの内容が復活しうる。
    it('削除すると op-log も消える (batches が残らない)', async () => {
      const created = await (await createFile('削除対象')).json();
      await postBatches(created.id, [sampleBatch(1)]);
      expect(await getBatches(created.id)).not.toEqual([]);

      await deleteFileReq(created.id);

      expect(await getBatches(created.id)).toEqual([]);
      expect(await listFileIds()).toEqual([]);
    });

    // §1.3 の穴: op-log-only ファイル (受信 materialize) は snapshot を持たないため
    // 従来は 404 で削除できなかった = ユーザーが消せないファイルが存在した。
    it('snapshot を持たない op-log-only ファイルも削除できる', async () => {
      const oplogId = uuid(42);
      await fetch(
        new Request(`http://localhost/files/${oplogId}/batches/received`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([
            {
              id: uuid(9001),
              actor: 'did:plc:alice#dev-a',
              clock: 1,
              timestamp: 1,
              ops: [
                { kind: 'file.setName', name: '受信ファイル' },
                { kind: 'sheet.create', target: uuid(9101), name: 'S1' },
              ],
            },
          ]),
        }),
      );
      expect(await listFileIds()).toEqual([oplogId]);

      expect((await deleteFileReq(oplogId)).status).toBe(204);
      expect(await listFileIds()).toEqual([]);
      expect(await getBatches(oplogId)).toEqual([]);
    });

    // branch の中身へは branches.branch_file_id からしか辿れない。trunk を消すときに
    // 一緒に消さないと、参照者のいない batch が永久に残る (deleteBranch と同じ理由)。
    it('trunk を削除するとブランチのメタと branch 専用 op-log も消える', async () => {
      const trunk = await (await createFile('trunk')).json();
      const branchFileId = uuid(6001);
      const meta = {
        id: uuid(3001),
        name: 'branch 1',
        base: { id: uuid(4001), message: 'base', at: 1, authorActor: 'local' },
        status: 'open',
        sheetId: uuid(5001),
        trunkFileId: trunk.id,
        branchFileId,
      };
      await fetch(
        new Request(`http://localhost/files/${trunk.id}/branches`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(meta),
        }),
      );
      await postBatches(branchFileId, [sampleBatch(1)]);

      await deleteFileReq(trunk.id);

      const branches = await (
        await fetch(new Request(`http://localhost/files/${trunk.id}/branches`))
      ).json();
      expect(branches).toEqual([]);
      expect(await getBatches(branchFileId)).toEqual([]);
    });

    it('コミットも消える', async () => {
      const created = await (await createFile('削除対象')).json();
      await fetch(
        new Request(`http://localhost/files/${created.id}/commits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: uuid(7001),
            message: 'c1',
            at: 1,
            authorActor: 'local',
          }),
        }),
      );

      await deleteFileReq(created.id);

      const commits = await (
        await fetch(new Request(`http://localhost/files/${created.id}/commits`))
      ).json();
      expect(commits).toEqual([]);
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

    it('🔴 応答の GraphFile と op-log の projection が一致する (Phase 6 p6-1, 設計 §6.3)', async () => {
      // import は ID 再生成 + 参照付け替えを通してから genesis 化する。応答として返した
      // GraphFile と op-log から projection した GraphFile が食い違うと、import 直後の画面と
      // 再オープン後の画面が別物になる。graphFileToBatches の往復性は W3b で固定済だが、
      // **import 固有の ID 再生成を通した後**の往復はどこも見ていなかった。
      const payload = validPayload();
      const nodeId = '11111111-1111-1111-1111-111111111111';
      const edgeId = '22222222-2222-2222-2222-222222222222';
      payload.sheets[0].nodes = [
        { id: nodeId, content: 'ノード', style: { x: 12, y: 34 } },
      ];
      payload.sheets[0].edges = [
        { id: edgeId, source: nodeId, target: nodeId },
      ];
      const imported = await (
        await fetch(
          new Request('http://localhost/files/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }),
        )
      ).json();

      const batches = await (
        await fetch(
          new Request(`http://localhost/files/${imported.id}/batches`),
        )
      ).json();
      const projected = projectFile(batches, imported.id);

      expect(projected.name).toBe(imported.name);
      expect(projected.description).toBe(imported.description);
      expect(projected.sheets.map((s) => s.id)).toEqual(
        imported.sheets.map((s: { id: string }) => s.id),
      );
      expect(projected.sheets[0]?.nodes.map((n) => n.id)).toEqual(
        imported.sheets[0].nodes.map((n: { id: string }) => n.id),
      );
      expect(projected.sheets[0]?.edges.map((e) => e.id)).toEqual(
        imported.sheets[0].edges.map((e: { id: string }) => e.id),
      );
      // 付け替えた参照 (source/target) が projection でも保たれている
      expect(projected.sheets[0]?.edges[0]?.source).toBe(
        imported.sheets[0].nodes[0].id,
      );
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
