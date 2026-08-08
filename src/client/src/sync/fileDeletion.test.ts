import { describe, expect, test } from 'bun:test';
import type { Actor, Batch, FileId } from '@conversensus/shared';
import { BatchIdSchema, isFileDeleted } from '@conversensus/shared';
import {
  buildTombstoneBatch,
  deleteFileByTombstone,
  nextTombstoneClock,
} from './fileDeletion';

const ACTOR = 'did:plc:alice#device-1' as Actor;
const FILE = '11111111-1111-4111-8111-111111111111' as FileId;

function batch(clock: number, ops: Batch['ops'] = []): Batch {
  return {
    id: BatchIdSchema.parse(crypto.randomUUID()),
    actor: ACTOR,
    clock,
    timestamp: clock,
    ops: ops.length > 0 ? ops : [{ kind: 'file.setName', name: 'F' }],
  };
}

describe('nextTombstoneClock', () => {
  test('空の op-log なら 1', () => {
    expect(nextTombstoneClock([])).toBe(1);
  });

  // 最大 clock + 1 であることが remote の削除検出を支えている: `listBatchFileHeads` は
  // 各ファイルの**最大 rkey** に着地し、rkey は clock 順に並ぶ (設計 §3-1)。
  // ここが最大でないと他端末は本体を引くまで削除に気づけない。
  test('既存 batch の最大 clock + 1 を返す', () => {
    expect(nextTombstoneClock([batch(1), batch(7), batch(3)])).toBe(8);
  });

  test('投入順に依存しない (最大値であって最後の要素ではない)', () => {
    expect(nextTombstoneClock([batch(9), batch(2)])).toBe(10);
  });
});

describe('buildTombstoneBatch', () => {
  test('file.remove 1 件の batch になる', () => {
    expect(buildTombstoneBatch([batch(4)], ACTOR).ops).toEqual([
      { kind: 'file.remove' },
    ]);
  });

  test('actor と clock (最大 + 1) を載せる', () => {
    const tombstone = buildTombstoneBatch([batch(4)], ACTOR);
    expect(tombstone.actor).toBe(ACTOR);
    expect(tombstone.clock).toBe(5);
  });

  // file 構造 batch は sheet scope を持たない (W3c2 §2.1)。sheetId が載ると
  // projection が content として扱おうとする。
  test('sheetId を持たない (file 構造 batch)', () => {
    expect(buildTombstoneBatch([batch(4)], ACTOR).sheetId).toBeUndefined();
  });

  test('組み立てた batch は isFileDeleted で削除済みと判定される', () => {
    const log = [batch(1), buildTombstoneBatch([batch(1)], ACTOR)];
    expect(isFileDeleted(log)).toBe(true);
  });
});

describe('deleteFileByTombstone', () => {
  test('宛先ファイルの op-log を読み、そのファイルへ tombstone を 1 件 push する', async () => {
    const pushed: { fileId: FileId; batches: Batch[] }[] = [];
    const tombstone = await deleteFileByTombstone(FILE, ACTOR, {
      fetchBatches: async () => [batch(2), batch(5)],
      push: async (fileId, batches) => {
        pushed.push({ fileId, batches });
      },
    });

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.fileId).toBe(FILE);
    expect(pushed[0]?.batches).toEqual([tombstone]);
    expect(tombstone.clock).toBe(6);
  });

  test('読む op-log は削除対象のファイルのもの', async () => {
    const read: FileId[] = [];
    await deleteFileByTombstone(FILE, ACTOR, {
      fetchBatches: async (fileId) => {
        read.push(fileId);
        return [];
      },
      push: async () => {},
    });
    expect(read).toEqual([FILE]);
  });

  // ローカル正典への追記が失敗したら呼び出し側は UI から消してはいけない。消すと
  // 「画面には無いが次の起動で戻る」= ANA-127 そのものの状態になる。
  test('push が失敗したら throw する (握り潰さない)', async () => {
    await expect(
      deleteFileByTombstone(FILE, ACTOR, {
        fetchBatches: async () => [],
        push: async () => {
          throw new Error('daemon down');
        },
      }),
    ).rejects.toThrow('daemon down');
  });

  test('op-log の読み取りが失敗したら push しない', async () => {
    let pushCalls = 0;
    await expect(
      deleteFileByTombstone(FILE, ACTOR, {
        fetchBatches: async () => {
          throw new Error('offline');
        },
        push: async () => {
          pushCalls += 1;
        },
      }),
    ).rejects.toThrow('offline');
    expect(pushCalls).toBe(0);
  });
});
