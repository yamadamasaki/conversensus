import { afterEach, describe, expect, it } from 'bun:test';
import type { Batch, FileId, NodeId } from '@conversensus/shared';

/** この端末の DID (既定の `batch()` の著者) */
const MY_DID = 'did:plc:alice';
/** enqueue に添える fileId。remote レコードに埋まるので省略できない */
const FILE = 'file-1' as FileId;
const { render, screen, fireEvent, act, cleanup } = await import(
  '@testing-library/react'
);
const { SyncStatusIndicator } = await import('./SyncStatusIndicator');

import type { RemoteBatchTarget } from './atproto/remoteSyncQueue';
import type { RemoteBatch, RemoteFileEntry } from './atproto/types';

const { RemoteSyncQueue } = await import('./atproto/remoteSyncQueue');
type SyncProvider = import('./sync/syncProvider').SyncProvider;
type Cursor = import('./sync/syncProvider').Cursor;
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
  /** ファイル単位の取得 (Phase 7 p7-2)。この画面のテストでは remote は空でよい */
  async pullRemoteForFile(): Promise<RemoteBatch[]> {
    return [];
  }
  /** ファイル列挙 (Phase 7 p7-3 / ANA-127 S3) */
  async listRemoteFiles(): Promise<RemoteFileEntry[]> {
    return [];
  }
}

const batch = (id: string): Batch => ({
  id: id as Batch['id'],
  actor: MY_DID,
  clock: Number(id),
  seq: Number(id),
  deps: {},
  timestamp: 1_700_000_000_000,
  ops: [{ kind: 'node.add', target: id as NodeId, content: id }],
});

/** `syncNow` (送信 catch-up + 受信) のスタブ。呼ばれた回数を数える */
function fakeSyncNow() {
  const calls = { count: 0 };
  return {
    calls,
    fn: async () => {
      calls.count += 1;
    },
  };
}

afterEach(cleanup);

describe('SyncStatusIndicator', () => {
  it('未ログイン (remoteQueue=null) では「この端末にだけ保存」と出し、同期ボタンは出さない', () => {
    // PWA の保存領域はブラウザが消すことがある。どこにも送られていないことを見えるようにする
    // (step3 Phase 2 D6)。remote 経路が無いので「今すぐ同期」は意味を持たない
    const { container } = render(
      <SyncStatusIndicator remoteQueue={null} onSyncNow={fakeSyncNow().fn} />,
    );
    expect(container.textContent).toContain('この端末にだけ保存されています');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('未送信 0 件でも「今すぐ同期」を出す (#202)', () => {
    // **送るものが無くても押せる必要がある。** 受信 (他所の変更を取りに行く) は
    // ここにしか口が無く、送信は普通は即成功するので、
    // 「未送信があるときだけ出す」だと正常なほどボタンに出会わない
    const queue = new RemoteSyncQueue({
      provider: new FakeProvider(),
      did: MY_DID,
    });
    render(
      <SyncStatusIndicator remoteQueue={queue} onSyncNow={fakeSyncNow().fn} />,
    );
    expect(screen.getByText('アカウントに保存済み')).toBeTruthy();
    expect(screen.getByRole('button', { name: '今すぐ同期' })).toBeTruthy();
  });

  it('未送信が無くても押せば受信が走る (#202)', async () => {
    const queue = new RemoteSyncQueue({
      provider: new FakeProvider(),
      did: MY_DID,
    });
    const sync = fakeSyncNow();
    render(<SyncStatusIndicator remoteQueue={queue} onSyncNow={sync.fn} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '今すぐ同期' }));
    });

    expect(sync.calls.count).toBe(1);
  });

  it('送信が失敗しても受信は試す', async () => {
    // 落ちている理由が別かもしれない。送信の失敗で受信まで止めない
    const provider = new FakeProvider();
    provider.online = false;
    const queue = new RemoteSyncQueue({ provider, did: MY_DID });
    const sync = fakeSyncNow();
    render(<SyncStatusIndicator remoteQueue={queue} onSyncNow={sync.fn} />);
    await act(async () => {
      queue.enqueue([batch('1')], FILE);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '今すぐ同期' }));
    });

    expect(sync.calls.count).toBe(1);
  });

  it('未送信があれば件数を表示する', async () => {
    const queue = new RemoteSyncQueue({
      provider: new FakeProvider(),
      did: MY_DID,
    });
    render(
      <SyncStatusIndicator remoteQueue={queue} onSyncNow={fakeSyncNow().fn} />,
    );
    // 購読済みなので、後から積まれた分も表示に反映される
    await act(async () => {
      queue.enqueue([batch('1'), batch('2')], FILE);
    });
    expect(screen.getByText('未保存の変更 2 件')).toBeTruthy();
  });

  it('上限超過時は「N 件以上」と頭打ちで見せる (D1)', async () => {
    const queue = new RemoteSyncQueue({
      provider: new FakeProvider(),
      did: MY_DID,
      capacity: 2,
    });
    render(
      <SyncStatusIndicator remoteQueue={queue} onSyncNow={fakeSyncNow().fn} />,
    );
    await act(async () => {
      queue.enqueue([batch('1'), batch('2'), batch('3')], FILE);
    });
    expect(screen.getByText('未保存の変更 2 件以上')).toBeTruthy();
  });

  it('「今すぐ同期」で flush され、成功すると同期済みに戻る', async () => {
    const provider = new FakeProvider();
    const queue = new RemoteSyncQueue({ provider, did: MY_DID });
    const sync = fakeSyncNow();
    render(<SyncStatusIndicator remoteQueue={queue} onSyncNow={sync.fn} />);
    await act(async () => {
      queue.enqueue([batch('1')], FILE);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '今すぐ同期' }));
    });

    expect(provider.pushed.map((b) => b.id as string)).toEqual(['1']);
    expect(sync.calls.count).toBe(1); // 送信と受信の両方を行う
    expect(screen.getByText('アカウントに保存済み')).toBeTruthy();
  });

  it('flush が失敗しても件数は残り、再送できる', async () => {
    const provider = new FakeProvider();
    provider.online = false;
    const queue = new RemoteSyncQueue({ provider, did: MY_DID });
    render(
      <SyncStatusIndicator remoteQueue={queue} onSyncNow={fakeSyncNow().fn} />,
    );
    await act(async () => {
      queue.enqueue([batch('1')], FILE);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '今すぐ同期' }));
    });
    expect(screen.getByText('未保存の変更 1 件')).toBeTruthy(); // 破棄しない

    provider.online = true; // 復帰
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '今すぐ同期' }));
    });
    expect(screen.getByText('アカウントに保存済み')).toBeTruthy();
  });
});
