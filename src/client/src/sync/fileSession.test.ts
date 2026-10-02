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

function makeSession(fileId: FileId, repo: FakeRepo) {
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
