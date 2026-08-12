import { describe, expect, it } from 'bun:test';
import type { Batch, FileId, NodeId } from '@conversensus/shared';
import { PartialPushError } from '../sync/outbox';

const FILE = '22222222-2222-4222-8222-222222222222' as FileId;

import {
  AtprotoSyncProvider,
  type BatchCollection,
} from './atprotoSyncProvider';
import { batchToRecord } from './batchMapper';
import {
  batchRkey,
  batchRkeyFileCursor,
  batchRkeyPrefix,
  parseBatchRkey,
} from './batchRkey';
import type { RecordSummary } from './rangeFetch';
import { NSID } from './types';

/** FILE より rkey が小さいファイルと大きいファイル (prefix 境界の検証用) */
const FILE_LOWER = '11111111-1111-4111-8111-111111111111' as FileId;
const FILE_UPPER = '33333333-3333-4333-8333-333333333333' as FileId;

const batch = (id: string, clock: number, actor = 'did:plc:alice'): Batch => ({
  id: id as Batch['id'],
  actor,
  clock,
  timestamp: clock,
  ops: [{ kind: 'node.add', target: `n${id}` as NodeId, content: id }],
});

/** ファイル削除の tombstone batch (ANA-127) */
const tombstone = (id: string, clock: number): Batch => ({
  ...batch(id, clock),
  ops: [{ kind: 'file.remove' }],
});

/**
 * collections.batches と同形の in-memory 実装。
 *
 * `listByFile` は**実 PDS と同じ手順**を模す — rkey 昇順に並べ、合成 cursor
 * (`v1~<fileId>`) より大きいところから読み、prefix を外れた 1 件で止める。
 * こうしないと「rkey 空間の分離が効いている」ことを単体で確かめられない (設計 §3.2)。
 */
function inMemoryBatches() {
  const records = new Map<
    string,
    { uri: string; cid: string; value: unknown }
  >();
  let cid = 0;
  const seedAt = (rkey: string, b: Batch, fileId: FileId = FILE) => {
    records.set(rkey, {
      uri: `at://did:plc:test/${NSID.batch}/${rkey}`,
      cid: `seed-${rkey}`,
      value: { $type: NSID.batch, ...batchToRecord(b, fileId) },
    });
  };
  /** 走査したレコード件数 (範囲取得が旧レコードを踏まないことの証拠に使う) */
  let scanned = 0;
  const store: BatchCollection & {
    /** 新形式 rkey (Phase 7 p7-1) で仕込む */
    _seed: (b: Batch, fileId?: FileId) => void;
    /** 旧形式 rkey (= batchId 単体, Phase 4c〜6) で仕込む */
    _seedLegacy: (b: Batch) => void;
    /** 任意の rkey で仕込む (壊れた rkey の検証用) */
    _seedRkey: (rkey: string, b: Batch) => void;
    _size: () => number;
    _rkeys: () => string[];
    /** 直近の `listByFile` が読んだレコード件数 */
    _scanned: () => number;
  } = {
    // 引数は rkey。Phase 7 p7-1 以降は batchId 単体ではない
    put(rkey, data) {
      cid += 1;
      const uri = `at://did:plc:test/${NSID.batch}/${rkey}`;
      records.set(rkey, {
        uri,
        cid: `cid-${cid}`,
        value: { $type: NSID.batch, ...data },
      });
      return Promise.resolve({ uri, cid: `cid-${cid}` });
    },
    // applyWrites#create を模す (Phase 7 p7-4)。**既存 rkey があればチャンクごと失敗**し、
    // 書込は原子的に巻き戻る — 実 PDS の観測 (設計 §5.4 の③④) と同じ形にする
    createMany(entries) {
      const conflict = entries.find((e) => records.has(e.rkey));
      if (conflict) {
        return Promise.reject(
          new Error(`record already exists: ${conflict.rkey}`),
        );
      }
      for (const e of entries) {
        cid += 1;
        records.set(e.rkey, {
          uri: `at://did:plc:test/${NSID.batch}/${e.rkey}`,
          cid: `cid-${cid}`,
          value: { $type: NSID.batch, ...e.data },
        });
      }
      return Promise.resolve();
    },
    listAllForMigration() {
      return Promise.resolve([...records.values()]);
    },
    listByFile(fileId) {
      const prefix = batchRkeyPrefix(fileId);
      const seek = batchRkeyFileCursor(fileId);
      const found: Array<{ uri: string; cid: string; value: unknown }> = [];
      scanned = 0;
      // rkey 昇順 + `rkey > cursor` (実 PDS の reverse: true と同じ意味論)
      for (const rkey of [...records.keys()].sort()) {
        if (rkey <= seek) continue;
        scanned += 1;
        if (!rkey.startsWith(prefix)) break; // 範囲を出た 1 件で停止
        const record = records.get(rkey);
        if (record) found.push(record);
      }
      return Promise.resolve(found);
    },
    listFileHeads() {
      // 実装は降順 1 件ずつの seek で列挙する (§3.3)。ここでは結果の性質だけを模す:
      // 新形式 rkey から fileId を取り出し、降順・重複なしで返す。**着地レコードは
      // そのファイルの最大 rkey のもの** — 降順なので最初に現れた 1 件がそれである。
      const heads = new Map<FileId, RecordSummary>();
      for (const rkey of [...records.keys()].sort().reverse()) {
        const fileId = parseBatchRkey(rkey)?.fileId;
        const record = records.get(rkey);
        if (fileId === undefined || !record || heads.has(fileId)) continue;
        heads.set(fileId, record);
      }
      return Promise.resolve(
        [...heads].map(([fileId, head]) => ({ fileId, head })),
      );
    },
    _seed(b, fileId = FILE) {
      seedAt(batchRkey(fileId, b.clock, b.id), b, fileId);
    },
    _seedLegacy(b) {
      seedAt(b.id, b);
    },
    _seedRkey: seedAt,
    _size: () => records.size,
    _rkeys: () => [...records.keys()],
    _scanned: () => scanned,
  };
  return store;
}

