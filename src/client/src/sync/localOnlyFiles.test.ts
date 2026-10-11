import { describe, expect, mock, test } from 'bun:test';
import type { FileId } from '@conversensus/shared';
import {
  declineLocalOnly,
  inheritLocalOnly,
  isLocalOnlyFile,
  LOCAL_ONLY_FILES_KEY,
  markLocalOnly,
  readLocalOnlyFiles,
  releaseLocalOnly,
  subscribeLocalOnlyFiles,
} from './localOnlyFiles';

const F1 = '11111111-1111-4111-8111-111111111111' as FileId;
const F2 = '22222222-2222-4222-8222-222222222222' as FileId;
const BRANCH = '33333333-3333-4333-8333-333333333333' as FileId;

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

describe('localOnlyFiles (#253)', () => {
  test('印を付けた File だけが「この端末だけ」になる', () => {
    const storage = memoryStorage();
    markLocalOnly(F1, { state: 'pending' }, storage);
    expect(isLocalOnlyFile(F1, storage)).toBe(true);
    expect(isLocalOnlyFile(F2, storage)).toBe(false);
  });

  test('branch は元の File の印を写し、元の File を覚える。印の無い File の branch には付けない', () => {
    const storage = memoryStorage();
    markLocalOnly(F1, { state: 'declined' }, storage);
    inheritLocalOnly(BRANCH, F1, storage);
    inheritLocalOnly(F2, F2, storage);
    expect(readLocalOnlyFiles(storage).get(BRANCH)).toEqual({
      state: 'declined',
      trunk: F1,
    });
    expect(isLocalOnlyFile(F2, storage)).toBe(false);
  });

  test('断ったら、印の無い File にも付け、branch も declined にする', () => {
    const storage = memoryStorage();
    markLocalOnly(F1, { state: 'pending' }, storage);
    markLocalOnly(BRANCH, { state: 'pending', trunk: F1 }, storage);
    declineLocalOnly([F1, F2], storage);
    const files = readLocalOnlyFiles(storage);
    expect(files.get(F1)?.state).toBe('declined');
    expect(files.get(F2)?.state).toBe('declined');
    expect(files.get(BRANCH)).toEqual({ state: 'declined', trunk: F1 });
  });

  test('外すときは branch ごと外し、外した id を返す', () => {
    const storage = memoryStorage();
    markLocalOnly(F1, { state: 'declined' }, storage);
    markLocalOnly(BRANCH, { state: 'declined', trunk: F1 }, storage);
    markLocalOnly(F2, { state: 'declined' }, storage);
    expect(new Set(releaseLocalOnly(F1, storage))).toEqual(
      new Set([F1, BRANCH]),
    );
    expect([...readLocalOnlyFiles(storage).keys()]).toEqual([F2]);
    expect(releaseLocalOnly(F1, storage)).toEqual([]);
  });

  test('壊れた値・保存領域が無いときは印が無いものとする', () => {
    const storage = memoryStorage();
    storage.setItem(LOCAL_ONLY_FILES_KEY, '{壊れている');
    expect(readLocalOnlyFiles(storage).size).toBe(0);
    expect(readLocalOnlyFiles(null).size).toBe(0);
  });

  test('印が変わると、同じタブの聞き手に知らせる', () => {
    const listener = mock(() => {});
    const unsubscribe = subscribeLocalOnlyFiles(listener);
    markLocalOnly(F1, { state: 'pending' }, memoryStorage());
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    markLocalOnly(F1, { state: 'pending' }, memoryStorage());
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
