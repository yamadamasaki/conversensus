import { describe, expect, test } from 'bun:test';
import type {
  BatchId,
  Did,
  FileId,
  MergeConflict,
  NodeId,
} from '@conversensus/shared';
import {
  type CachedNotices,
  loadNotices,
  noticeCacheKey,
  saveNotices,
} from './noticeCache';

const FILE = '11111111-1111-4111-8111-111111111111' as FileId;
const ALICE = 'did:plc:alice' as Did;
const BOB = 'did:plc:bob' as Did;
const NODE = '33333333-3333-4333-8333-333333333333' as NodeId;
const B1 = '44444444-4444-4444-8444-444444444444' as BatchId;
const B2 = '55555555-5555-4555-8555-555555555555' as BatchId;

/** テスト用の Storage (localStorage と同じ口) */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

const conflict: MergeConflict = {
  target: NODE,
  category: 'content',
  ours: {
    batchId: B1,
    op: { kind: 'node.setContent', target: NODE, content: 'A' },
  },
  theirs: {
    batchId: B2,
    op: { kind: 'node.setContent', target: NODE, content: 'B' },
  },
};

const notices: CachedNotices = {
  conflicts: {
    fileId: FILE,
    conflicts: [conflict],
    labels: [[NODE, '要件A']],
    forkCount: 1,
  },
  overwrites: {
    reports: [
      {
        target: NODE,
        category: 'content',
        by: BOB,
        mine: B1,
        theirs: B2,
      },
    ],
    labels: [[NODE, '要件A']],
    files: [['k', FILE]],
  },
};

const EMPTY: CachedNotices = {
  conflicts: { conflicts: [], labels: [] },
  overwrites: { reports: [], labels: [], files: [] },
};

describe('noticeCache', () => {
  test('控えて読むと元に戻る (再読み込みしても閉じていない通知が残る)', () => {
    const storage = memoryStorage();
    saveNotices(storage, ALICE, notices);
    expect(loadNotices(storage, ALICE)).toEqual(notices);
  });

  test('actor ごとに分かれる。別の人の控えは読まない', () => {
    const storage = memoryStorage();
    saveNotices(storage, ALICE, notices);
    expect(loadNotices(storage, BOB)).toBeNull();
    expect(noticeCacheKey(null)).not.toBe(noticeCacheKey(ALICE));
  });

  test('通知が空になったら控えを消す', () => {
    const storage = memoryStorage();
    saveNotices(storage, ALICE, notices);
    saveNotices(storage, ALICE, EMPTY);
    expect(storage.length).toBe(0);
  });

  test('壊れた控えは null (通知が出ないだけ)', () => {
    const storage = memoryStorage();
    storage.setItem(noticeCacheKey(ALICE), '{not json');
    expect(loadNotices(storage, ALICE)).toBeNull();
    storage.setItem(noticeCacheKey(ALICE), JSON.stringify({ conflicts: {} }));
    expect(loadNotices(storage, ALICE)).toBeNull();
  });

  test('localStorage が使えなければ何もしない', () => {
    saveNotices(null, ALICE, notices);
    expect(loadNotices(null, ALICE)).toBeNull();
  });
});
