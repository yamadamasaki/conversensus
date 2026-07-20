import { describe, expect, it } from 'bun:test';
import {
  ACTOR_SEPARATOR,
  composeActor,
  DEVICE_ID_STORAGE_KEY,
  getDeviceId,
  LOCAL_DID,
} from './actor';

/** localStorage 相当の最小実装 (テスト間で状態を分離するため毎回新規に作る) */
const fakeStorage = (initial: Record<string, string> = {}): Storage => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
};

describe('getDeviceId', () => {
  it('初回は生成して保存する', () => {
    const store = fakeStorage();
    const id = getDeviceId(store);
    expect(id).toBeTruthy();
    expect(store.getItem(DEVICE_ID_STORAGE_KEY)).toBe(id);
  });

  it('二度目以降は保存済みの値を返す (起動をまたいで安定)', () => {
    const store = fakeStorage();
    const first = getDeviceId(store);
    expect(getDeviceId(store)).toBe(first);
  });

  it('保存済みの値があればそれを尊重する (再生成しない)', () => {
    const store = fakeStorage({ [DEVICE_ID_STORAGE_KEY]: 'existing-device' });
    expect(getDeviceId(store)).toBe('existing-device');
  });

  it('別の端末 (別ストレージ) では別の id になる', () => {
    expect(getDeviceId(fakeStorage())).not.toBe(getDeviceId(fakeStorage()));
  });
});

describe('composeActor', () => {
  it('ログイン中は <did>#<deviceId> になる', () => {
    expect(composeActor('did:plc:alice', 'dev-1')).toBe(
      `did:plc:alice${ACTOR_SEPARATOR}dev-1`,
    );
  });

  it('未ログイン (did=null) は local#<deviceId> になる', () => {
    expect(composeActor(null, 'dev-1')).toBe(
      `${LOCAL_DID}${ACTOR_SEPARATOR}dev-1`,
    );
  });

  it('同じユーザーでも端末が違えば別 actor になる (4d-2 の要点)', () => {
    // W3d5-7 では A・B とも actor='local' で、両端末の batch が clock=3 を名乗った。
    // 端末まで一意にすることで受信時に因果と重複排除の単位を識別できる
    expect(composeActor('did:plc:alice', 'dev-A')).not.toBe(
      composeActor('did:plc:alice', 'dev-B'),
    );
  });

  it('同じ端末でもユーザーが違えば別 actor になる', () => {
    expect(composeActor('did:plc:alice', 'dev-1')).not.toBe(
      composeActor('did:plc:bob', 'dev-1'),
    );
  });

  it('同じ端末・同じユーザーなら安定している', () => {
    expect(composeActor('did:plc:alice', 'dev-1')).toBe(
      composeActor('did:plc:alice', 'dev-1'),
    );
  });
});
