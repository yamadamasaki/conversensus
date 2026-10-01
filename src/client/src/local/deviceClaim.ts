/**
 * タブごとの deviceId (step3 Phase 2 D4)
 *
 * deviceId は actor (`<did>#<deviceId>`) の後半で、**因果の点 (actor, seq) を発番する単位**である。
 * 同じ origin のタブが同じ deviceId を使うと、2 つのタブが同じ点を発番し、PDS の rkey
 * (点で決まる) で互いを上書きする (設計 F4)。
 *
 * そこで deviceId を「端末に 1 つ」から「**同時に開いているタブに 1 つ**」にする。
 * localStorage に deviceId の溜まり (pool) を持ち、タブは Web Locks で 1 つを借りる。
 *
 * - **同じ id を 2 つのタブが同時に持つことは無い** — lock が排他を保証する
 * - タブを閉じると lock が外れ、次に開いたタブが同じ id を使う。actor の数は「同時に開いた
 *   タブの最大数」で頭打ちになる (vector が伸び続けない)
 * - 溜まりの先頭は従来の deviceId (`conversensus_device_id`) — 1 つ目のタブはこれまでと同じ actor
 *
 * 溜まりへの追記は read-modify-write で、2 つのタブが同時に新しい id を足すと片方が溜まりから
 * 漏れうる。**正しさは失われない** (漏れた id は lock を持つタブだけが使い、閉じれば使われなく
 * なる。actor が 1 つ増えるだけ) ので、溜まりの排他は取らない。
 */

/** deviceId の溜まりの保存キー (localStorage)。JSON の文字列配列 */
export const DEVICE_POOL_STORAGE_KEY = 'conversensus_device_pool';
/** 従来の deviceId の保存キー。溜まりの先頭として引き継ぐ */
export const LEGACY_DEVICE_ID_STORAGE_KEY = 'conversensus_device_id';

/** Web Locks の名前。origin の中で deviceId ごとに 1 つ */
export const deviceLockName = (deviceId: string) =>
  `conversensus-device:${deviceId}`;

/** `navigator.locks` のうち使う部分 */
export type LockManagerLike = {
  request(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown) => Promise<void> | void,
  ): Promise<unknown>;
};

export type DeviceClaimDeps = {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  locks: LockManagerLike;
  newId: () => string;
};

/** 溜まりを読む。従来の deviceId があれば先頭に置く */
function readPool(storage: DeviceClaimDeps['storage']): string[] {
  let pool: string[] = [];
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(DEVICE_POOL_STORAGE_KEY) ?? '[]',
    );
    if (Array.isArray(parsed)) {
      pool = parsed.filter((id): id is string => typeof id === 'string');
    }
  } catch {
    // 壊れていれば作り直す (id が 1 つ増えるだけで、正しさは失われない)
  }
  const legacy = storage.getItem(LEGACY_DEVICE_ID_STORAGE_KEY);
  if (legacy && !pool.includes(legacy)) pool.unshift(legacy);
  return pool;
}

/**
 * lock を取れたら、`release` が呼ばれるまで持ち続ける。取れなければ null
 * (`ifAvailable` なので待たない)
 */
function tryHold(
  locks: LockManagerLike,
  name: string,
): Promise<(() => void) | null> {
  return new Promise((resolveClaim) => {
    void locks.request(name, { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolveClaim(null);
        return;
      }
      // この Promise が解けるまで lock は保持される
      return new Promise<void>((release) => resolveClaim(release));
    });
  });
}

/**
 * 空いている deviceId を 1 つ借りる。全部借りられていれば新しく作って溜まりに足す。
 *
 * @returns 借りた id と、返す関数 (タブを閉じれば自動で返るので、通常は呼ばない)
 */
export async function claimDeviceId(
  deps: DeviceClaimDeps,
): Promise<{ deviceId: string; release: () => void }> {
  const pool = readPool(deps.storage);
  for (const deviceId of pool) {
    const release = await tryHold(deps.locks, deviceLockName(deviceId));
    if (release) {
      deps.storage.setItem(DEVICE_POOL_STORAGE_KEY, JSON.stringify(pool));
      return { deviceId, release };
    }
  }
  const deviceId = deps.newId();
  const release = await tryHold(deps.locks, deviceLockName(deviceId));
  // 新しい id は誰も知らないので必ず取れる。取れないのは lock の実装が壊れているときだけ
  if (!release)
    throw new Error(`新しい deviceId の lock が取れない: ${deviceId}`);
  deps.storage.setItem(
    DEVICE_POOL_STORAGE_KEY,
    JSON.stringify([...readPool(deps.storage), deviceId]),
  );
  return { deviceId, release };
}
