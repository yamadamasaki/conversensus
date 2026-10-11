import { describe, expect, mock, test } from 'bun:test';
import type { Actor, Did, FileId } from '@conversensus/shared';
import {
  type AdoptLocalActorsDeps,
  adoptLocalActors,
  type LocalActorBatches,
} from './adoptLocalActors';
import {
  declineLocalOnly,
  type LocalOnlyEntry,
  markLocalOnly,
  readLocalOnlyFiles,
  releaseLocalOnly,
} from './localOnlyFiles';

/** 印を置く保存領域。テストごとに新しく作る */
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

const DID = 'did:plc:alice' as Did;
const F1 = '11111111-1111-4111-8111-111111111111' as FileId;
const F2 = '22222222-2222-4222-8222-222222222222' as FileId;

function depsOf(
  rows: LocalActorBatches[],
  answer = true,
  marks: [FileId, LocalOnlyEntry][] = [],
) {
  let n = 0;
  const storage = memoryStorage();
  for (const [id, entry] of marks) markLocalOnly(id, entry, storage);
  const renameActor = mock(async (_from: Actor, _to: Actor) => 1);
  const catchUp = mock(async (_fileId: FileId) => {});
  const confirm = mock(async (_summary: unknown) => answer);
  const deps: AdoptLocalActorsDeps = {
    listLocalActorBatches: async () => rows,
    renameActor,
    newDeviceId: () => `new-${++n}`,
    confirm,
    catchUp,
    localOnly: () => readLocalOnlyFiles(storage),
    release: (fileId) => releaseLocalOnly(fileId, storage),
    decline: (fileIds) => declineLocalOnly(fileIds, storage),
  };
  return {
    deps,
    renameActor,
    catchUp,
    confirm,
    marks: () => readLocalOnlyFiles(storage),
  };
}

describe('adoptLocalActors', () => {
  test('未ログインの batch が無ければ訊かずに何もしない', async () => {
    const { deps, confirm } = depsOf([]);
    expect(await adoptLocalActors(DID, deps)).toEqual({ status: 'none' });
    expect(confirm).not.toHaveBeenCalled();
  });

  test('件数と File と最後の編集の時刻を見せて訊き、断られたら何も書き換えず、File ごと手元に留める', async () => {
    const { deps, confirm, renameActor, catchUp, marks } = depsOf(
      [
        { fileId: F1, actor: 'local#a', count: 2, lastTimestamp: 200 },
        { fileId: F2, actor: 'local#a', count: 1, lastTimestamp: 300 },
      ],
      false,
    );
    expect(await adoptLocalActors(DID, deps)).toEqual({
      status: 'declined',
      batches: 3,
    });
    expect(confirm).toHaveBeenCalledWith({
      batches: 3,
      fileIds: [F1, F2],
      lastEditedAt: 300, // File をまたいだ最後 (#288)
    });
    expect(renameActor).not.toHaveBeenCalled();
    expect(catchUp).not.toHaveBeenCalled();
    // 「この端末に残す」= genesis も以後の編集も送らない印 (#253)
    expect(marks().get(F1)?.state).toBe('declined');
    expect(marks().get(F2)?.state).toBe('declined');
  });

  test('承けたら local の actor ごとに新しい自分の actor へ付け替え、関わった File ごとに送る', async () => {
    const { deps, renameActor, catchUp } = depsOf([
      { fileId: F1, actor: 'local#a', count: 2, lastTimestamp: 0 },
      { fileId: F1, actor: 'local#b', count: 1, lastTimestamp: 0 },
      { fileId: F2, actor: 'local#a', count: 1, lastTimestamp: 0 },
    ]);
    expect(await adoptLocalActors(DID, deps)).toEqual({
      status: 'adopted',
      batches: 4,
      fileIds: [F1, F2],
    });
    expect(renameActor.mock.calls).toEqual([
      ['local#a', 'did:plc:alice#new-1'],
      ['local#b', 'did:plc:alice#new-2'],
    ]);
    expect(catchUp.mock.calls).toEqual([[F1], [F2]]);
  });

  test('送れなくても付け替えは済ませ、例外にしない (次の同期が送る)', async () => {
    const { deps, catchUp } = depsOf([
      { fileId: F1, actor: 'local#a', count: 1, lastTimestamp: 0 },
    ]);
    catchUp.mockImplementation(async () => {
      throw new Error('offline');
    });
    expect((await adoptLocalActors(DID, deps)).status).toBe('adopted');
  });
});

describe('adoptLocalActors: この端末だけの File (#253)', () => {
  const BRANCH = '33333333-3333-4333-8333-333333333333' as FileId;

  test('前に「この端末に残す」と答えた File は訊き直さない', async () => {
    const { deps, confirm } = depsOf(
      [{ fileId: F1, actor: 'local#a', count: 2, lastTimestamp: 0 }],
      true,
      [[F1, { state: 'declined' }]],
    );
    expect(await adoptLocalActors(DID, deps)).toEqual({ status: 'none' });
    expect(confirm).not.toHaveBeenCalled();
  });

  test('未ログインで作っただけの File (編集が無い) も訊き、承けたら印を外して送る', async () => {
    // 作っただけでも genesis (名前・最初の Sheet) がある。訊かずに送ると #253 の漏れになる
    const { deps, confirm, catchUp, marks } = depsOf([], true, [
      [F1, { state: 'pending' }],
    ]);
    expect(await adoptLocalActors(DID, deps)).toEqual({
      status: 'adopted',
      batches: 0,
      fileIds: [F1],
    });
    expect(confirm).toHaveBeenCalledWith({
      batches: 0,
      fileIds: [F1],
      lastEditedAt: undefined,
    });
    expect(marks().has(F1)).toBe(false);
    expect(catchUp.mock.calls).toEqual([[F1]]);
  });

  test('branch の編集は元の File として訊き、承けたら branch も送る', async () => {
    const { deps, confirm, catchUp, marks } = depsOf(
      [{ fileId: BRANCH, actor: 'local#a', count: 1, lastTimestamp: 0 }],
      true,
      [
        [F1, { state: 'pending' }],
        [BRANCH, { state: 'pending', trunk: F1 }],
      ],
    );
    await adoptLocalActors(DID, deps);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ fileIds: [F1] }),
    );
    expect(new Set(catchUp.mock.calls.map(([id]) => id))).toEqual(
      new Set([F1, BRANCH]),
    );
    expect(marks().size).toBe(0);
  });

  test('断ったら branch も手元に留める', async () => {
    const { deps, marks } = depsOf([], false, [
      [F1, { state: 'pending' }],
      [BRANCH, { state: 'pending', trunk: F1 }],
    ]);
    await adoptLocalActors(DID, deps);
    expect(marks().get(BRANCH)).toEqual({ state: 'declined', trunk: F1 });
  });
});
