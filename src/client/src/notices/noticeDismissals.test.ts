import { describe, expect, mock, test } from 'bun:test';
import type { FileId } from '@conversensus/shared';
import fc from 'fast-check';
import {
  type NoticeDismissalStore,
  NoticeDismissals,
} from './noticeDismissals';
import type { NoticeDismissal } from './types';

const FILE = '11111111-1111-4111-8111-111111111111' as FileId;
const OTHER = '22222222-2222-4222-8222-222222222222' as FileId;
const NOW = new Date('2026-10-04T00:00:00.000Z');

/** PDS を模す保存先。rkey の代わりに (File, 鍵) で 1 件に畳む */
function fakeStore(initial: NoticeDismissal[] = []) {
  const records = new Map<string, NoticeDismissal>();
  for (const d of initial) records.set(`${d.fileId}|${d.key}`, d);
  const listByFile = mock(async (fileId: FileId) =>
    [...records.values()].filter((d) => d.fileId === fileId),
  );
  const put = mock(async (d: NoticeDismissal) => {
    records.set(`${d.fileId}|${d.key}`, d);
  });
  const store: NoticeDismissalStore = { listByFile, put };
  return { store, records, listByFile, put };
}

describe('NoticeDismissals', () => {
  test('保存先にある既読を File ごとに読み、1 度しか読まない', async () => {
    const { store, listByFile } = fakeStore([
      { fileId: FILE, key: 'k1', dismissedAt: NOW.toISOString() },
      { fileId: OTHER, key: 'k2', dismissedAt: NOW.toISOString() },
    ]);
    const d = new NoticeDismissals(store);
    expect([...(await d.dismissedIn(FILE))]).toEqual(['k1']);
    await d.dismissedIn(FILE);
    expect(listByFile).toHaveBeenCalledTimes(1);
  });

  test('閉じた鍵はすぐ既読になり、まだ書いていないものだけを保存先へ書く', async () => {
    const { store, put } = fakeStore([
      { fileId: FILE, key: 'k1', dismissedAt: NOW.toISOString() },
    ]);
    const d = new NoticeDismissals(store, () => NOW);
    await d.dismiss(FILE, ['k1', 'k2', 'k2']);
    expect((await d.dismissedIn(FILE)).has('k2')).toBe(true);
    expect(put.mock.calls.map(([x]) => x)).toEqual([
      { fileId: FILE, key: 'k2', dismissedAt: NOW.toISOString() },
    ]);
  });

  test('別の端末 (新しいインスタンス) が、閉じた通知を既読として読む', async () => {
    const pds = fakeStore();
    await new NoticeDismissals(pds.store).dismiss(FILE, ['k1']);
    const other = new NoticeDismissals(pds.store);
    expect((await other.dismissedIn(FILE)).has('k1')).toBe(true);
  });

  test('保存先が無ければ、この端末の記憶の中だけで動く', async () => {
    const d = new NoticeDismissals(null);
    expect((await d.dismissedIn(FILE)).size).toBe(0);
    await d.dismiss(FILE, ['k1']);
    expect((await d.dismissedIn(FILE)).has('k1')).toBe(true);
  });

  test('読めなければ何も落とさず、次に訊かれたら読み直す', async () => {
    const { store, listByFile } = fakeStore([
      { fileId: FILE, key: 'k1', dismissedAt: NOW.toISOString() },
    ]);
    listByFile.mockImplementationOnce(async () => {
      throw new Error('offline');
    });
    const d = new NoticeDismissals(store);
    expect((await d.dismissedIn(FILE)).size).toBe(0);
    expect((await d.dismissedIn(FILE)).has('k1')).toBe(true);
  });

  test('書けなくても閉じる操作は例外にならず、手元では既読になる', async () => {
    const { store, put } = fakeStore();
    put.mockImplementation(async () => {
      throw new Error('offline');
    });
    const d = new NoticeDismissals(store);
    await d.dismiss(FILE, ['k1']);
    expect((await d.dismissedIn(FILE)).has('k1')).toBe(true);
  });

  test('2 台がそれぞれ閉じた通知は、両方とも既読として残る (足すだけの集合)', async () => {
    const arbKeys = fc.array(fc.constantFrom('a', 'b', 'c', 'd'), {
      maxLength: 4,
    });
    await fc.assert(
      fc.asyncProperty(arbKeys, arbKeys, async (onA, onB) => {
        const pds = fakeStore();
        const deviceA = new NoticeDismissals(pds.store);
        const deviceB = new NoticeDismissals(pds.store);
        // 2 台とも先に読んでから (互いの閉じたものを知らずに) 閉じる
        await Promise.all([
          deviceA.dismissedIn(FILE),
          deviceB.dismissedIn(FILE),
        ]);
        await Promise.all([
          deviceA.dismiss(FILE, onA),
          deviceB.dismiss(FILE, onB),
        ]);
        const later = new NoticeDismissals(pds.store);
        expect([...(await later.dismissedIn(FILE))].sort()).toEqual(
          [...new Set([...onA, ...onB])].sort(),
        );
      }),
    );
  });
});
