import { describe, expect, it } from 'bun:test';
import {
  type Batch,
  GENESIS_ACTOR,
  type NodeId,
  type Op,
} from '@conversensus/shared';
import type {
  Cursor,
  OnRemote,
  PullResult,
  SyncProvider,
} from '../sync/syncProvider';
import { REMOTE_QUEUE_MAX, RemoteSyncQueue } from './remoteSyncQueue';

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

/** push/pull を記録し成否・pull 応答を切り替えられるテスト用 provider */
class FakeProvider implements SyncProvider {
  pushed: Batch[][] = [];
  online = true;
  pullBatches: Batch[] = [];

  async push(batches: Batch[]): Promise<void> {
    if (!this.online) throw new Error('offline');
    this.pushed.push(batches);
  }
  async pull(_since: Cursor): Promise<PullResult> {
    return { batches: this.pullBatches, cursor: '' };
  }
  subscribe(_onRemote: OnRemote) {
    return () => {};
  }
  /** これまでに push された batch を平坦化 */
  get flatPushed(): Batch[] {
    return this.pushed.flat();
  }
}

describe('RemoteSyncQueue', () => {
  describe('enqueue (フィルタ適用)', () => {
    it('genesis actor の batch は積まない (C1)', () => {
      const q = new RemoteSyncQueue({ provider: new FakeProvider() });
      q.enqueue([batch('1', { actor: GENESIS_ACTOR })]);
      expect(q.pendingCount).toBe(0);
    });

    it('全 op が presentation の batch は積まない', () => {
      const q = new RemoteSyncQueue({ provider: new FakeProvider() });
      q.enqueue([batch('1', { ops: [setStyle('n1')] })]);
      expect(q.pendingCount).toBe(0);
    });

    it('mixed batch は presentation を除いて積む', () => {
      const q = new RemoteSyncQueue({ provider: new FakeProvider() });
      q.enqueue([batch('1', { ops: [addNode('n1'), setStyle('n1')] })]);
      expect(q.pendingCount).toBe(1);
      expect(q.pending()[0].ops).toEqual([addNode('n1')]);
    });
  });

  describe('flush (best-effort)', () => {
    it('成功したらキューから除去する', async () => {
      const provider = new FakeProvider();
      const q = new RemoteSyncQueue({ provider });
      q.enqueue([batch('1'), batch('2')]);
      const result = await q.flush();
      expect(result.ok).toBe(true);
      expect(q.pendingCount).toBe(0);
      expect(provider.flatPushed.map((b) => b.id)).toEqual(['1', '2']);
    });

    it('失敗しても破棄せず保持する', async () => {
      const provider = new FakeProvider();
      provider.online = false;
      const q = new RemoteSyncQueue({ provider });
      q.enqueue([batch('1')]);
      const result = await q.flush();
      expect(result.ok).toBe(false);
      expect(q.pendingCount).toBe(1); // 破棄しない
    });

    it('復帰後の再 flush で送信できる', async () => {
      const provider = new FakeProvider();
      provider.online = false;
      const q = new RemoteSyncQueue({ provider });
      q.enqueue([batch('1')]);
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

      q.enqueue([batch('1')]);
      await q.flush();
      expect(seen[seen.length - 1]).toBe(0); // flush 後は 0
      expect(seen).toContain(1); // enqueue 直後に 1 を観測

      unsub();
      q.enqueue([batch('2')]);
      expect(seen[seen.length - 1]).toBe(0); // 解除後は通知されない
    });
  });

  describe('上限 (D1)', () => {
    it('capacity を超えると最古から溢れ overflowed になる', () => {
      const q = new RemoteSyncQueue({
        provider: new FakeProvider(),
        capacity: 2,
      });
      q.enqueue([batch('1'), batch('2'), batch('3')]);
      expect(q.pendingCount).toBe(2);
      expect(q.pending().map((b) => b.id)).toEqual(['2', '3']);
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
      provider.pullBatches = [batch('1')];
      const q = new RemoteSyncQueue({ provider });
      const result = await q.catchUp([batch('1'), batch('2'), batch('3')]);
      expect(result.ok).toBe(true);
      expect(provider.flatPushed.map((b) => b.id)).toEqual(['2', '3']);
      expect(q.pendingCount).toBe(0);
    });

    it('catch-up も genesis batch は積まない (C1)', async () => {
      const provider = new FakeProvider();
      provider.pullBatches = [];
      const q = new RemoteSyncQueue({ provider });
      await q.catchUp([batch('1', { actor: GENESIS_ACTOR }), batch('2')]);
      // genesis の '1' は除外され、'2' だけ push される
      expect(provider.flatPushed.map((b) => b.id)).toEqual(['2']);
    });
  });
});
