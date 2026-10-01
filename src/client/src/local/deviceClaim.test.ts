import { describe, expect, test } from 'bun:test';
import {
  claimDeviceId,
  DEVICE_POOL_STORAGE_KEY,
  type DeviceClaimDeps,
  LEGACY_DEVICE_ID_STORAGE_KEY,
  type LockManagerLike,
} from './deviceClaim';

/** Web Locks の偽物。`ifAvailable` の排他と、callback の Promise が解けるまでの保持だけを持つ */
function fakeLocks(): LockManagerLike {
  const held = new Set<string>();
  return {
    async request(name, _options, callback) {
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
  };
}

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    map,
  };
}

/** 端末 1 つ = localStorage と Web Locks を共有するタブの集まり */
function device(initial: Record<string, string> = {}) {
  const storage = fakeStorage(initial);
  const locks = fakeLocks();
  let n = 0;
  const deps = (): DeviceClaimDeps => ({
    storage,
    locks,
    newId: () => `new-${++n}`,
  });
  return { storage, open: () => claimDeviceId(deps()) };
}

const poolOf = (storage: ReturnType<typeof fakeStorage>) =>
  JSON.parse(storage.map.get(DEVICE_POOL_STORAGE_KEY) ?? '[]');

describe('claimDeviceId', () => {
  test('1 つ目のタブは従来の deviceId を引き継ぐ (これまでと同じ actor)', async () => {
    const d = device({ [LEGACY_DEVICE_ID_STORAGE_KEY]: 'legacy' });
    expect((await d.open()).deviceId).toBe('legacy');
  });

  test('🔴 同時に開いたタブは別々の deviceId を持つ', async () => {
    // 同じ id を 2 つのタブが持つと、同じ点 (actor, seq) を発番して PDS で上書きし合う (F4)
    const d = device({ [LEGACY_DEVICE_ID_STORAGE_KEY]: 'legacy' });
    const first = await d.open();
    const second = await d.open();
    const third = await d.open();
    expect(
      new Set([first.deviceId, second.deviceId, third.deviceId]).size,
    ).toBe(3);
    expect(poolOf(d.storage)).toEqual(['legacy', 'new-1', 'new-2']);
  });

  test('🔴 閉じたタブの id は次のタブが使い、溜まりは増えない', async () => {
    // actor の数を「同時に開いたタブの最大数」で頭打ちにする
    const d = device();
    const first = await d.open();
    const second = await d.open();
    second.release();
    const reopened = await d.open();
    expect(reopened.deviceId).toBe(second.deviceId);
    expect(poolOf(d.storage)).toEqual([first.deviceId, second.deviceId]);
  });

  test('何も無ければ新しく作って溜まりに入れる', async () => {
    const d = device();
    const first = await d.open();
    expect(first.deviceId).toBe('new-1');
    expect(poolOf(d.storage)).toEqual(['new-1']);
  });

  test('溜まりが壊れていても作り直して開ける', async () => {
    const d = device({ [DEVICE_POOL_STORAGE_KEY]: '{oops' });
    expect((await d.open()).deviceId).toBe('new-1');
  });
});
