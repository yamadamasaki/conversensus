import { afterEach, describe, expect, test } from 'bun:test';
import {
  type PersistenceApi,
  persistenceState,
  requestPersistence,
  resetPersistenceStateForTest,
} from './storagePersistence';

afterEach(resetPersistenceStateForTest);

/** persisted / persist の答えを決めた口。persist が呼ばれたかを残す */
function fakeApi(persisted: boolean, persist: boolean) {
  const calls = { persist: 0 };
  const api: PersistenceApi = {
    persisted: async () => persisted,
    persist: async () => {
      calls.persist += 1;
      return persist;
    },
  };
  return { api, calls };
}

describe('requestPersistence (#263)', () => {
  test('訊く前は unknown (知らせない)', () => {
    expect(persistenceState()).toBe('unknown');
  });

  test('認められれば persisted', async () => {
    const { api } = fakeApi(false, true);
    expect(await requestPersistence(api)).toBe('persisted');
    expect(persistenceState()).toBe('persisted');
  });

  test('既に認められていれば訊き直さない', async () => {
    const { api, calls } = fakeApi(true, false);
    expect(await requestPersistence(api)).toBe('persisted');
    expect(calls.persist).toBe(0);
  });

  test('断られれば notPersisted', async () => {
    const { api } = fakeApi(false, false);
    expect(await requestPersistence(api)).toBe('notPersisted');
    expect(persistenceState()).toBe('notPersisted');
  });

  test('口が無い (古いブラウザ) なら notPersisted', async () => {
    expect(await requestPersistence(undefined)).toBe('notPersisted');
  });

  test('投げたら notPersisted', async () => {
    const api: PersistenceApi = {
      persisted: async () => {
        throw new Error('SecurityError');
      },
      persist: async () => true,
    };
    expect(await requestPersistence(api)).toBe('notPersisted');
  });
});