/**
 * blob の先出し (ANA-116 S5) を no-op にした provider。
 * 画像を含まない batch の検証はこれで十分で, 先出しの順序そのものは
 * 「blob 先出し」の describe が専用の記録付き uploader で確かめる。
 */
function makeProvider(batches: BatchCollection): AtprotoSyncProvider {
  return new AtprotoSyncProvider({
    batches,
    uploadBlobs: () => Promise.resolve({ unavailable: [] }),
  });
}

describe('AtprotoSyncProvider', () => {
  describe('pushRemote', () => {
    it('rkey = v1~<fileId>~<clock>~<batchId> で op-log へ書く (Phase 7 p7-1)', async () => {
      // 範囲取得はこの rkey の辞書順だけで成立するので、書込形式そのものを固定する
      const batches = inMemoryBatches();
      const provider = makeProvider(batches);
      await provider.pushRemote(
        [batch('1', 1), batch('2', 2)].map((batch) => ({
          fileId: FILE,
          batch,
        })),
      );
      expect(batches._rkeys()).toEqual([
        `v1~${FILE}~000000000001~1`,
        `v1~${FILE}~000000000002~2`,
      ]);
    });

    it('同一 batch の push は上書き (rkey が決定論的なのでべき等、重複しない)', async () => {
      const batches = inMemoryBatches();
      const provider = makeProvider(batches);
      await provider.pushRemote(
        [batch('1', 1)].map((batch) => ({ fileId: FILE, batch })),
      );
      await provider.pushRemote(
        [batch('1', 1)].map((batch) => ({ fileId: FILE, batch })),
      );
      expect(batches._size()).toBe(1);
    });
  });

  describe('createRemote (Phase 7 p7-4 の移行専用まとめ書き)', () => {
    it('pushRemote と同じ rkey で書く (取得経路が同じ辞書順に乗る)', async () => {
      // まとめ書きだけ rkey が違うと、移行したレコードが範囲取得から漏れる。
      // 経路が 2 本になった以上、rkey が一致することを明示的に固定する。
      const batches = inMemoryBatches();
      const provider = makeProvider(batches);
      await provider.createRemote(
        [batch('1', 1), batch('2', 2)].map((batch) => ({
          fileId: FILE,
          batch,
        })),
      );
      expect(batches._rkeys()).toEqual([
        `v1~${FILE}~000000000001~1`,
        `v1~${FILE}~000000000002~2`,
      ]);
    });

    it('既存 rkey が混ざると失敗する (べき等ではない)', async () => {
      // `pushRemote` (putRecord) と決定的に違う点。呼び出し側 (`migrateRemoteRkey`) が
      // 範囲取得で差分を取る責務を負う根拠なので、契約としてテストで残す。
      const batches = inMemoryBatches();
      const provider = makeProvider(batches);
      const entries = [batch('1', 1)].map((batch) => ({ fileId: FILE, batch }));
      await provider.createRemote(entries);

      await expect(provider.createRemote(entries)).rejects.toThrow(
        'record already exists',
      );
      expect(batches._size()).toBe(1); // 巻き戻る (増えない)
    });
  });

  describe('pullAllRemoteForMigration (Phase 4d-4, p7-5 で移行専用に)', () => {
    it('既読位置を持たず常に全件を返す', async () => {
      // 4d-3 までは clock cursor で絞っていたが、clock は端末をまたぐと単調でなく
      // 取りこぼす (§1.3)。ATProto 側にも既読位置に使える値が無い (rkey は UUID で
      // 時系列順にならない) ため、既読位置を持たない契約にした。
      const batches = inMemoryBatches();
      batches._seed(batch('a', 1));
      batches._seed(batch('b', 3));
      batches._seed(batch('c', 2));
      const provider = makeProvider(batches);

      const first = await provider.pullAllRemoteForMigration();
      expect(first.map((e) => e.batch.id)).toEqual(['a', 'c', 'b']);

      // 2 回目も同じ全件が返る (前進する既読位置が無い = 取りこぼしようがない)
      const second = await provider.pullAllRemoteForMigration();
      expect(second.map((e) => e.batch.id)).toEqual(['a', 'c', 'b']);
    });

    it('clock → actor → id の順に整列して返す (orderBatches と同じ規則)', async () => {
      const batches = inMemoryBatches();
      // 同一 clock で actor 違い。timestamp は逆順に置く
      batches._seed({ ...batch('x', 2), actor: 'dev-b', timestamp: 1 });
      batches._seed({ ...batch('y', 2), actor: 'dev-a', timestamp: 999 });
      batches._seed(batch('z', 1));
      const provider = makeProvider(batches);
      const entries = await provider.pullAllRemoteForMigration();
      // clock 1 の z → clock 2 は actor 昇順で dev-a(y) → dev-b(x)
      expect(entries.map((e) => e.batch.id)).toEqual(['z', 'y', 'x']);
    });

    it('適用先 fileId をエンベロープで返す', async () => {
      // remote の batch コレクションは repo 全体で 1 つなので、受信側は
      // レコード自身の fileId でしか適用先を復元できない (§3.1)。
      const batches = inMemoryBatches();
      batches._seed(batch('a', 1));
      const provider = makeProvider(batches);
      const entries = await provider.pullAllRemoteForMigration();
      expect(entries.map((e) => e.fileId)).toEqual([FILE]);
    });

    it('壊れた / 他種 / fileId 無しレコードは飛ばす', async () => {
      const batches = inMemoryBatches();
      batches._seed(batch('a', 1));
      // 別種レコードを直接混入 (list に載る)
      await batches.put('broken', {
        actor: 'x',
        clock: Number.NaN,
        timestamp: 1,
        ops: [] as unknown[],
      } as never);
      const provider = makeProvider(batches);
      const entries = await provider.pullAllRemoteForMigration();
      expect(entries.map((e) => e.batch.id)).toEqual(['a']);
    });

    it('新形式 rkey から batch.id を復元する (Phase 7 p7-1)', async () => {
      // id はレコードボディに無く rkey にしかない。第 4 セグメントが id
      const batches = inMemoryBatches();
      batches._seed(batch('a', 1));
      const provider = makeProvider(batches);
      const entries = await provider.pullAllRemoteForMigration();
      expect(entries.map((e) => e.batch.id)).toEqual(['a']);
    });

    it('旧形式 rkey (= batchId 単体) も復元できる', async () => {
      // p7-1 時点の読取は repo 全件 list のままなので新旧が混在する。
      // この寛容さは全件 list を撤去する p7-5 で外す。
      const batches = inMemoryBatches();
      batches._seedLegacy(batch('old', 1));
      batches._seed(batch('new', 2));
      const provider = makeProvider(batches);
      const entries = await provider.pullAllRemoteForMigration();
      expect(entries.map((e) => e.batch.id)).toEqual(['old', 'new']);
    });

    it('v1~ で始まるのに形式を満たさない rkey は飛ばす', async () => {
      // 壊れた新形式レコードから id を推測して正典へ入れない (呼び出し側は数えて警告する)
      const batches = inMemoryBatches();
      batches._seed(batch('ok', 1));
      batches._seedRkey(`v1~${FILE}~42~short-clock`, batch('bad', 2));
      const provider = makeProvider(batches);
      const entries = await provider.pullAllRemoteForMigration();
      expect(entries.map((e) => e.batch.id)).toEqual(['ok']);
    });
  });

  describe('pullRemoteForFile (Phase 7 p7-2)', () => {
    it('そのファイルの batch だけを返す (隣接 fileId を含めない)', async () => {
      // prefix 範囲取得の核心。fileId は UUID 固定長なので、ある fileId が別の fileId の
      // prefix になることはなく、同一ファイルの rkey は rkey 空間で連続する (§3.2)。
      const batches = inMemoryBatches();
      batches._seed(batch('lower', 1), FILE_LOWER);
      batches._seed(batch('a', 1));
      batches._seed(batch('b', 2));
      batches._seed(batch('upper', 1), FILE_UPPER);
      const provider = makeProvider(batches);

      const entries = await provider.pullRemoteForFile(FILE);
      expect(entries.map((e) => e.batch.id)).toEqual(['a', 'b']);
      expect(entries.map((e) => e.fileId)).toEqual([FILE, FILE]);
    });

    it('走査は repo 全体に比例しない (prefix を出た 1 件で止まる)', async () => {
      // 「repo 全体を落として他ファイル分を捨てる」形に戻っていないことの直接の証拠。
      // 読み過ぎ 1 件 (境界の検出) は正常動作なので許容する (§3.2)。
      const batches = inMemoryBatches();
      for (let i = 1; i <= 5; i += 1) {
        batches._seed(batch(`low${i}`, i), FILE_LOWER);
        batches._seed(batch(`up${i}`, i), FILE_UPPER);
      }
      batches._seed(batch('mine', 1));
      const provider = makeProvider(batches);

      const entries = await provider.pullRemoteForFile(FILE);
      expect(entries.map((e) => e.batch.id)).toEqual(['mine']);
      // 自分の 1 件 + 境界の 1 件。全 11 件を舐めていない
      expect(batches._scanned()).toBe(2);
    });

    it('旧 rkey のレコードを 1 件も走査しない (v1~ 分離, §3.1)', async () => {
      // 旧レコードは PDS に放置する決定なので、走査がそれらを踏まないことが範囲取得の前提。
      // 踏むと「全件 list を別の形でやり直す」ことになる。
      const batches = inMemoryBatches();
      for (let i = 1; i <= 4; i += 1) batches._seedLegacy(batch(`old${i}`, i));
      batches._seed(batch('new', 1));
      const provider = makeProvider(batches);

      const entries = await provider.pullRemoteForFile(FILE);
      expect(entries.map((e) => e.batch.id)).toEqual(['new']);
      // 旧 rkey は `v1~` より小さいので合成 cursor の手前にあり、走査に現れない
      expect(batches._scanned()).toBe(1);
    });

    it('既読位置を持たず、2 回呼んでも同じ全履歴を返す', async () => {
      // 絞るのは「repo 全体 → 1 ファイル」の軸だけ。「全履歴 → 差分」の軸は絞らない
      // (端末をまたぐと clock が単調でなく、既読位置を安全に作れない, §1.4 / §2.2)。
      const batches = inMemoryBatches();
      batches._seed(batch('a', 1));
      batches._seed(batch('b', 2));
      const provider = makeProvider(batches);

      const first = await provider.pullRemoteForFile(FILE);
      const second = await provider.pullRemoteForFile(FILE);
      expect(second.map((e) => e.batch.id)).toEqual(
        first.map((e) => e.batch.id),
      );
      expect(second).toHaveLength(2);
    });

    it('clock → actor → id で整列して返す (rkey 順に依存しない)', async () => {
      // 範囲取得は rkey 昇順で返るが、rkey の clock は発番端末のものなので順序の権威に
      // できない。並べ替えは全件版と同じ規則で行う (`orderBatches` と同一)。
      const batches = inMemoryBatches();
      batches._seed({ ...batch('x', 2), actor: 'dev-b' });
      batches._seed({ ...batch('y', 2), actor: 'dev-a' });
      batches._seed(batch('z', 1));
      const provider = makeProvider(batches);

      const entries = await provider.pullRemoteForFile(FILE);
      expect(entries.map((e) => e.batch.id)).toEqual(['z', 'y', 'x']);
    });

    it('壊れた新形式 rkey は飛ばす (id を推測して正典へ入れない)', async () => {
      const batches = inMemoryBatches();
      batches._seed(batch('ok', 1));
      // prefix には合致するが clock 桁数が違う = 復元不能。呼び出し側は数えて警告する
      batches._seedRkey(
        `${batchRkeyPrefix(FILE)}42~short-clock`,
        batch('bad', 2),
      );
      const provider = makeProvider(batches);

      const entries = await provider.pullRemoteForFile(FILE);
      expect(entries.map((e) => e.batch.id)).toEqual(['ok']);
    });

    it('合成 cursor は prefix の直前を指す (先頭レコードを落とさない)', async () => {
      // `v1~<fileId>` < `v1~<fileId>~…` の関係が崩れると、そのファイルの
      // **最初の 1 件だけ**が静かに落ちる (最も見つけにくい壊れ方)。
      expect(batchRkeyFileCursor(FILE) < batchRkeyPrefix(FILE)).toBe(true);
      expect(batchRkeyPrefix(FILE).startsWith(batchRkeyFileCursor(FILE))).toBe(
        true,
      );
    });
  });

  describe('listRemoteFiles (Phase 7 p7-3 / ANA-127 S3)', () => {
    it('remote に存在する fileId を返す (batch 本体は伴わない)', async () => {
      // 未知ファイルの発見はまず fileId の集合を要求する。本体は未知の分だけ取れば
      // よく、既知ファイルの履歴を落とさないのが p7-3 の要点 (設計 §3.3)。
      const batches = inMemoryBatches();
      batches._seed(batch('a', 1), FILE_LOWER);
      batches._seed(batch('b', 1));
      batches._seed(batch('c', 2));
      const provider = makeProvider(batches);

      const entries = await provider.listRemoteFiles();
      expect(entries.map((e) => e.fileId).sort()).toEqual(
        [FILE_LOWER, FILE].sort(),
      );
      expect(entries.every((e) => !e.deleted)).toBe(true);
    });

    it('着地レコードが tombstone のファイルを deleted で返す (ANA-127)', async () => {
      // 削除は最大 clock の `file.remove` として置かれる (`sync/fileDeletion.ts`)。
      // 列挙が着地するのは最大 rkey = 最大 clock のレコードなので、**本体を引かずに**
      // 削除が分かる。判定は正典と同じ `isFileDeleted` を通す。
      const batches = inMemoryBatches();
      batches._seed(batch('a', 1), FILE_LOWER);
      batches._seed(batch('b', 1));
      batches._seed(tombstone('t', 2));
      const provider = makeProvider(batches);

      const entries = await provider.listRemoteFiles();
      expect(entries.find((e) => e.fileId === FILE)?.deleted).toBe(true);
      expect(entries.find((e) => e.fileId === FILE_LOWER)?.deleted).toBe(false);
    });

    it('tombstone より大きい clock の batch が後続すると deleted にならない', async () => {
      // 着地点は最大 clock のレコードなので、他端末の編集が後に載ると tombstone は
      // 着地点から外れる。ここで false になるのは**取りこぼしではなく設計**であり、
      // remove-wins の保証は pull 後の検査 (`discoverRemoteFiles`) が担う。
      const batches = inMemoryBatches();
      batches._seed(tombstone('t', 2));
      batches._seed(batch('later', 3));
      const provider = makeProvider(batches);

      expect((await provider.listRemoteFiles())[0]?.deleted).toBe(false);
    });

    it('旧 rkey のレコードしか無いファイルは現れない', async () => {
      // 旧 rkey は fileId を持たないので列挙できない。それらは移行 (p7-4) が新 rkey で
      // 再 push するまで発見経路の外にあり、移行前の 1 回の全件受信 (§3.4) が穴を塞ぐ。
      const batches = inMemoryBatches();
      batches._seedLegacy(batch('old', 1));
      const provider = makeProvider(batches);

      expect(await provider.listRemoteFiles()).toEqual([]);
    });
  });

  describe('blob の先出し (ANA-116 S5)', () => {
    /**
     * blob upload とレコード書込を**同じ列**に記録する provider。
     * 順序が要件そのものなので、呼ばれた回数ではなく並びを見る。
     */
    function recordingProvider() {
      const batches = inMemoryBatches();
      const calls: string[] = [];
      const put = batches.put.bind(batches);
      const createMany = batches.createMany.bind(batches);
      batches.put = (rkey, data) => {
        calls.push(`put:${rkey}`);
        return put(rkey, data);
      };
      batches.createMany = (entries) => {
        calls.push(`createMany:${entries.length}`);
        return createMany(entries);
      };
      const provider = new AtprotoSyncProvider({
        batches,
        uploadBlobs: (ops) => {
          calls.push(`upload:${ops.length}`);
          return Promise.resolve({ unavailable: [] });
        },
      });
      return { provider, calls };
    }

    it('pushRemote は各 batch のレコードを書く前にその batch の blob を上げる', async () => {
      // 逆順だと PDS が `Could not find blob` で拒否し、その batch は再送し続けて
      // outbox に詰まる (S1 で実測)。順序が保証そのものなので並びで固定する。
      // **batch ごとに交互**なのは失敗境界を batch 単位にしたため (レビュー D2)
      const { provider, calls } = recordingProvider();
      await provider.pushRemote(
        [batch('1', 1), batch('2', 2)].map((batch) => ({
          fileId: FILE,
          batch,
        })),
      );
      expect(calls).toEqual([
        'upload:1',
        `put:v1~${FILE}~000000000001~1`,
        'upload:1',
        `put:v1~${FILE}~000000000002~2`,
      ]);
    });

    it('createRemote (移行) でも先に上げる', async () => {
      // 移行は「新 rkey でまだ書かれていない batch」を書くので、S5 以降に作った
      // 画像がそこに混ざりうる。混ざったチャンクは 1 件の失敗で丸ごと巻き戻る
      const { provider, calls } = recordingProvider();
      await provider.createRemote([{ fileId: FILE, batch: batch('1', 1) }]);
      expect(calls).toEqual(['upload:1', 'createMany:1']);
    });

    it('blob の upload が失敗したらレコードを 1 件も書かない', async () => {
      // 「blob が無いまま参照だけ載ったレコード」を作らない。失敗した batch は
      // キューに残り (RemoteSyncQueue の契約)、再送で回復する
      const batches = inMemoryBatches();
      const provider = new AtprotoSyncProvider({
        batches,
        uploadBlobs: () => Promise.reject(new Error('upload failed')),
      });

      const error = await provider
        .pushRemote([{ fileId: FILE, batch: batch('1', 1) }])
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PartialPushError);
      expect((error as PartialPushError).sentIds).toEqual([]);
      expect((error as PartialPushError).cause).toMatchObject({
        message: 'upload failed',
      });
      expect(batches._size()).toBe(0);
    });
  });

  /**
   * 失敗境界 (レビュー D2)。**送れないと分かっている 1 件が残りを止めない**ことと、
   * **全体的な失敗では打ち切る**ことの両方を固定する。前者を守らないと解けない画像 1 つで
   * 同期全体が止まり、後者を守らないとオフライン編集中に失敗リクエストが保留件数の
   * 二乗で増える。
   */
  describe('失敗の境界 (レビュー D2)', () => {
    it('上げられない blob を参照する batch は飛ばし、他の batch は送る', async () => {
      const batches = inMemoryBatches();
      // 2 件目の batch の blob だけがローカルに無い状況を作る
      const provider = new AtprotoSyncProvider({
        batches,
        uploadBlobs: (ops) =>
          Promise.resolve({
            unavailable: ops.some((op) => 'target' in op && op.target === 'n2')
              ? ['bafkreimissing']
              : [],
          }),
      });

      const error = await provider
        .pushRemote(
          [batch('1', 1), batch('2', 2), batch('3', 3)].map((batch) => ({
            fileId: FILE,
            batch,
          })),
        )
        .catch((e: unknown) => e);

      // 送れた 2 件は Outbox から消える。送れない 1 件だけが保留に残る
      expect(error).toBeInstanceOf(PartialPushError);
      expect((error as PartialPushError).sentIds).toEqual(['1', '3']);
      expect(batches._rkeys()).toEqual([
        `v1~${FILE}~000000000001~1`,
        `v1~${FILE}~000000000003~3`,
      ]);
    });

    it('飛ばした batch は PDS を叩かない (無駄なリクエストを出さない)', async () => {
      const batches = inMemoryBatches();
      let puts = 0;
      const put = batches.put.bind(batches);
      batches.put = (rkey, data) => {
        puts += 1;
        return put(rkey, data);
      };
      const provider = new AtprotoSyncProvider({
        batches,
        uploadBlobs: () => Promise.resolve({ unavailable: ['bafkreimissing'] }),
      });

      await provider
        .pushRemote([{ fileId: FILE, batch: batch('1', 1) }])
        .catch(() => {});
      expect(puts).toBe(0);
    });

    it('レコード書込が失敗したら残りを試さず打ち切る (オフラインの巻き添え防止)', async () => {
      // オフライン中は編集ごとに flush が走るので、全件試すと失敗リクエストが
      // 保留件数の二乗で増える。1 件目で諦めるのが正しい
      const batches = inMemoryBatches();
      let attempts = 0;
      batches.put = () => {
        attempts += 1;
        return Promise.reject(new Error('offline'));
      };
      const provider = makeProvider(batches);

      const error = await provider
        .pushRemote(
          [batch('1', 1), batch('2', 2), batch('3', 3)].map((batch) => ({
            fileId: FILE,
            batch,
          })),
        )
        .catch((e: unknown) => e);

      expect(attempts).toBe(1);
      expect(error).toBeInstanceOf(PartialPushError);
      expect((error as PartialPushError).sentIds).toEqual([]);
    });

    it('途中まで送れていれば、その分だけを送信済みとして返す', async () => {
      const batches = inMemoryBatches();
      const put = batches.put.bind(batches);
      batches.put = (rkey, data) =>
        rkey.endsWith('~2')
          ? Promise.reject(new Error('offline'))
          : put(rkey, data);
      const provider = makeProvider(batches);

      const error = await provider
        .pushRemote(
          [batch('1', 1), batch('2', 2), batch('3', 3)].map((batch) => ({
            fileId: FILE,
            batch,
          })),
        )
        .catch((e: unknown) => e);

      expect((error as PartialPushError).sentIds).toEqual(['1']);
    });
  });
});
