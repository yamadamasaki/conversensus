import { describe, expect, it } from 'bun:test';
import {
  type Batch,
  type FileId,
  GENESIS_ACTOR,
  type NodeId,
  type Op,
} from '@conversensus/shared';
import type {
  Cursor,
  OnRemote,
  PullResult,
  SyncProvider,
  Unsubscribe,
} from '../sync/syncProvider';
import { FanoutSyncProvider } from './fanoutSyncProvider';
import { type RemoteBatchTarget, RemoteSyncQueue } from './remoteSyncQueue';
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

/**
 * push/pull/subscribe を記録し、成否を切り替えられるテスト用 provider。
 * local (SyncProvider) と remote (RemoteBatchTarget) の両方に使えるよう
 * `push` と `pushRemote` の両方を持たせる (Phase 4d-1)。
 */
class FakeProvider implements SyncProvider, RemoteBatchTarget {
  pushed: Batch[][] = [];
  pushedRemote: RemoteBatch[][] = [];
  online = true;
  pullBatches: Batch[] = [];
  pullCursor = 'local-cursor';
  pulledSince: Cursor[] = [];
  subscribed: OnRemote[] = [];
  unsubscribed = 0;

  async push(batches: Batch[]): Promise<void> {
    if (!this.online) throw new Error('offline');
    this.pushed.push(batches);
  }
  async pushRemote(entries: readonly RemoteBatch[]): Promise<void> {
    if (!this.online) throw new Error('offline');
    this.pushedRemote.push([...entries]);
    this.pushed.push(entries.map((e) => e.batch));
  }
  async pull(since: Cursor): Promise<PullResult> {
    this.pulledSince.push(since);
    return { batches: this.pullBatches, cursor: this.pullCursor };
  }
  subscribe(onRemote: OnRemote): Unsubscribe {
    this.subscribed.push(onRemote);
    return () => {
      this.unsubscribed += 1;
    };
  }
  get flatPushed(): Batch[] {
    return this.pushed.flat();
  }
}

/** local / remote / fanout を一式そろえる */
const setup = () => {
  const local = new FakeProvider();
  const remote = new FakeProvider();
  const remoteQueue = new RemoteSyncQueue({ provider: remote });
  const fanout = new FanoutSyncProvider({ local, remoteQueue, fileId: FILE });
  return { local, remote, remoteQueue, fanout };
};

describe('FanoutSyncProvider', () => {
  describe('push — local はブロッキング', () => {
    it('local へ元 batch をそのまま push する (presentation もローカルには残す)', async () => {
      const { local, fanout } = setup();
      const b = batch('1', { ops: [addNode('n1'), setStyle('n1')] });
      await fanout.push([b]);
      expect(local.pushed).toEqual([[b]]);
    });

    it('local が失敗したら throw し、remote へは積まない', async () => {
      const { local, remote, remoteQueue, fanout } = setup();
      local.online = false;
      await expect(fanout.push([batch('1')])).rejects.toThrow('offline');
      expect(remoteQueue.pendingCount).toBe(0);
      expect(remote.flatPushed).toEqual([]);
    });
  });

  describe('push — remote は非ブロッキング', () => {
    it('remote が落ちていても push は resolve し、未送信はキューに残る', async () => {
      const { remote, remoteQueue, fanout } = setup();
      remote.online = false;
      await fanout.push([batch('1')]); // reject しない
      await fanout.whenRemoteSettled();
      expect(remoteQueue.pendingCount).toBe(1); // 破棄せず保持
    });

    it('remote が生きていれば flush されキューが空になる', async () => {
      const { remote, remoteQueue, fanout } = setup();
      await fanout.push([batch('1')]);
      await fanout.whenRemoteSettled();
      expect(remote.flatPushed.map((b) => b.id)).toEqual(['1']);
      expect(remoteQueue.pendingCount).toBe(0);
    });

    it('連続 push でも取りこぼさず全件 remote へ届く', async () => {
      const { remote, remoteQueue, fanout } = setup();
      await fanout.push([batch('1')]);
      await fanout.push([batch('2')]);
      await fanout.push([batch('3')]);
      await fanout.whenRemoteSettled();
      expect(remote.flatPushed.map((b) => b.id)).toEqual(['1', '2', '3']);
      expect(remoteQueue.pendingCount).toBe(0);
    });
  });

  describe('remote leg のフィルタ', () => {
    it('genesis batch は remote へ送らない (C1)', async () => {
      const { local, remote, fanout } = setup();
      const g = batch('1', { actor: GENESIS_ACTOR });
      await fanout.push([g]);
      await fanout.whenRemoteSettled();
      expect(local.flatPushed.map((b) => b.id)).toEqual(['1']); // ローカルには載る
      expect(remote.flatPushed).toEqual([]);
    });

    it('mixed batch は presentation を除いて remote へ送る', async () => {
      const { remote, fanout } = setup();
      await fanout.push([batch('1', { ops: [addNode('n1'), setStyle('n1')] })]);
      await fanout.whenRemoteSettled();
      expect(remote.flatPushed[0].ops).toEqual([addNode('n1')]);
    });

    it('全 op が presentation なら remote へは何も送らない', async () => {
      const { remote, fanout } = setup();
      await fanout.push([batch('1', { ops: [setStyle('n1')] })]);
      await fanout.whenRemoteSettled();
      expect(remote.pushed).toEqual([]); // 空 batch も送らない
    });
  });

  describe('pull / subscribe は local 委譲', () => {
    it('pull は local の結果をそのまま返す (remote の clock を混ぜない)', async () => {
      const { local, remote, fanout } = setup();
      local.pullBatches = [batch('1')];
      remote.pullBatches = [batch('99')];
      const result = await fanout.pull('since-1');
      expect(result.batches.map((b) => b.id)).toEqual(['1']);
      expect(result.cursor).toBe('local-cursor');
      expect(local.pulledSince).toEqual(['since-1']);
      expect(remote.pulledSince).toEqual([]);
    });

    it('subscribe は local へ委譲し、解除も local へ届く', () => {
      const { local, remote, fanout } = setup();
      const onRemote: OnRemote = () => {};
      const unsub = fanout.subscribe(onRemote);
      expect(local.subscribed).toEqual([onRemote]);
      expect(remote.subscribed).toEqual([]);
      unsub();
      expect(local.unsubscribed).toBe(1);
    });
  });
});
