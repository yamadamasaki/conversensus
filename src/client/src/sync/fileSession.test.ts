import { afterEach, describe, expect, it } from 'bun:test';
import {
  type Actor,
  type Batch,
  CausalClock,
  type FileId,
  type NodeId,
} from '@conversensus/shared';
import { FanoutSyncProvider } from '../atproto/fanoutSyncProvider';
import {
  type RemoteBatchTarget,
  RemoteSyncQueue,
} from '../atproto/remoteSyncQueue';
import type { RemoteBatch, RemoteFileEntry } from '../atproto/types';
import { FileSession } from './fileSession';
import type { LiveHint, LiveSignal } from './liveChannel';
import type { Cursor, PullResult, SyncProvider } from './syncProvider';

const MY_DID = 'did:plc:alice';
const MY_ACTOR = `${MY_DID}#dev-test` as Actor;
const FILE_A = '00000000-0000-4000-8000-00000000000a' as FileId;
const FILE_B = '00000000-0000-4000-8000-00000000000b' as FileId;
/** テスト中に定期同期が発火しない間隔 */
const NEVER_MS = 60_000;

const batch = (id: string): Batch => ({
  id: id as Batch['id'],
  actor: MY_ACTOR,
  clock: 1,
  seq: 1,
  deps: {},
  timestamp: 1_700_000_000_000,
  ops: [{ kind: 'node.add', target: id as NodeId, content: id }],
});

/** ローカル正典の代役。何も持たない (受信の書き込みは `appendReceived` が受ける) */
class EmptyLocal implements SyncProvider {
  async push(): Promise<void> {}
  async pull(_since: Cursor): Promise<PullResult> {
    return { batches: [], cursor: '' };
  }
}

/** 自分の repo の代役。File ごとに batch を持ち、読まれた File を記録する */
class FakeRepo implements RemoteBatchTarget {
  byFile = new Map<FileId, Batch[]>();
  pulledFor: FileId[] = [];
  async pushRemote(_entries: readonly RemoteBatch[]): Promise<void> {}
  async pullRemoteForFile(fileId: FileId): Promise<RemoteBatch[]> {
    this.pulledFor.push(fileId);
    return (this.byFile.get(fileId) ?? []).map((b) => ({ fileId, batch: b }));
  }
  async listRemoteFiles(): Promise<RemoteFileEntry[]> {
    return [...this.byFile.keys()].map((fileId) => ({
      fileId,
      deleted: false,
    }));
  }
}

const written: Array<{ fileId: FileId; ids: string[] }> = [];
const appendReceived = async (fileId: FileId, batches: Batch[]) => {
  written.push({ fileId, ids: batches.map((b) => b.id as string) });
  return batches.length;
};

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  written.length = 0;
});

function makeSession(
  fileId: FileId,
  repo: FakeRepo,
  extra: { live?: LiveSignal; livePollIntervalMs?: number } = {},
) {
  const remoteQueue = new RemoteSyncQueue({ provider: repo, did: MY_DID });
  return new FileSession({
    fileId,
    provider: new FanoutSyncProvider({
      local: new EmptyLocal(),
      remoteQueue,
      fileId,
    }),
    causal: new CausalClock(MY_ACTOR),
    actor: MY_ACTOR,
    remoteQueue,
    roster: null,
    appendReceived,
    fetchLocal: async () => [],
    pollIntervalMs: NEVER_MS,
    ...extra,
  });
}

/** 非同期の連鎖 (起動時の同期) が落ち着くまで待つ */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('FileSession (step3 Phase 3 S3-0)', () => {
  it('2 つの File のセッションは、それぞれ自分の File だけを同期する', async () => {
    const repo = new FakeRepo();
    repo.byFile.set(FILE_A, [batch('a1')]);
    repo.byFile.set(FILE_B, [batch('b1')]);
    const received: FileId[] = [];
    const a = makeSession(FILE_A, repo);
    const b = makeSession(FILE_B, repo);
    for (const s of [a, b]) {
      s.setListeners({ onReceived: (fileId) => received.push(fileId) });
      stops.push(s.start());
    }
    await flush();

    // 宛先が混ざらない — タブで別々の File を開く前提そのもの
    expect(written).toContainEqual({ fileId: FILE_A, ids: ['a1'] });
    expect(written).toContainEqual({ fileId: FILE_B, ids: ['b1'] });
    expect(written).toHaveLength(2);
    expect(received.sort()).toEqual([FILE_A, FILE_B]);
  });

  it('知らせを差し替えても同期を走らせ直さず、以後は新しい知らせに届く', async () => {
    const repo = new FakeRepo();
    const session = makeSession(FILE_A, repo);
    const oldSynced: FileId[] = [];
    const newSynced: FileId[] = [];
    session.setListeners({ onSynced: (fileId) => oldSynced.push(fileId) });
    stops.push(session.start());
    await flush();
    const pullsAfterOpen = repo.pulledFor.length;

    session.setListeners({ onSynced: (fileId) => newSynced.push(fileId) });
    await flush();
    // フックは毎レンダー差し替える。そのたびに PDS を読み直してはならない
    expect(repo.pulledFor).toHaveLength(pullsAfterOpen);

    await session.syncNow();
    expect(oldSynced).toEqual([FILE_A]);
    expect(newSynced).toEqual([FILE_A]);
  });

  it('止めた後は再接続 (online) でも同期しない', async () => {
    const repo = new FakeRepo();
    const session = makeSession(FILE_A, repo);
    const stop = session.start();
    await flush();
    const pullsAfterOpen = repo.pulledFor.length;

    stop();
    window.dispatchEvent(new Event('online'));
    await flush();
    // タブを閉じたセッションが裏で PDS を読み続けない
    expect(repo.pulledFor).toHaveLength(pullsAfterOpen);
  });
});

