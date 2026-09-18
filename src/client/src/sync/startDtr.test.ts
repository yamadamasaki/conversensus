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
/** この DtR を必要にした原因 (merge した branch) */
const BRANCH: BranchId = BranchIdSchema.parse(crypto.randomUUID());
/** 解決のために切る作業用 branch。原因とは別物である */
const RESOLVE: BranchId = BranchIdSchema.parse(crypto.randomUUID());
const DTR: DtrId = DtrIdSchema.parse(crypto.randomUUID());
const SHEET: SheetId = SheetIdSchema.parse(crypto.randomUUID());
/** 競合が起きたシート (解決 branch はここから切る) */
const SOURCE_SHEET: SheetId = SheetIdSchema.parse(crypto.randomUUID());

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
  | { call: 'branch'; name: string; sheetId: SheetId; trunkFileId: FileId }
  | { call: 'sheet'; sheetId: SheetId; name: string }
  | { call: 'judgment'; ops: readonly JudgmentOp[] };

function fakeDeps(): { deps: StartDtrDeps; calls: Recorded[] } {
  const calls: Recorded[] = [];
  return {
    calls,
    deps: {
      createResolveBranch: async ({ name, sheetId, trunkFileId }) => {
        calls.push({ call: 'branch', name, sheetId, trunkFileId });
        return RESOLVE;
      },
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
  sourceSheetId: SOURCE_SHEET,
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
  test('content の競合で DtR を起動し、2 つの器と判断を書く', async () => {
    const { deps, calls } = fakeDeps();
    const started = await startDtrForConflicts(input([content()]), deps);

    expect(started).toEqual({
      dtrId: DTR,
      sheetId: SHEET,
      resolveBranchId: RESOLVE,
      callees: [A, B],
    });
    expect(calls).toHaveLength(3);
  });

  /**
   * 器 (trunk の op-log) と判断 (判断ログ) は別のログで、2 つに原子性は無い。
   * 片方だけが残る可能性は消せないが、**残りやすい側を先に置く**ことはできる —
   * 逆順だと「器を指しているのに器が無い」判断が書かれた瞬間が生まれる。
   * 器は 2 つある (解決 = branch / 対話 = sheet) ので、両方が判断より前に来る。
   */
  test('🔴 器を先に、判断を後に書く', async () => {
    const { deps, calls } = fakeDeps();
    await startDtrForConflicts(input([content()]), deps);

    expect(calls.map((c) => c.call)).toEqual(['branch', 'sheet', 'judgment']);
  });

  // branch は per-sheet なので、**競合が起きたシート**から切らないと解決の場が
  // 別のシートの複製になる
  test('🔴 解決 branch は競合したシートから切る', async () => {
    const { deps, calls } = fakeDeps();
    await startDtrForConflicts(input([content()]), deps);

    const branch = calls.find((c) => c.call === 'branch');
    expect(branch).toBeDefined();
    if (branch?.call !== 'branch') throw new Error('branch が切られていない');
    expect(branch.sheetId).toBe(SOURCE_SHEET);
    expect(branch.trunkFileId).toBe(TRUNK);
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
        resolveBranchId: RESOLVE,
        sheetId: SHEET,
        callees: [A, B],
      },
    ]);
  });

  // 中途半端に器だけ作ると、DtR の無いシートと branch が File に残る
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
