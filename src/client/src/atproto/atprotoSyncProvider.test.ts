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

  describe('pull', () => {
    it('cursor より後 (clock 大) の batch のみ clock 昇順で返す', async () => {
      const batches = inMemoryBatches();
      batches._seed(batch('a', 1));
      batches._seed(batch('b', 3));
      batches._seed(batch('c', 2));
      const provider = new AtprotoSyncProvider({ batches });
      const result = await provider.pull('1'); // clock > 1
      expect(result.batches.map((b) => b.id)).toEqual(['c', 'b']);
      expect(result.cursor).toBe('3'); // 取得済み最大 clock
    });

    it('空 cursor は最初から全件を返す', async () => {
      const batches = inMemoryBatches();
      batches._seed(batch('a', 1));
      batches._seed(batch('b', 2));
      const provider = new AtprotoSyncProvider({ batches });
      const result = await provider.pull('');
      expect(result.batches).toHaveLength(2);
      expect(result.cursor).toBe('2');
    });

    it('新規がなくても cursor は tip まで前進する', async () => {
      const batches = inMemoryBatches();
      batches._seed(batch('a', 5));
      const provider = new AtprotoSyncProvider({ batches });
      const result = await provider.pull('5');
      expect(result.batches).toHaveLength(0);
      expect(result.cursor).toBe('5');
    });

    it('壊れた / 他種レコードは飛ばす', async () => {
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
      const result = await provider.pull('');
      expect(result.batches.map((b) => b.id)).toEqual(['a']);
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
      const received: Batch[][] = [];
      provider.subscribe((b) => received.push(b));

      manual.tick(); // baseline (cursor → 1)
      await flush();
      batches._seed(batch('b', 2)); // 他ユーザーの追記
      manual.tick();
      await flush();

      expect(received).toHaveLength(1);
      expect(received[0]?.map((x) => x.id)).toEqual(['b']);
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
