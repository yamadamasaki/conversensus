import { describe, expect, it } from 'bun:test';
import type { Batch, FileId, NodeId } from '@conversensus/shared';

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
    listFileIds() {
      // 実装は降順 1 件ずつの seek で列挙する (§3.3)。ここでは結果の性質だけを模す:
      // 新形式 rkey から fileId を取り出し、降順・重複なしで返す
      const ids = [...records.keys()]
        .sort()
        .reverse()
        .map((rkey) => parseBatchRkey(rkey)?.fileId)
        .filter((id): id is FileId => id !== undefined);
      return Promise.resolve([...new Set(ids)]);
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

describe('AtprotoSyncProvider', () => {
  describe('pushRemote', () => {
    it('rkey = v1~<fileId>~<clock>~<batchId> で op-log へ書く (Phase 7 p7-1)', async () => {
      // 範囲取得はこの rkey の辞書順だけで成立するので、書込形式そのものを固定する
      const batches = inMemoryBatches();
      const provider = new AtprotoSyncProvider({ batches });
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
      const provider = new AtprotoSyncProvider({ batches });
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
      const provider = new AtprotoSyncProvider({ batches });
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
      const provider = new AtprotoSyncProvider({ batches });
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
      const provider = new AtprotoSyncProvider({ batches });

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
      const provider = new AtprotoSyncProvider({ batches });
      const entries = await provider.pullAllRemoteForMigration();
      // clock 1 の z → clock 2 は actor 昇順で dev-a(y) → dev-b(x)
      expect(entries.map((e) => e.batch.id)).toEqual(['z', 'y', 'x']);
    });

    it('適用先 fileId をエンベロープで返す', async () => {
      // remote の batch コレクションは repo 全体で 1 つなので、受信側は
      // レコード自身の fileId でしか適用先を復元できない (§3.1)。
      const batches = inMemoryBatches();
      batches._seed(batch('a', 1));
      const provider = new AtprotoSyncProvider({ batches });
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
      const provider = new AtprotoSyncProvider({ batches });
      const entries = await provider.pullAllRemoteForMigration();
      expect(entries.map((e) => e.batch.id)).toEqual(['a']);
    });

    it('新形式 rkey から batch.id を復元する (Phase 7 p7-1)', async () => {
      // id はレコードボディに無く rkey にしかない。第 4 セグメントが id
      const batches = inMemoryBatches();
      batches._seed(batch('a', 1));
      const provider = new AtprotoSyncProvider({ batches });
      const entries = await provider.pullAllRemoteForMigration();
      expect(entries.map((e) => e.batch.id)).toEqual(['a']);
    });

    it('旧形式 rkey (= batchId 単体) も復元できる', async () => {
      // p7-1 時点の読取は repo 全件 list のままなので新旧が混在する。
      // この寛容さは全件 list を撤去する p7-5 で外す。
      const batches = inMemoryBatches();
      batches._seedLegacy(batch('old', 1));
      batches._seed(batch('new', 2));
      const provider = new AtprotoSyncProvider({ batches });
      const entries = await provider.pullAllRemoteForMigration();
      expect(entries.map((e) => e.batch.id)).toEqual(['old', 'new']);
    });

    it('v1~ で始まるのに形式を満たさない rkey は飛ばす', async () => {
      // 壊れた新形式レコードから id を推測して正典へ入れない (呼び出し側は数えて警告する)
      const batches = inMemoryBatches();
      batches._seed(batch('ok', 1));
      batches._seedRkey(`v1~${FILE}~42~short-clock`, batch('bad', 2));
      const provider = new AtprotoSyncProvider({ batches });
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
      const provider = new AtprotoSyncProvider({ batches });

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
      const provider = new AtprotoSyncProvider({ batches });

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
      const provider = new AtprotoSyncProvider({ batches });

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
      const provider = new AtprotoSyncProvider({ batches });

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
      const provider = new AtprotoSyncProvider({ batches });

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
      const provider = new AtprotoSyncProvider({ batches });

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

  describe('listRemoteFileIds (Phase 7 p7-3)', () => {
    it('remote に存在する fileId を返す (batch 本体は伴わない)', async () => {
      // 未知ファイルの発見はまず fileId の集合を要求する。本体は未知の分だけ取れば
      // よく、既知ファイルの履歴を落とさないのが p7-3 の要点 (設計 §3.3)。
      const batches = inMemoryBatches();
      batches._seed(batch('a', 1), FILE_LOWER);
      batches._seed(batch('b', 1));
      batches._seed(batch('c', 2));
      const provider = new AtprotoSyncProvider({ batches });

      const ids = await provider.listRemoteFileIds();
      expect([...ids].sort()).toEqual([FILE_LOWER, FILE].sort());
    });

    it('旧 rkey のレコードしか無いファイルは現れない', async () => {
      // 旧 rkey は fileId を持たないので列挙できない。それらは移行 (p7-4) が新 rkey で
      // 再 push するまで発見経路の外にあり、移行前の 1 回の全件受信 (§3.4) が穴を塞ぐ。
      const batches = inMemoryBatches();
      batches._seedLegacy(batch('old', 1));
      const provider = new AtprotoSyncProvider({ batches });

      expect(await provider.listRemoteFileIds()).toEqual([]);
    });
  });
});