/** 流れの代役 (#252)。合図は手で出す */
class ManualLive implements LiveSignal {
  connected = false;
  private listeners = new Set<(hint: LiveHint) => void>();
  isConnected() {
    return this.connected;
  }
  onHint(listener: (hint: LiveHint) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  hint(fileId: FileId | null) {
    for (const listener of this.listeners) listener({ fileId });
  }
}

/** `open` するまで読みを止める repo。開いた後は止めない */
class GatedRepo extends FakeRepo {
  private opened: Promise<void>;
  open: () => void = () => {};
  constructor() {
    super();
    this.opened = new Promise<void>((resolve) => {
      this.open = resolve;
    });
  }
  override async pullRemoteForFile(fileId: FileId): Promise<RemoteBatch[]> {
    await this.opened;
    return super.pullRemoteForFile(fileId);
  }
}

describe('FileSession: 流れの合図 (#252)', () => {
  it('この File への合図で取りに行き、他の File への合図では取りに行かない', async () => {
    const repo = new FakeRepo();
    const live = new ManualLive();
    const session = makeSession(FILE_A, repo, { live });
    stops.push(session.start());
    await flush();
    const pullsAfterOpen = repo.pulledFor.length;

    live.hint(FILE_B);
    await flush();
    expect(repo.pulledFor).toHaveLength(pullsAfterOpen);

    repo.byFile.set(FILE_A, [batch('a1')]);
    live.hint(FILE_A);
    await flush();
    expect(written).toContainEqual({ fileId: FILE_A, ids: ['a1'] });
  });

  it('同期の最中に来た合図は、その後にもう 1 度だけ回す (相乗りすると、読み終えた後の書き込みを落とす)', async () => {
    const repo = new GatedRepo();
    const live = new ManualLive();
    const session = makeSession(FILE_A, repo, { live });
    let cycles = 0;
    session.setListeners({ onSynced: () => cycles++ });
    stops.push(session.start());
    await flush();
    // 開いたときの同期が読みかけで止まっている間に、合図が 2 つ続けて来る
    live.hint(FILE_A);
    live.hint(FILE_A);
    repo.open();
    await new Promise((r) => setTimeout(r, 20));
    // 開いたときの 1 回と、後に回した 1 回。合図の数だけ回さない
    expect(cycles).toBe(2);
  });

  it('繋がっている間は延ばした間隔で、切れたら元の間隔で定期同期する', async () => {
    const repo = new FakeRepo();
    const live = new ManualLive();
    // 元の間隔は鳴らない長さ、延ばした間隔は短くして、どちらが効いているかを見分ける
    const session = makeSession(FILE_A, repo, { live, livePollIntervalMs: 10 });
    stops.push(session.start());
    await flush();
    const pullsAfterOpen = repo.pulledFor.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(repo.pulledFor).toHaveLength(pullsAfterOpen);

    // 繋がった (合図 null)。次の tick を決め直す
    live.connected = true;
    live.hint(null);
    await new Promise((r) => setTimeout(r, 60));
    const pullsWhileConnected = repo.pulledFor.length;
    expect(pullsWhileConnected).toBeGreaterThan(pullsAfterOpen + 1);

    // 切れた。元の (鳴らない) 間隔に戻る
    live.connected = false;
    live.hint(null);
    await new Promise((r) => setTimeout(r, 20));
    const pullsAfterDrop = repo.pulledFor.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(repo.pulledFor).toHaveLength(pullsAfterDrop);
  });

  it('止めた後は合図でも取りに行かない', async () => {
    const repo = new FakeRepo();
    const live = new ManualLive();
    const session = makeSession(FILE_A, repo, { live });
    const stop = session.start();
    await flush();
    const pullsAfterOpen = repo.pulledFor.length;
    stop();
    live.hint(FILE_A);
    await flush();
    expect(repo.pulledFor).toHaveLength(pullsAfterOpen);
  });
});
