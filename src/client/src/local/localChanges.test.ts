import { describe, expect, mock, test } from 'bun:test';
import type { Batch, FileId, GraphFile } from '@conversensus/shared';
import type { LocalBackend } from './backend';
import {
  broadcastingBackend,
  type ChannelLike,
  type LocalChange,
  subscribeCanonChanges,
  subscribeLocalChanges,
  subscribeOwnChanges,
} from './localChanges';

const FILE = 'f1' as FileId;

/** 1 つの channel 名を共有するタブたち。BroadcastChannel と同じく送り手自身には届かない */
function bus() {
  const members = new Set<{ deliver: (m: LocalChange) => void }>();
  return () => {
    const listeners = new Set<(event: { data: LocalChange }) => void>();
    const self = {
      deliver: (m: LocalChange) => {
        for (const l of listeners) l({ data: m });
      },
    };
    members.add(self);
    const channel: ChannelLike = {
      postMessage: (m) => {
        for (const other of members) if (other !== self) other.deliver(m);
      },
      addEventListener: (_t, l) => void listeners.add(l),
      removeEventListener: (_t, l) => void listeners.delete(l),
    };
    return channel;
  };
}

function backendAppending(appended: number): LocalBackend {
  return {
    pushBatches: async () => appended,
    pushReceivedBatches: async () => appended,
    createFile: async () => ({ id: FILE }) as GraphFile,
    postImportFile: async () => ({ id: FILE }) as GraphFile,
  } as unknown as LocalBackend;
}

describe('broadcastingBackend / subscribeLocalChanges', () => {
  test('🔴 あるタブの追記が、他のタブに届き、自分には届かない', async () => {
    const tab = bus();
    const [a, b] = [tab(), tab()];
    const seenByA = mock((_: LocalChange) => {});
    const seenByB = mock((_: LocalChange) => {});
    subscribeLocalChanges(seenByA, a);
    subscribeLocalChanges(seenByB, b);

    await broadcastingBackend(backendAppending(1), a).pushBatches(
      FILE,
      [] as Batch[],
    );

    expect(seenByB).toHaveBeenCalledWith({ fileId: FILE });
    expect(seenByA).not.toHaveBeenCalled();
  });

  test('何も追記されなければ知らせない (既知の batch の再送)', async () => {
    const tab = bus();
    const [a, b] = [tab(), tab()];
    const seen = mock((_: LocalChange) => {});
    subscribeLocalChanges(seen, b);
    await broadcastingBackend(backendAppending(0), a).pushReceivedBatches(
      FILE,
      [],
    );
    expect(seen).not.toHaveBeenCalled();
  });

  test('File の作成も知らせる (他のタブの一覧に出すため)', async () => {
    const tab = bus();
    const [a, b] = [tab(), tab()];
    const seen = mock((_: LocalChange) => {});
    subscribeLocalChanges(seen, b);
    await broadcastingBackend(backendAppending(0), a).createFile('x');
    expect(seen).toHaveBeenCalledWith({ fileId: FILE });
  });

  test('購読をやめたら届かない', async () => {
    const tab = bus();
    const [a, b] = [tab(), tab()];
    const seen = mock((_: LocalChange) => {});
    const stop = subscribeLocalChanges(seen, b);
    stop();
    await broadcastingBackend(backendAppending(1), a).pushBatches(FILE, []);
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('このタブの中の知らせ (step3 Phase 3 S3-5)', () => {
  const NONE: Batch[] = [];

  test('このタブの追記は、このタブの受け手に届く (BroadcastChannel は送り手自身に届かない)', async () => {
    const seen: FileId[] = [];
    const stop = subscribeOwnChanges(({ fileId }) => seen.push(fileId));
    const backend = broadcastingBackend(backendAppending(1), null);
    await backend.pushBatches(FILE, NONE);
    stop();
    await backend.pushBatches(FILE, NONE);
    expect(seen).toEqual([FILE]);
  });

  test('何も追記されなければ、このタブの中にも知らせない', async () => {
    const seen: FileId[] = [];
    const stop = subscribeOwnChanges(({ fileId }) => seen.push(fileId));
    await broadcastingBackend(backendAppending(0), null).pushBatches(
      FILE,
      NONE,
    );
    stop();
    expect(seen).toEqual([]);
  });

  test('正典の知らせは、このタブの書き込みと別のタブの書き込みの両方を受ける', async () => {
    const join = bus();
    const other = join();
    const mine = join();
    const seen: string[] = [];
    const stop = subscribeCanonChanges(() => seen.push('changed'), mine);
    // 別のタブの書き込み: channel 経由で mine に届く (このタブの受け手にも、同じプロセスなので届く)
    await broadcastingBackend(backendAppending(1), other).pushBatches(
      FILE,
      NONE,
    );
    const afterOther = seen.length;
    // このタブの書き込み: channel は送り手自身に届かないので、このタブの中の知らせだけで届く
    await broadcastingBackend(backendAppending(1), mine).pushBatches(
      FILE,
      NONE,
    );
    stop();
    expect(afterOther).toBeGreaterThan(0);
    expect(seen.length).toBe(afterOther + 1);
  });
});
