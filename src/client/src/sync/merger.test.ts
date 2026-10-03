import { describe, expect, test } from 'bun:test';
import {
  type Batch,
  BRANCH_STATUS,
  type BranchId,
  type BranchMeta,
  CausalClock,
  COMMIT_KIND,
  type CommitId,
  conflictKeyOf,
  type FileId,
  LamportClock,
  type MergeConflict,
  type NodeId,
  type Op,
  type SheetId,
} from '@conversensus/shared';
import fc from 'fast-check';
import { type MergeBranchDeps, mergeBranchOnOplog } from './mergeBranch';
import { allChecked, carryChecks, mergerSnapshot } from './merger';

const TRUNK = 'trunk-file' as FileId;
const BRANCH_LOG = 'branch-file' as FileId;
const SHEET = 'sheet-1' as SheetId;
const ALICE = 'did:plc:alice#dev-a';
const BOB = 'did:plc:bob#dev-b';
/** node の小さなプール。同じ node を両側が触る (競合する) 場面に当たるため */
const NODES = ['n1', 'n2', 'n3'] as NodeId[];

const meta: BranchMeta = {
  id: 'branch-1' as BranchId,
  name: '案A',
  base: {
    id: 'commit-1' as CommitId,
    kind: COMMIT_KIND.COMMIT,
    message: '分岐点',
    at: 2,
    authorActor: ALICE,
  },
  status: BRANCH_STATUS.OPEN,
  sheetId: SHEET,
  trunkFileId: TRUNK,
  branchFileId: BRANCH_LOG,
};

/** 分岐点までの trunk: シートと node n1 */
const genesis = (): Batch[] => [
  {
    id: 't0' as Batch['id'],
    actor: 'genesis',
    clock: 1,
    seq: 1,
    deps: {},
    timestamp: 1,
    ops: [{ kind: 'sheet.create', target: SHEET, name: 'シート1' }],
  },
  {
    id: 't1' as Batch['id'],
    actor: ALICE,
    clock: 2,
    seq: 2,
    deps: {},
    timestamp: 2,
    sheetId: SHEET,
    ops: [{ kind: 'node.add', target: NODES[0] as NodeId, content: 'もと' }],
  },
];

type Step = {
  onBranch: boolean;
  op: 'add' | 'set' | 'remove';
  node: number;
  text: 'x' | 'y';
};
const arbStep: fc.Arbitrary<Step> = fc.record({
  onBranch: fc.boolean(),
  op: fc.constantFrom('add', 'set', 'remove'),
  node: fc.nat({ max: NODES.length - 1 }),
  text: fc.constantFrom('x', 'y'),
});
const toOp = (s: Step): Op => {
  const target = NODES[s.node] as NodeId;
  if (s.op === 'add') return { kind: 'node.add', target, content: s.text };
  if (s.op === 'set')
    return { kind: 'node.setContent', target, content: s.text };
  return { kind: 'node.remove', target };
};

/** 歴史を積む。trunk 側は bob、branch 側は alice。clock は分岐点 (2) より後から振る */
function build(steps: Step[]) {
  const trunk = genesis();
  const branch: Batch[] = [];
  steps.forEach((s, i) => {
    const clock = 3 + i;
    const batch: Batch = {
      id: `s${i}` as Batch['id'],
      actor: s.onBranch ? ALICE : BOB,
      clock,
      seq: clock,
      deps: {},
      timestamp: clock,
      sheetId: SHEET,
      ops: [toOp(s)],
    };
    (s.onBranch ? branch : trunk).push(batch);
  });
  return { trunk, branch };
}

/** 実際の merge を、手元の op-log の写しの上で走らせる */
async function realMerge(logs: Record<string, Batch[]>) {
  let n = 0;
  const deps: MergeBranchDeps = {
    fetchBatches: async (fileId) => [...(logs[fileId] ?? [])],
    appendBatches: async (fileId, batches) => {
      logs[fileId] = [...(logs[fileId] ?? []), ...batches];
      return batches.length;
    },
    recordStatus: () => {},
    recordCommit: () => {},
    newId: () => `merge-${++n}`,
    causal: new CausalClock(ALICE, new LamportClock(0)),
  };
  const result = await mergeBranchOnOplog(
    meta,
    { message: '取り込む', actor: ALICE },
    deps,
  );
  return result.trunk?.sheets.find((s) => s.id === SHEET);
}

