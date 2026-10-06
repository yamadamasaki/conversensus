import { describe, expect, mock, test } from 'bun:test';
import type { Actor, Did, FileId } from '@conversensus/shared';
import {
  type AdoptLocalActorsDeps,
  adoptLocalActors,
  type LocalActorBatches,
} from './adoptLocalActors';

const DID = 'did:plc:alice' as Did;
const F1 = '11111111-1111-4111-8111-111111111111' as FileId;
const F2 = '22222222-2222-4222-8222-222222222222' as FileId;

function depsOf(rows: LocalActorBatches[], answer = true) {
  let n = 0;
  const renameActor = mock(async (_from: Actor, _to: Actor) => 1);
  const catchUp = mock(async (_fileId: FileId) => {});
  const confirm = mock(async () => answer);
  const deps: AdoptLocalActorsDeps = {
    listLocalActorBatches: async () => rows,
    renameActor,
    newDeviceId: () => `new-${++n}`,
    confirm,
    catchUp,
  };
  return { deps, renameActor, catchUp, confirm };
}

describe('adoptLocalActors', () => {
  test('未ログインの batch が無ければ訊かずに何もしない', async () => {
    const { deps, confirm } = depsOf([]);
    expect(await adoptLocalActors(DID, deps)).toEqual({ status: 'none' });
    expect(confirm).not.toHaveBeenCalled();
  });

  test('件数と File と最後の編集の時刻を見せて訊き、断られたら何も書き換えない', async () => {
    const { deps, confirm, renameActor, catchUp } = depsOf(
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
