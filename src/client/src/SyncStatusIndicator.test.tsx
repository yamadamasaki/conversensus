import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { Batch, NodeId } from '@conversensus/shared';

// zod を先にモックする (./atproto 経由で推移的に読まれる)
const zodProxy: Record<string, unknown> = new Proxy(() => zodProxy, {
  get: () => zodProxy,
  apply: () => zodProxy,
}) as unknown as Record<string, unknown>;

mock.module('zod', () => ({
  z: zodProxy,
  default: zodProxy,
}));

const { render, screen, fireEvent, act, cleanup } = await import(
  '@testing-library/react'
);
const { SyncStatusIndicator } = await import('./SyncStatusIndicator');

import type { RemoteBatchTarget } from './atproto/remoteSyncQueue';
import type { RemoteBatch } from './atproto/types';

const { RemoteSyncQueue } = await import('./atproto/remoteSyncQueue');
type SyncProvider = import('./sync/syncProvider').SyncProvider;
type Cursor = import('./sync/syncProvider').Cursor;
type OnRemote = import('./sync/syncProvider').OnRemote;
type PullResult = import('./sync/syncProvider').PullResult;

/** online を切り替えて push の成否を作るテスト用 provider */
class FakeProvider implements SyncProvider, RemoteBatchTarget {
  online = true;
  pushed: Batch[] = [];
  async pushRemote(entries: readonly RemoteBatch[]): Promise<void> {
    return this.push(entries.map((e) => e.batch));
  }
  async push(batches: Batch[]): Promise<void> {
    if (!this.online) throw new Error('offline');
    this.pushed.push(...batches);
  }
  async pull(_since: Cursor): Promise<PullResult> {
    return { batches: [], cursor: '' };
  }
  /** remote 側の取得 (Phase 4d-4: cursor を取らず全件返す) */
  async pullRemote(): Promise<RemoteBatch[]> {
    return [];
  }
  subscribe(_onRemote: OnRemote) {
    return () => {};
  }
}

const batch = (id: string): Batch => ({
  id: id as Batch['id'],
  actor: 'did:plc:alice',
  clock: Number(id),
  timestamp: 1_700_000_000_000,
  ops: [{ kind: 'node.add', target: id as NodeId, content: id }],
});

afterEach(cleanup);

describe('SyncStatusIndicator', () => {
  it('未ログイン (remoteQueue=null) では何も描画しない', () => {
    const { container } = render(<SyncStatusIndicator remoteQueue={null} />);
    expect(container.textContent).toBe('');
  });

  it('未送信 0 件なら「クラウド同期済み」で同期ボタンを出さない', () => {
    const queue = new RemoteSyncQueue({ provider: new FakeProvider() });
    render(<SyncStatusIndicator remoteQueue={queue} />);
    expect(screen.getByText('クラウド同期済み')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('未送信があれば件数を表示する', async () => {
    const queue = new RemoteSyncQueue({ provider: new FakeProvider() });
    render(<SyncStatusIndicator remoteQueue={queue} />);
    // 購読済みなので、後から積まれた分も表示に反映される
    await act(async () => {
      queue.enqueue([batch('1'), batch('2')]);
    });
    expect(screen.getByText('クラウド未同期: 2 件')).toBeTruthy();
  });

  it('上限超過時は「N 件以上」と頭打ちで見せる (D1)', async () => {
    const queue = new RemoteSyncQueue({
      provider: new FakeProvider(),
      capacity: 2,
    });
    render(<SyncStatusIndicator remoteQueue={queue} />);
    await act(async () => {
      queue.enqueue([batch('1'), batch('2'), batch('3')]);
    });
    expect(screen.getByText('クラウド未同期: 2 件以上')).toBeTruthy();
  });

  it('「今すぐ同期」で flush され、成功すると同期済みに戻る', async () => {
    const provider = new FakeProvider();
    const queue = new RemoteSyncQueue({ provider });
    render(<SyncStatusIndicator remoteQueue={queue} />);
    await act(async () => {
      queue.enqueue([batch('1')]);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '今すぐ同期' }));
    });

    expect(provider.pushed.map((b) => b.id)).toEqual(['1']);
    expect(screen.getByText('クラウド同期済み')).toBeTruthy();
  });

  it('flush が失敗しても件数は残り、再送できる', async () => {
    const provider = new FakeProvider();
    provider.online = false;
    const queue = new RemoteSyncQueue({ provider });
    render(<SyncStatusIndicator remoteQueue={queue} />);
    await act(async () => {
      queue.enqueue([batch('1')]);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '今すぐ同期' }));
    });
    expect(screen.getByText('クラウド未同期: 1 件')).toBeTruthy(); // 破棄しない

    provider.online = true; // 復帰
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '今すぐ同期' }));
    });
    expect(screen.getByText('クラウド同期済み')).toBeTruthy();
  });
});
