import { describe, expect, test } from 'bun:test';
import {
  type BatchId,
  BatchIdSchema,
  type BranchId,
  BranchIdSchema,
  type Did,
  type DtrId,
  DtrIdSchema,
  type FileId,
  FileIdSchema,
  type JudgmentBatch,
  type JudgmentOp,
  type MergeConflict,
  NodeIdSchema,
  type Op,
  type SheetId,
  SheetIdSchema,
} from '@conversensus/shared';
import {
  defaultCallees,
  needsForcedStart,
  type StartDtrDeps,
  startDtrForConflicts,
} from './startDtr';

const TRUNK: FileId = FileIdSchema.parse(crypto.randomUUID());
const BRANCH: BranchId = BranchIdSchema.parse(crypto.randomUUID());
const DTR: DtrId = DtrIdSchema.parse(crypto.randomUUID());
const SHEET: SheetId = SheetIdSchema.parse(crypto.randomUUID());

const A: Did = 'did:plc:a';
const B: Did = 'did:plc:b';

const bid = (): BatchId => BatchIdSchema.parse(crypto.randomUUID());

/** 競合の片側。`needsForcedStart` は中身を見ないが、型を偽らずに組む */
function side(): { batchId: BatchId; op: Op } {
  return {
    batchId: bid(),
    op: {
      kind: 'node.setContent',
      target: NodeIdSchema.parse(crypto.randomUUID()),
      content: 'x',
    },
  };
}

const content = (): MergeConflict => ({
  category: 'content',
  target: 'n1',
  ours: side(),
  theirs: side(),
});
const structure = (): MergeConflict => ({
  category: 'structure',
  kind: 'parallelChange',
  target: 'n1',
  ours: side(),
  theirs: side(),
});
const layout = (): MergeConflict => ({
  category: 'layout',
  aspect: 'position',
  target: 'n1',
  ours: side(),
  theirs: side(),
});

/** 呼び出しの**順序**まで見たいので、1 本の列に記録する */
type Recorded =
  | { call: 'sheet'; sheetId: SheetId; name: string }
  | { call: 'judgment'; ops: readonly JudgmentOp[] };

function fakeDeps(): { deps: StartDtrDeps; calls: Recorded[] } {
  const calls: Recorded[] = [];
  return {
    calls,
    deps: {
      recordSheetCreated: (sheetId, name) =>
        calls.push({ call: 'sheet', sheetId, name }),
      appendJudgment: async (_fileId, ops) => {
        calls.push({ call: 'judgment', ops });
        const batch: JudgmentBatch = {
          id: bid(),
          actor: 'did:plc:a#dev1',
          clock: 1,
          timestamp: 1,
          ops: [...ops],
        };
        return batch;
      },
      newSheetId: () => SHEET,
      newDtrId: () => DTR,
    },
  };
}

const input = (conflicts: MergeConflict[], participants: Did[] = [A, B]) => ({
  trunkFileId: TRUNK,
  conflicts,
  branchId: BRANCH,
  branchName: 'b',
  participants: new Set(participants),
  viewer: A,
});

// 似た述語が既にある (`requiresConfirmation` は content + structure)。**別の線である** —
// 仕様は structure を「そこから手動で選択的に起動」と定めており、自動起動してはならない
describe('needsForcedStart', () => {
  test('content の競合があれば強制起動する', () => {
    expect(needsForcedStart([content()])).toBe(true);
  });

  test('🔴 structure だけでは起動しない (手動で選択的に起動する段である)', () => {
    expect(needsForcedStart([structure()])).toBe(false);
  });

  test('layout だけでは起動しない (DtR を起動しない段である)', () => {
    expect(needsForcedStart([layout()])).toBe(false);
  });

  test('content が 1 件でも混ざれば起動する', () => {
    expect(needsForcedStart([layout(), structure(), content()])).toBe(true);
  });

  test('競合が無ければ起動しない', () => {
    expect(needsForcedStart([])).toBe(false);
  });
});

describe('defaultCallees', () => {
  test('explicit merge の既定値は共同作業者全員である', () => {
    expect(defaultCallees(new Set([A, B]), A)).toEqual([A, B]);
  });

  // 起動した本人が呼び出し対象に居ないと、`dtr.setCallees` の pre 条件 (発行者が
  // 呼び出し対象であること) を満たせず、**保留の出口を開けた本人が使えなくなる**
  test('🔴 名簿に自分が居なくても、起動した本人は必ず含まれる', () => {
    expect(defaultCallees(new Set([B]), A)).toEqual([A, B]);
  });

  test('重複は畳み、順序は安定させる', () => {
    expect(defaultCallees(new Set([B, A]), A)).toEqual([A, B]);
  });
});

describe('startDtrForConflicts', () => {
  test('content の競合で DtR を起動し、器と判断の両方を書く', async () => {
    const { deps, calls } = fakeDeps();
    const started = await startDtrForConflicts(input([content()]), deps);

    expect(started).toEqual({ dtrId: DTR, sheetId: SHEET, callees: [A, B] });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ call: 'sheet', sheetId: SHEET });
    expect(calls[1]).toMatchObject({ call: 'judgment' });
  });

  // 器 (trunk の op-log) と判断 (判断ログ) は別のログで、2 つに原子性は無い。
  // 片方だけが残る可能性は消せないが、**残りやすい側を先に置く**ことはできる —
  // 逆順だと「器を指しているのに器が無い」判断が書かれた瞬間が生まれる
  test('🔴 器を先に、判断を後に書く', async () => {
    const { deps, calls } = fakeDeps();
    await startDtrForConflicts(input([content()]), deps);

    expect(calls.map((c) => c.call)).toEqual(['sheet', 'judgment']);
  });

  test('判断ログに書くのは dtr.open だけである (名簿の op と混ぜない)', async () => {
    const { deps, calls } = fakeDeps();
    await startDtrForConflicts(input([content()]), deps);

    const written = calls.find((c) => c.call === 'judgment');
    expect(written).toBeDefined();
    if (written?.call !== 'judgment') throw new Error('判断が書かれていない');
    expect(written.ops).toEqual([
      {
        kind: 'dtr.open',
        target: DTR,
        branchId: BRANCH,
        sheetId: SHEET,
        callees: [A, B],
      },
    ]);
  });

  // 中途半端に器だけ作ると、DtR の無いシートが File に残る (しかも除外の基準は
  // 「DtR が指す sheetId」なので、普通のタブとして並ぶ)
  test('🔴 起動しないときは器も判断も書かない', async () => {
    const { deps, calls } = fakeDeps();
    const started = await startDtrForConflicts(
      input([structure(), layout()]),
      deps,
    );

    expect(started).toBeNull();
    expect(calls).toEqual([]);
  });
});
