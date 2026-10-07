import { describe, expect, it } from 'bun:test';
import { deviceLockName } from './deviceClaim';
import {
  ERASE_REQUEST_KEY,
  type EraseDeps,
  eraseIfRequested,
  otherTabsOpen,
  requestErase,
} from './eraseDevice';

/** 手元の保存領域のフェイク。消されたものを記録する */
function world(options: {
  requested?: boolean;
  tabs?: number;
  locks?: boolean;
  opfs?: string[];
  databases?: string[];
  busyOnce?: string;
}) {
  const session = new Map<string, string>();
  if (options.requested) requestErase({ setItem: (k, v) => session.set(k, v) });
  const opfs = new Set(options.opfs ?? []);
  const databases = new Set(options.databases ?? []);
  let busy = options.busyOnce;
  let localCleared = false;
  const deps: EraseDeps = {
    session: {
      getItem: (k) => session.get(k) ?? null,
      setItem: (k, v) => session.set(k, v),
      removeItem: (k) => session.delete(k),
    },
    local: { clear: () => (localCleared = true) },
    queryLocks:
      options.locks === false
        ? undefined
        : async () => ({
            held: Array.from({ length: options.tabs ?? 0 }, (_, i) => ({
              name: deviceLockName(`dev-${i}`),
            })).concat({ name: 'other-lock' }),
          }),
    opfsRoot: async () => ({
      async *keys() {
        yield* [...opfs];
      },
      removeEntry: async (name) => {
        // 閉じたばかりのハンドルが 1 度だけ邪魔をする
        if (busy === name) {
          busy = undefined;
          throw new Error('NoModificationAllowedError');
        }
        opfs.delete(name);
      },
    }),
    listDatabases: async () => [...databases],
    deleteDatabase: async (name) => void databases.delete(name),
    sleep: async () => {},
  };
  return {
    deps,
    opfs,
    databases,
    session,
    localCleared: () => localCleared,
  };
}

describe('eraseIfRequested (#288)', () => {
  it('印が無ければ何もしない', async () => {
    const w = world({ opfs: ['db.sqlite3'], databases: ['oauth'] });
    expect(await eraseIfRequested(w.deps)).toBe('none');
    expect(w.opfs.size).toBe(1);
    expect(w.databases.size).toBe(1);
    expect(w.localCleared()).toBe(false);
  });

  it('印があり別のタブが無ければ、OPFS・IndexedDB・localStorage を消し、印も外す', async () => {
    const w = world({
      requested: true,
      opfs: ['db.sqlite3', '.opfs-sahpool'],
      databases: ['oauth', 'other'],
    });
    expect(await eraseIfRequested(w.deps)).toBe('erased');
    expect(w.opfs.size).toBe(0);
    expect(w.databases.size).toBe(0);
    expect(w.localCleared()).toBe(true);
    expect(w.session.has(ERASE_REQUEST_KEY)).toBe(false);
  });

  it('別のタブが開いていれば消さない。印は外す (起動のたびに消し直さない)', async () => {
    const w = world({ requested: true, tabs: 1, opfs: ['db.sqlite3'] });
    expect(await eraseIfRequested(w.deps)).toBe('otherTabs');
    expect(w.opfs.size).toBe(1);
    expect(w.localCleared()).toBe(false);
    expect(w.session.has(ERASE_REQUEST_KEY)).toBe(false);
  });

  it('閉じたばかりのハンドルに阻まれたら、待ち直して消す', async () => {
    const w = world({
      requested: true,
      opfs: ['db.sqlite3'],
      busyOnce: 'db.sqlite3',
    });
    expect(await eraseIfRequested(w.deps)).toBe('erased');
    expect(w.opfs.size).toBe(0);
  });
});

describe('otherTabsOpen', () => {
  it('自分の lock を持っていれば、2 つ目からが別のタブ', async () => {
    expect(await otherTabsOpen(world({ tabs: 1 }).deps.queryLocks, true)).toBe(
      false,
    );
    expect(await otherTabsOpen(world({ tabs: 2 }).deps.queryLocks, true)).toBe(
      true,
    );
  });

  it('起動の最初 (自分はまだ持っていない) は 1 つでもあれば別のタブ', async () => {
    expect(await otherTabsOpen(world({ tabs: 0 }).deps.queryLocks, false)).toBe(
      false,
    );
    expect(await otherTabsOpen(world({ tabs: 1 }).deps.queryLocks, false)).toBe(
      true,
    );
  });

  it('deviceId 以外の lock は数えない', async () => {
    // world は常に 'other-lock' を 1 つ混ぜている
    expect(await otherTabsOpen(world({ tabs: 0 }).deps.queryLocks, false)).toBe(
      false,
    );
  });

  it('Web Locks が無ければ、数えられないので開いているとみなす (消さない)', async () => {
    expect(await otherTabsOpen(undefined, false)).toBe(true);
  });
});
