import { describe, expect, it } from 'bun:test';
import {
  type Batch,
  type FileId,
  GENESIS_ACTOR,
  type NodeId,
  type Op,
} from '@conversensus/shared';
import {
  REMOTE_QUEUE_MAX,
  type RemoteBatchTarget,
  RemoteSyncQueue,
} from './remoteSyncQueue';
import type { RemoteBatch } from './types';

const FILE = '22222222-2222-4222-8222-222222222222' as FileId;

const addNode = (id: string): Op => ({
  kind: 'node.add',
  target: id as NodeId,
  content: id,
});
const setStyle = (id: string): Op => ({
  kind: 'node.setStyle',
  target: id as NodeId,
  style: {},
});

const batch = (id: string, over: Partial<Batch> = {}): Batch => ({
  id: id as Batch['id'],
  actor: 'did:plc:alice',
  clock: Number(id) || 1,
  timestamp: 1_700_000_000_000,
  ops: [addNode(id)],
  ...over,
});

/** pushRemote/pullRemote を記録し成否・pull 応答を切り替えられるテスト用 remote */
class FakeProvider implements RemoteBatchTarget {
  pushed: RemoteBatch[][] = [];
  online = true;
  /** pullRemote が返すエンベロープ (repo 全体なので他ファイル分も混ざりうる) */
  pullEntries: RemoteBatch[] = [];

  async pushRemote(entries: readonly RemoteBatch[]): Promise<void> {
    if (!this.online) throw new Error('offline');
    this.pushed.push([...entries]);
  }
  async pullRemote(): Promise<RemoteBatch[]> {
    return this.pullEntries;
  }
  /** `pullEntries` を「全部 FILE のもの」として簡便に設定するヘルパ */
  setPullBatches(batches: Batch[], fileId: FileId = FILE): void {
    this.pullEntries = batches.map((batch) => ({ fileId, batch }));
  }
  /** これまでに push された batch を平坦化 */
  get flatPushed(): Batch[] {
    return this.pushed.flat().map((e) => e.batch);
  }
  /** これまでに push されたエンベロープを平坦化 (fileId の検証用) */
  get flatEntries(): RemoteBatch[] {
    return this.pushed.flat();
  }
}

