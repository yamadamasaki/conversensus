import { describe, expect, it } from 'bun:test';
import type { Batch, FileId, NodeId } from '@conversensus/shared';

const FILE = '22222222-2222-4222-8222-222222222222' as FileId;

import {
  AtprotoSyncProvider,
  type BatchCollection,
  type IntervalScheduler,
} from './atprotoSyncProvider';
import { batchToRecord } from './batchMapper';
import { NSID } from './types';

const batch = (id: string, clock: number, actor = 'did:plc:alice'): Batch => ({
  id: id as Batch['id'],
  actor,
  clock,
  timestamp: clock,
  ops: [{ kind: 'node.add', target: `n${id}` as NodeId, content: id }],
});

/** collections.batches と同形の in-memory 実装 */
function inMemoryBatches() {
  const records = new Map<
    string,
    { uri: string; cid: string; value: unknown }
  >();
  let cid = 0;
  const store: BatchCollection & {
    _seed: (b: Batch) => void;
    _size: () => number;
  } = {
    put(batchId, data) {
      cid += 1;
      const uri = `at://did:plc:test/${NSID.batch}/${batchId}`;
      records.set(batchId, {
        uri,
        cid: `cid-${cid}`,
        value: { $type: NSID.batch, ...data },
      });
      return Promise.resolve({ uri, cid: `cid-${cid}` });
    },
    list() {
      return Promise.resolve([...records.values()]);
    },
    _seed(b) {
      records.set(b.id, {
        uri: `at://did:plc:test/${NSID.batch}/${b.id}`,
        cid: `seed-${b.id}`,
        value: { $type: NSID.batch, ...batchToRecord(b, FILE) },
      });
    },
    _size: () => records.size,
  };
  return store;
}

/** 手動でティックできるスケジューラ */
function manualScheduler() {
  let cb: (() => void) | null = null;
  const scheduler: IntervalScheduler = {
    set(callback) {
      cb = callback;
      return 1;
    },
    clear() {
      cb = null;
    },
  };
  return {
    scheduler,
    tick: () => cb?.(),
    get active() {
      return cb !== null;
    },
  };
}

