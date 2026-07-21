import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { Batch, EdgeId, FileId, NodeId } from '@conversensus/shared';

// zod を先にモックする (../api / ../atproto 経由で推移的に読まれる)
const zodProxy: Record<string, unknown> = new Proxy(() => zodProxy, {
  get: () => zodProxy,
  apply: () => zodProxy,
}) as unknown as Record<string, unknown>;

mock.module('zod', () => ({
  z: zodProxy,
  default: zodProxy,
}));

const { renderHook, act, cleanup } = await import('@testing-library/react');
const { useEventSyncTap } = await import('./useEventSyncTap');

import type { RemoteBatchTarget } from '../atproto/remoteSyncQueue';
import type { RemoteBatch } from '../atproto/types';

const { RemoteSyncQueue } = await import('../atproto/remoteSyncQueue');
const { GENESIS_ACTOR } = await import('@conversensus/shared');
type SyncProvider = import('../sync/syncProvider').SyncProvider;
type Cursor = import('../sync/syncProvider').Cursor;
type OnRemote = import('../sync/syncProvider').OnRemote;
type PullResult = import('../sync/syncProvider').PullResult;

const FID = '00000000-0000-4000-8000-00000000f11e' as FileId;

let seq = 0;
const uuid = () => {
  seq += 1;
  return `${seq.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
};

/** node.setContent を 1 件生む content イベント (ops あり) */
const relabel = () => ({
  id: uuid(),
  timestamp: Date.now(),
  category: 'content' as const,
  type: 'NODE_RELABELED' as const,
  nodeId: uuid() as NodeId,
  from: 'a',
  to: 'b',
});

/**
 * presentation op (`edge.setStyle`) だけを生むイベント。
 * NODE_STYLE_CHANGED は実体が width/height なので `node.setLayout` に正規化され
 * **同期対象** (D7)。presentation を試すにはエッジの見た目を使う。
 */
const restyle = () => ({
  id: uuid(),
  timestamp: Date.now(),
  category: 'presentation' as const,
  type: 'EDGE_STYLE_CHANGED' as const,
  edgeId: uuid() as EdgeId,
  from: {},
  to: { stroke: '#f00' },
});

class RecordingProvider implements SyncProvider, RemoteBatchTarget {
  pushed: Batch[] = [];
  /** pull が返す既存ログ (local では Lamport 復元と catch-up の元ネタになる) */
  existing: Batch[] = [];
  async pushRemote(entries: readonly RemoteBatch[]): Promise<void> {
    return this.push(entries.map((e) => e.batch));
  }
  async push(batches: Batch[]): Promise<void> {
    this.pushed.push(...batches);
  }
  async pull(_since: Cursor): Promise<PullResult> {
    return { batches: this.existing, cursor: '' };
  }
  /** remote 側の取得 (Phase 4d-4: cursor を取らず全件返す) */
  async pullRemote(): Promise<RemoteBatch[]> {
    return this.existing.map((batch) => ({ fileId: FID, batch }));
  }
  subscribe(_onRemote: OnRemote) {
    return () => {};
  }
}

const batch = (id: string, over: Partial<Batch> = {}): Batch => ({
  id: id as Batch['id'],
  actor: 'did:plc:alice',
  clock: 1,
  timestamp: 1_700_000_000_000,
  ops: [{ kind: 'node.add', target: id as NodeId, content: id }],
  ...over,
});

afterEach(cleanup);

/** local provider を差し替えた tap を張る。remoteQueue を渡すと fanout 構成になる */
async function renderTap(opts: {
  local: RecordingProvider;
  remoteQueue?: InstanceType<typeof RemoteSyncQueue> | null;
  fileId?: FileId | null;
}) {
  const createLocalProvider = () => opts.local;
  const view = renderHook(() =>
    useEventSyncTap(opts.fileId === undefined ? FID : opts.fileId, {
      remoteQueue: opts.remoteQueue ?? null,
      createLocalProvider,
    }),
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return view;
}

/** tap は非同期に flush するので、記録後に少し待つ */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

describe('useEventSyncTap (remote 配線 W3d5-5)', () => {
  describe('remoteQueue なし (未ログイン) = local-only', () => {
    it('編集はローカル正典にだけ流れる (W3d と同一挙動)', async () => {
      const local = new RecordingProvider();
      const { result } = await renderTap({ local });
      result.current(relabel());
      await settle();
      expect(local.pushed).toHaveLength(1);
    });
  });

  describe('remoteQueue あり (ログイン中) = fanout', () => {
    it('編集がローカル正典と remote の両方へ流れる', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({ provider: remote });
      const { result } = await renderTap({ local, remoteQueue });

      result.current(relabel());
      await settle();

      expect(local.pushed).toHaveLength(1);
      expect(remote.pushed).toHaveLength(1);
      expect(remote.pushed[0].id).toBe(local.pushed[0].id); // 同じ batch が両系統へ
    });

    it('presentation はローカルに残り remote には載らない (D7)', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({ provider: remote });
      const { result } = await renderTap({ local, remoteQueue });

      result.current(restyle());
      await settle();

      expect(local.pushed).toHaveLength(1); // ローカル正典には残す (W3e 保全)
      expect(remote.pushed).toHaveLength(0); // remote へは送らない
    });
  });

  describe('再接続時 catch-up (§3.6 / W3d5-7)', () => {
    it('online イベントで取りこぼしを回収する', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      remote.existing = []; // 起動時は remote 空 = 取りこぼし無し
      const remoteQueue = new RemoteSyncQueue({ provider: remote });

      await renderTap({ local, remoteQueue });
      await settle();
      expect(remote.pushed).toHaveLength(0);

      // オフライン中に積まれたローカル正典の batch を、復帰後に拾えること
      local.existing = [batch('1')];
      window.dispatchEvent(new Event('online'));
      await settle();

      expect(remote.pushed.map((b) => b.id)).toEqual(['1']);
    });

    it('unmount 後の online では catch-up しない (リスナ解除)', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({ provider: remote });

      const { unmount } = await renderTap({ local, remoteQueue });
      unmount();

      local.existing = [batch('1')];
      window.dispatchEvent(new Event('online'));
      await settle();

      expect(remote.pushed).toHaveLength(0);
    });
  });

  describe('起動時 catch-up (§3.6)', () => {
    it('ローカル正典にあって remote に無い batch を mount 時に送る', async () => {
      const local = new RecordingProvider();
      local.existing = [batch('1'), batch('2')];
      const remote = new RecordingProvider();
      remote.existing = [batch('1')]; // '2' が取りこぼし
      const remoteQueue = new RemoteSyncQueue({ provider: remote });

      await renderTap({ local, remoteQueue });
      await settle();

      expect(remote.pushed.map((b) => b.id)).toEqual(['2']);
    });

    it('catch-up でも genesis batch は remote へ送らない (C1)', async () => {
      const local = new RecordingProvider();
      local.existing = [batch('1', { actor: GENESIS_ACTOR }), batch('2')];
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({ provider: remote });

      await renderTap({ local, remoteQueue });
      await settle();

      expect(remote.pushed.map((b) => b.id)).toEqual(['2']);
    });

    it('remoteQueue が無ければ catch-up は起きない (fanout でない)', async () => {
      const local = new RecordingProvider();
      local.existing = [batch('1')];
      await renderTap({ local });
      await settle();
      // local への push は catch-up 由来では発生しない (読取のみ)
      expect(local.pushed).toHaveLength(0);
    });
  });

  describe('ファイル未オープン', () => {
    it('fileId が null なら record は no-op で provider を作らない', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({ provider: remote });
      const { result } = await renderTap({ local, remoteQueue, fileId: null });

      result.current(relabel());
      await settle();

      expect(local.pushed).toHaveLength(0);
      expect(remote.pushed).toHaveLength(0);
    });
  });
});
