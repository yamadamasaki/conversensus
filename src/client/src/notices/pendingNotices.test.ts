import { describe, expect, test } from 'bun:test';
import type {
  BatchId,
  FileId,
  MergeConflict,
  NodeId,
} from '@conversensus/shared';
import fc from 'fast-check';
import type { ConflictNoticeState } from '../hooks/useBranchOperations';
import { conflictNoticeKeyOf } from './noticeKeys';
import {
  addPending,
  NO_PENDING_CONFLICTS,
  type PendingConflicts,
  takePending,
} from './pendingNotices';

const FILE_A = 'file-a' as FileId;
const FILE_B = 'file-b' as FileId;

/** 対象と両側の batch で決まる競合 (鍵もこの 3 つで決まる) */
function conflict(target: string, ours = 'o', theirs = 't'): MergeConflict {
  return {
    category: 'content',
    target,
    ours: {
      batchId: ours as BatchId,
      op: { kind: 'node.add', target: target as NodeId, content: '' },
    },
    theirs: {
      batchId: theirs as BatchId,
      op: { kind: 'node.add', target: target as NodeId, content: '' },
    },
  };
}

function notice(
  fileId: FileId | undefined,
  targets: string[],
  forkCount = 0,
  labels: [string, string][] = [],
): ConflictNoticeState {
  return {
    ...(fileId !== undefined && { fileId }),
    conflicts: targets.map((t) => conflict(t)),
    labels: new Map(labels),
    forkCount,
  };
}

describe('addPending / takePending (#260)', () => {
  test('File ごとに溜め、取り出すと残りから消える', () => {
    let pending = addPending(NO_PENDING_CONFLICTS, notice(FILE_A, ['n1']));
    pending = addPending(pending, notice(FILE_B, ['n2']));
    const [mine, rest] = takePending(pending, FILE_A);
    expect(mine?.conflicts.map((c) => c.target)).toEqual(['n1']);
    expect([...rest.keys()]).toEqual([FILE_B]);
    // 元の控えは変えない
    expect([...pending.keys()]).toEqual([FILE_A, FILE_B]);
  });

  test('同じ File に重ねたら、同じ競合は 1 つにし、名前は合わせ、保留の件数は競合の数を超えない', () => {
    let pending = addPending(
      NO_PENDING_CONFLICTS,
      notice(FILE_A, ['n1'], 1, [['n1', '前の名前']]),
    );
    pending = addPending(
      pending,
      notice(FILE_A, ['n1', 'n2'], 2, [
        ['n1', '後の名前'],
        ['n2', 'もう 1 つ'],
      ]),
    );
    const held = pending.get(FILE_A);
    expect(held?.conflicts.map((c) => c.target)).toEqual(['n1', 'n2']);
    // 先に溜めた方の名前を残す (検出したときの分岐点の名前)
    expect(held?.labels.get('n1')).toBe('前の名前');
    expect(held?.labels.get('n2')).toBe('もう 1 つ');
    expect(held?.forkCount).toBe(2);
  });

  test('File の無い通知・競合の無い通知は溜めない', () => {
    expect(addPending(NO_PENDING_CONFLICTS, notice(undefined, ['n1']))).toBe(
      NO_PENDING_CONFLICTS,
    );
    expect(addPending(NO_PENDING_CONFLICTS, notice(FILE_A, []))).toBe(
      NO_PENDING_CONFLICTS,
    );
  });

  test('控えに無い File を取り出しても、控えは同じものを返す', () => {
    const pending = addPending(NO_PENDING_CONFLICTS, notice(FILE_A, ['n1']));
    const [mine, rest] = takePending(pending, FILE_B);
    expect(mine).toBeUndefined();
    expect(rest).toBe(pending);
  });

  test('∀ 溜める順. その File の競合の鍵の集合は、溜めた通知の鍵の和集合になる', () => {
    const TARGET = fc.constantFrom('n1', 'n2', 'n3');
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom(FILE_A, FILE_B),
            fc.array(TARGET, { maxLength: 3 }),
          ),
          { maxLength: 6 },
        ),
        (adds) => {
          let pending: PendingConflicts = NO_PENDING_CONFLICTS;
          for (const [fileId, targets] of adds)
            pending = addPending(
              pending,
              notice(fileId, [...new Set(targets)]),
            );
          for (const fileId of [FILE_A, FILE_B]) {
            const expected = new Set(
              adds
                .filter(([f]) => f === fileId)
                .flatMap(([, ts]) =>
                  ts.map((t) => conflictNoticeKeyOf(conflict(t))),
                ),
            );
            const held = pending.get(fileId);
            const keys = (held?.conflicts ?? []).map(conflictNoticeKeyOf);
            expect(new Set(keys)).toEqual(expected);
            // 同じ競合は 1 つ
            expect(keys).toHaveLength(expected.size);
          }
        },
      ),
    );
  });
});