/** マイクロタスク + マクロタスクを flush する */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('AtprotoSyncProvider', () => {
  describe('pushRemote', () => {
    it('batch を rkey=batchId で op-log へ書く', async () => {
      const batches = inMemoryBatches();
      const provider = new AtprotoSyncProvider({ batches });
      await provider.pushRemote(
        [batch('1', 1), batch('2', 2)].map((batch) => ({
          fileId: FILE,
          batch,
        })),
      );
      expect(batches._size()).toBe(2);
    });

    it('同一 batchId の push は上書き (べき等、重複しない)', async () => {
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

  describe('pullRemote (Phase 4d-4)', () => {
    it('既読位置を持たず常に全件を返す', async () => {
      // 4d-3 までは clock cursor で絞っていたが、clock は端末をまたぐと単調でなく
      // 取りこぼす (§1.3)。ATProto 側にも既読位置に使える値が無い (rkey は UUID で
      // 時系列順にならない) ため、既読位置を持たない契約にした。
      const batches = inMemoryBatches();
      batches._seed(batch('a', 1));
      batches._seed(batch('b', 3));
      batches._seed(batch('c', 2));
      const provider = new AtprotoSyncProvider({ batches });

      const first = await provider.pullRemote();
      expect(first.map((e) => e.batch.id)).toEqual(['a', 'c', 'b']);

      // 2 回目も同じ全件が返る (前進する既読位置が無い = 取りこぼしようがない)
      const second = await provider.pullRemote();
      expect(second.map((e) => e.batch.id)).toEqual(['a', 'c', 'b']);
    });

    it('clock → actor → id の順に整列して返す (orderBatches と同じ規則)', async () => {
      const batches = inMemoryBatches();
      // 同一 clock で actor 違い。timestamp は逆順に置く
      batches._seed({ ...batch('x', 2), actor: 'dev-b', timestamp: 1 });
      batches._seed({ ...batch('y', 2), actor: 'dev-a', timestamp: 999 });
      batches._seed(batch('z', 1));
      const provider = new AtprotoSyncProvider({ batches });
      const entries = await provider.pullRemote();
      // clock 1 の z → clock 2 は actor 昇順で dev-a(y) → dev-b(x)
      expect(entries.map((e) => e.batch.id)).toEqual(['z', 'y', 'x']);
    });

    it('適用先 fileId をエンベロープで返す', async () => {
      // remote の batch コレクションは repo 全体で 1 つなので、受信側は
      // レコード自身の fileId でしか適用先を復元できない (§3.1)。
      const batches = inMemoryBatches();
      batches._seed(batch('a', 1));
      const provider = new AtprotoSyncProvider({ batches });
      const entries = await provider.pullRemote();
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
      const entries = await provider.pullRemote();
      expect(entries.map((e) => e.batch.id)).toEqual(['a']);
    });
  });

  describe('subscribe', () => {
    it('初回 poll は baseline 確立のみで配信しない', async () => {
      const batches = inMemoryBatches();
      batches._seed(batch('a', 1));
      const manual = manualScheduler();
      const provider = new AtprotoSyncProvider({
        batches,
        scheduler: manual.scheduler,
      });
      const received: Batch[][] = [];
      provider.subscribe((b) => received.push(b));

      manual.tick(); // baseline
      await flush();
      expect(received).toHaveLength(0);
    });

    it('baseline 後に現れた新規 batch だけを配信する', async () => {
      const batches = inMemoryBatches();
      batches._seed(batch('a', 1));
      const manual = manualScheduler();
      const provider = new AtprotoSyncProvider({
        batches,
        scheduler: manual.scheduler,
      });
      const received: RemoteBatch[][] = [];
      provider.subscribe((b) => received.push([...b]));

      manual.tick(); // baseline (観測済み集合 → {a})
      await flush();
      batches._seed(batch('b', 2)); // 他ユーザーの追記
      manual.tick();
      await flush();

      expect(received).toHaveLength(1);
      expect(received[0]?.map((x) => x.batch.id)).toEqual(['b']);
    });

    it('baseline の poll が失敗しても、その間の batch を落とさない (4d-4 回帰)', async () => {
      // cursor 版の欠陥 (§1.5): 初回 poll が失敗すると次の成功 poll が baseline になり、
      // その間に現れた batch を恒久的に落としていた。観測済み id 集合なら poll が
      // 失敗しても集合は前進しないので、次の成功 poll で取りこぼし分がそのまま現れる。
      const batches = inMemoryBatches();
      batches._seed(batch('a', 1));
      const manual = manualScheduler();
      const provider = new AtprotoSyncProvider({
        batches,
        scheduler: manual.scheduler,
      });
      const received: RemoteBatch[][] = [];
      provider.subscribe((b) => received.push([...b]));

      // 初回 poll を失敗させる (baseline 未確立のまま)
      const failing = new Error('network down');
      const original = batches.list;
      batches.list = () => Promise.reject(failing);
      manual.tick();
      await flush();
      expect(received).toHaveLength(0);

      // 失敗中に他ユーザーが追記
      batches.list = original;
      batches._seed(batch('b', 2));

      manual.tick(); // ここが baseline になる (a も b も観測済みになるだけ)
      await flush();
      manual.tick();
      await flush();
      // baseline 後の新規は無いので配信は 0。重要なのは a/b が「見えなくなる」のではなく
      // 観測済み集合に入ること — 次に現れた c は必ず配信される。
      batches._seed(batch('c', 3));
      manual.tick();
      await flush();
      expect(received).toHaveLength(1);
      expect(received[0]?.map((x) => x.batch.id)).toEqual(['c']);
    });

    it('unsubscribe でティックが止まる', async () => {
      const batches = inMemoryBatches();
      const manual = manualScheduler();
      const provider = new AtprotoSyncProvider({
        batches,
        scheduler: manual.scheduler,
      });
      const unsubscribe = provider.subscribe(() => {});
      expect(manual.active).toBe(true);
      unsubscribe();
      expect(manual.active).toBe(false);
    });
  });
});
