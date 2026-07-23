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

/**
 * 受信の書き込み先を記録する (Phase 4d-5)。フックの `appendReceived` オプションへ
 * 注入するので実 fetch は走らない。**受信が実際に発火したか**を観測できるようにする —
 * フック側は受信失敗を `.catch` で握るため、これが無いと「何も起きていない」と
 * 「静かに失敗した」を区別できない (W3d5-7 の「400 が無言」の教訓)。
 *
 * `mock.module('../api', ...)` は使わない — bun のモジュールモックはグローバルなので、
 * 他のテストファイルから `../api` の別の export が見えなくなる。
 */
const receivedWrites: Array<{ fileId: FileId; batches: Batch[] }> = [];
let receiveFails: Error | null = null;
const appendReceived = async (fileId: FileId, batches: Batch[]) => {
  if (receiveFails) throw receiveFails;
  receivedWrites.push({ fileId, batches });
  return batches.length;
};

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

afterEach(() => {
  cleanup();
  // 受信モックの記録・失敗設定をテスト間で持ち越さない
  receivedWrites.length = 0;
  receiveFails = null;
});

/** local provider を差し替えた tap を張る。remoteQueue を渡すと fanout 構成になる */
async function renderTap(opts: {
  local: RecordingProvider;
  remoteQueue?: InstanceType<typeof RemoteSyncQueue> | null;
  fileId?: FileId | null;
  onReceived?: Parameters<typeof useEventSyncTap>[1]['onReceived'];
}) {
  const createLocalProvider = () => opts.local;
  const view = renderHook(() =>
    useEventSyncTap(opts.fileId === undefined ? FID : opts.fileId, {
      remoteQueue: opts.remoteQueue ?? null,
      createLocalProvider,
      appendReceived,
      ...(opts.onReceived && { onReceived: opts.onReceived }),
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

    it('catch-up で genesis batch も remote へ送る (Phase 4e-0・C1 見直し)', async () => {
      const local = new RecordingProvider();
      local.existing = [batch('1', { actor: GENESIS_ACTOR }), batch('2')];
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({ provider: remote });

      await renderTap({ local, remoteQueue });
      await settle();

      expect(remote.pushed.map((b) => b.id)).toEqual(['1', '2']);
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

  describe('受信の配線 (Phase 4d-5)', () => {
    it('mount 時に remote の batch をローカル正典へ取り込む', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      remote.existing = [batch('r1'), batch('r2')];
      const remoteQueue = new RemoteSyncQueue({ provider: remote });

      await renderTap({ local, remoteQueue });
      await settle();

      // 受信が実際に発火し、正典宣言つきの書き込み口へ届いていること
      expect(receivedWrites).toHaveLength(1);
      expect(receivedWrites[0]?.fileId).toBe(FID);
      expect(receivedWrites[0]?.batches.map((b) => b.id)).toEqual(['r1', 'r2']);
    });

    it('受信は fanout を通さない — remote へ送り返さない (echo ループ回避, §3.3a)', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      remote.existing = [batch('r1')];
      const remoteQueue = new RemoteSyncQueue({ provider: remote });

      await renderTap({ local, remoteQueue });
      await settle();

      // 受信した 'r1' が remote へ push され直していないこと。
      // (catch-up は local.existing が空なので何も送らない)
      expect(remote.pushed.map((b) => b.id)).not.toContain('r1');
    });

    it('online イベントでも受信する (送信 catch-up と同じ契機, §3.4)', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      const remoteQueue = new RemoteSyncQueue({ provider: remote });

      await renderTap({ local, remoteQueue });
      await settle();
      const afterMount = receivedWrites.length;

      remote.existing = [batch('r9')];
      window.dispatchEvent(new Event('online'));
      await settle();

      expect(receivedWrites.length).toBe(afterMount + 1);
      expect(receivedWrites.at(-1)?.batches.map((b) => b.id)).toEqual(['r9']);
    });

    it('受信が失敗しても送信 catch-up は動く (両者は独立)', async () => {
      const local = new RecordingProvider();
      local.existing = [batch('1')];
      const remote = new RecordingProvider();
      remote.existing = [batch('r1')];
      const remoteQueue = new RemoteSyncQueue({ provider: remote });
      receiveFails = new Error('daemon down');

      await renderTap({ local, remoteQueue });
      await settle();

      // 受信は失敗したが、ローカルにあって remote に無い '1' は送られている
      expect(remote.pushed.map((b) => b.id)).toContain('1');
      expect(receivedWrites).toHaveLength(0);
    });

    it('remoteQueue が無ければ受信も起きない (未ログイン時は local-only)', async () => {
      const local = new RecordingProvider();
      await renderTap({ local });
      await settle();
      expect(receivedWrites).toHaveLength(0);
    });
  });

  describe('画面反映の起点 onReceived (Phase 4e-3)', () => {
    it('受信が着地したら fileId・結果・待ち合わせ点つきで呼ばれる', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider();
      remote.existing = [batch('r1'), batch('r2')];
      const remoteQueue = new RemoteSyncQueue({ provider: remote });
      const calls: Array<{
        fileId: FileId;
        appended: number;
        pending: number;
      }> = [];

      await renderTap({
        local,
        remoteQueue,
        onReceived: async (fileId, result, tap) => {
          await tap.settled(); // 待ち合わせ点がそのまま使える
          calls.push({
            fileId,
            appended: result.appended,
            pending: tap.pending(),
          });
        },
      });
      await settle();

      expect(calls).toEqual([{ fileId: FID, appended: 2, pending: 0 }]);
    });

    it('新規着地が無ければ呼ばれない (再 projection しても画面は変わらない)', async () => {
      const local = new RecordingProvider();
      const remote = new RecordingProvider(); // remote は空 = 受信 0 件
      const remoteQueue = new RemoteSyncQueue({ provider: remote });
      let called = 0;

      await renderTap({
        local,
        remoteQueue,
        onReceived: () => {
          called += 1;
        },
      });
      await settle();

      expect(called).toBe(0);
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