describe('RemoteSyncQueue', () => {
  describe('fileId の運搬 (Phase 4d-1)', () => {
    it('enqueue で渡した fileId を送信エンベロープに添える', async () => {
      // remote の batch コレクションは repo 全体で 1 つなので、送信単位は fileId を伴う
      const provider = new FakeProvider();
      const q = new RemoteSyncQueue({ provider });
      q.enqueue([batch('1')], FILE);
      await q.flush();
      expect(provider.flatEntries).toEqual([
        { fileId: FILE, batch: batch('1') },
      ]);
    });

    it('別ファイルの batch はそれぞれの fileId で積まれる', async () => {
      const other = '33333333-3333-4333-8333-333333333333' as FileId;
      const provider = new FakeProvider();
      const q = new RemoteSyncQueue({ provider });
      q.enqueue([batch('1')], FILE);
      q.enqueue([batch('2')], other);
      await q.flush();
      expect(provider.flatEntries.map((e) => [e.batch.id, e.fileId])).toEqual([
        ['1', FILE],
        ['2', other],
      ]);
    });
  });

  describe('enqueue (フィルタ適用)', () => {
    it('genesis actor の batch も積む (Phase 4e-0・C1 見直し)', () => {
      const q = new RemoteSyncQueue({ provider: new FakeProvider() });
      q.enqueue([batch('1', { actor: GENESIS_ACTOR })], FILE);
      expect(q.pendingCount).toBe(1);
    });

    it('全 op が presentation の batch は積まない', () => {
      const q = new RemoteSyncQueue({ provider: new FakeProvider() });
      q.enqueue([batch('1', { ops: [setStyle('n1')] })], FILE);
      expect(q.pendingCount).toBe(0);
    });

    it('mixed batch は presentation を除いて積む', () => {
      const q = new RemoteSyncQueue({ provider: new FakeProvider() });
      q.enqueue([batch('1', { ops: [addNode('n1'), setStyle('n1')] })], FILE);
      expect(q.pendingCount).toBe(1);
      expect(q.pending()[0].batch.ops).toEqual([addNode('n1')]);
    });
  });

  describe('flush (best-effort)', () => {
    it('成功したらキューから除去する', async () => {
      const provider = new FakeProvider();
      const q = new RemoteSyncQueue({ provider });
      q.enqueue([batch('1'), batch('2')], FILE);
      const result = await q.flush();
      expect(result.ok).toBe(true);
      expect(q.pendingCount).toBe(0);
      expect(provider.flatPushed.map((b) => b.id)).toEqual(['1', '2']);
    });

    it('失敗しても破棄せず保持する', async () => {
      const provider = new FakeProvider();
      provider.online = false;
      const q = new RemoteSyncQueue({ provider });
      q.enqueue([batch('1')], FILE);
      const result = await q.flush();
      expect(result.ok).toBe(false);
      expect(q.pendingCount).toBe(1); // 破棄しない
    });

    it('復帰後の再 flush で送信できる', async () => {
      const provider = new FakeProvider();
      provider.online = false;
      const q = new RemoteSyncQueue({ provider });
      q.enqueue([batch('1')], FILE);
      await q.flush(); // 失敗・保持
      provider.online = true;
      const result = await q.flush(); // 再送
      expect(result.ok).toBe(true);
      expect(q.pendingCount).toBe(0);
    });
  });

  describe('pending 購読', () => {
    it('登録直後に現在値を通知し、enqueue/flush で更新する', async () => {
      const provider = new FakeProvider();
      const q = new RemoteSyncQueue({ provider });
      const seen: number[] = [];
      const unsub = q.subscribe((n) => seen.push(n));
      expect(seen).toEqual([0]); // 登録直後

      q.enqueue([batch('1')], FILE);
      await q.flush();
      expect(seen[seen.length - 1]).toBe(0); // flush 後は 0
      expect(seen).toContain(1); // enqueue 直後に 1 を観測

      unsub();
      q.enqueue([batch('2')], FILE);
      expect(seen[seen.length - 1]).toBe(0); // 解除後は通知されない
    });
  });

  describe('上限 (D1)', () => {
    it('capacity を超えると最古から溢れ overflowed になる', () => {
      const q = new RemoteSyncQueue({
        provider: new FakeProvider(),
        capacity: 2,
      });
      q.enqueue([batch('1'), batch('2'), batch('3')], FILE);
      expect(q.pendingCount).toBe(2);
      expect(q.pending().map((e) => e.batch.id)).toEqual(['2', '3']);
      expect(q.overflowed).toBe(true);
    });

    it('既定上限は REMOTE_QUEUE_MAX で正の有限値', () => {
      expect(Number.isFinite(REMOTE_QUEUE_MAX)).toBe(true);
      expect(REMOTE_QUEUE_MAX).toBeGreaterThan(0);
    });
  });

  describe('catchUp (取りこぼし回収)', () => {
    it('remote に無いローカル batch のみ積み直して flush する', async () => {
      const provider = new FakeProvider();
      // remote には '1' が既にある。'2','3' が取りこぼし
      provider.setPullBatches([batch('1')]);
      const q = new RemoteSyncQueue({ provider });
      const result = await q.catchUp(
        [batch('1'), batch('2'), batch('3')],
        FILE,
      );
      expect(result.ok).toBe(true);
      expect(provider.flatPushed.map((b) => b.id)).toEqual(['2', '3']);
      expect(q.pendingCount).toBe(0);
    });

    it('catch-up も genesis batch を積む (Phase 4e-0・C1 見直し)', async () => {
      const provider = new FakeProvider();
      provider.setPullBatches([]);
      const q = new RemoteSyncQueue({ provider });
      await q.catchUp([batch('1', { actor: GENESIS_ACTOR }), batch('2')], FILE);
      // genesis の '1' も bootstrap の起源として push される
      expect(provider.flatPushed.map((b) => b.id)).toEqual(['1', '2']);
    });

    it('突合は fileId で絞ってから行う (Phase 4d-4, D-6)', async () => {
      const provider = new FakeProvider();
      const OTHER = '33333333-3333-4333-8333-333333333333' as FileId;
      // remote は repo 全体なので他ファイルの batch も返ってくる。
      // 別ファイルの '2' は FILE の突合対象に入ってはならない。
      provider.pullEntries = [
        { fileId: FILE, batch: batch('1') },
        { fileId: OTHER, batch: batch('2') },
      ];
      const q = new RemoteSyncQueue({ provider });
      await q.catchUp([batch('1'), batch('2')], FILE);
      // '1' は FILE に既にあるので送らない。'2' は OTHER のものなので
      // FILE としては未送信 → 積み直す。
      expect(provider.flatPushed.map((b) => b.id)).toEqual(['2']);
    });

    it('他ファイルの batch しか remote に無ければローカル全件を積み直す', async () => {
      const provider = new FakeProvider();
      const OTHER = '33333333-3333-4333-8333-333333333333' as FileId;
      provider.pullEntries = [
        { fileId: OTHER, batch: batch('1') },
        { fileId: OTHER, batch: batch('2') },
      ];
      const q = new RemoteSyncQueue({ provider });
      await q.catchUp([batch('1'), batch('2')], FILE);
      expect(provider.flatPushed.map((b) => b.id)).toEqual(['1', '2']);
      // 積み直したエンベロープは FILE 宛であること
      expect(provider.flatEntries.every((e) => e.fileId === FILE)).toBe(true);
    });
  });
});