const shape = (
  sheet: { nodes: { id: string; content: string }[] } | undefined,
) => sheet?.nodes.map((n) => [n.id, n.content]).sort();

describe('mergerSnapshot: 性質', () => {
  test('∀ 歴史. merge 後の姿は、実際に merge した後の trunk の姿と同じ', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbStep, { maxLength: 10 }), async (steps) => {
        const { trunk, branch } = build(steps);
        const snapshot = mergerSnapshot(meta, trunk, branch, {});
        const merged = await realMerge({
          [TRUNK]: trunk,
          [BRANCH_LOG]: branch,
        });
        expect(shape(snapshot.result)).toEqual(shape(merged));
      }),
    );
  });

  test('∀ 歴史. 一度 merge した後に続けて編集しても、merge 後の姿は 2 度目の merge の結果と同じ (写し済みを落とす)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbStep, { maxLength: 6 }),
        fc.array(arbStep, { maxLength: 6 }),
        async (first, second) => {
          const { trunk, branch } = build(first);
          const logs = { [TRUNK]: trunk, [BRANCH_LOG]: branch };
          await realMerge(logs);
          // 2 度目の編集は 1 度目より後の clock で積む
          const more = build(second);
          const offset = 100;
          const shift = (b: Batch): Batch => ({
            ...b,
            id: `${b.id}-2` as Batch['id'],
            clock: b.clock + offset,
            seq: b.seq + offset,
          });
          logs[TRUNK] = [
            ...(logs[TRUNK] ?? []),
            ...more.trunk.slice(genesis().length).map(shift),
          ];
          logs[BRANCH_LOG] = [
            ...(logs[BRANCH_LOG] ?? []),
            ...more.branch.map(shift),
          ];
          const snapshot = mergerSnapshot(
            meta,
            logs[TRUNK] ?? [],
            logs[BRANCH_LOG] ?? [],
            {},
          );
          const merged = await realMerge(logs);
          expect(shape(snapshot.result)).toEqual(shape(merged));
        },
      ),
    );
  });
});

describe('mergerSnapshot: 例', () => {
  const { trunk, branch } = build([
    { onBranch: true, op: 'set', node: 0, text: 'x' },
    { onBranch: false, op: 'set', node: 0, text: 'y' },
  ]);

  test('元は開いた時点、先は trunk の最新、後は branch の勝ち。両側が同じ node を書き換えたら競合になる', () => {
    // 開いた時点 = 分岐点までの知識 (本番は開いたときの手元の vector で、全 actor を含む。genesis を
    // 外すとシートの作成まで切断面の外に出る)。branch の編集 s0 (alice の seq 3) は入らない
    const snapshot = mergerSnapshot(meta, trunk, branch, {
      genesis: 1,
      [ALICE]: 2,
    });
    expect(shape(snapshot.source)).toEqual([['n1', 'もと']]);
    expect(shape(snapshot.target)).toEqual([['n1', 'y']]);
    expect(shape(snapshot.result)).toEqual([['n1', 'x']]);
    expect(snapshot.conflicts.map((c) => c.target)).toEqual(['n1']);
    expect(snapshot.labels.get('n1')).toBe('もと');
  });
});

describe('チェック状態', () => {
  const conflict = (
    target: string,
    ours: string,
    theirs: string,
  ): MergeConflict => ({
    category: 'content',
    target,
    ours: {
      batchId: ours as Batch['id'],
      op: { kind: 'node.remove', target: target as NodeId },
    },
    theirs: {
      batchId: theirs as Batch['id'],
      op: { kind: 'node.remove', target: target as NodeId },
    },
  });
  const a = conflict('n1', 'b1', 'b2');
  const b = conflict('n2', 'b3', 'b4');

  test('残っている競合のチェックは引き継ぎ、消えた競合のチェックは捨てる', () => {
    const checked = [conflictKeyOf(a), conflictKeyOf(b)];
    expect(carryChecks(checked, [a])).toEqual([conflictKeyOf(a)]);
  });

  test('すべてにチェックが入ったときだけ merge できる。新しい競合が増えたら押せなくなる', () => {
    expect(allChecked([conflictKeyOf(a)], [a])).toBe(true);
    expect(allChecked([conflictKeyOf(a)], [a, b])).toBe(false);
    expect(allChecked([], [])).toBe(true);
  });
});
