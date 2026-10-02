import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  type BranchId,
  BranchIdSchema,
  type CommitId,
  type FileId,
  FileIdSchema,
  type NodeId,
  NodeIdSchema,
  type SheetId,
  SheetIdSchema,
} from '../schemas';
import {
  type GraphViewAddress,
  HEAD_CUT,
  isReadOnlyCut,
  projectAddress,
} from './address';
import { type Branch, branchSheet, makeBaseCommit } from './branchLog';
import { CausalClock } from './causalClock';
import { heldMaxima } from './causality';
import { projectFile } from './project';
import { type Actor, type Batch, BRANCH_STATUS, type Op } from './unified';

const FILE = FileIdSchema.parse('00000000-0000-4000-8000-0000000000f1');
const SHEET = SheetIdSchema.parse('00000000-0000-4000-8000-0000000000a1');
const BRANCH = BranchIdSchema.parse('00000000-0000-4000-8000-0000000000b1');
const ALICE = 'did:plc:alice#dev-a' as Actor;
const BOB = 'did:plc:bob#dev-b' as Actor;

/**
 * node の小さなプール。広い生成器だと同じ node を引かず、「後から消す」「別の人が書き換える」
 * という、切断面で結果が変わる場面に当たらない (CLAUDE.md「小さなプールが効く」)
 */
const NODES: NodeId[] = [1, 2, 3].map((n) =>
  NodeIdSchema.parse(`00000000-0000-4000-8000-00000000000${n}`),
);

/** 1 手の編集。誰が・どのログに・何をしたか */
type Step = {
  actor: Actor;
  onBranch: boolean;
  op: 'add' | 'setContent' | 'remove';
  node: number;
  content: 'x' | 'y';
};

const arbStep: fc.Arbitrary<Step> = fc.record({
  actor: fc.constantFrom(ALICE, BOB),
  onBranch: fc.boolean(),
  op: fc.constantFrom('add', 'setContent', 'remove'),
  node: fc.integer({ min: 0, max: NODES.length - 1 }),
  content: fc.constantFrom('x', 'y'),
});

const toOp = (step: Step): Op => {
  const target = NODES[step.node] as NodeId;
  switch (step.op) {
    case 'add':
      return { kind: 'node.add', target, content: step.content };
    case 'setContent':
      return { kind: 'node.setContent', target, content: step.content };
    case 'remove':
      return { kind: 'node.remove', target };
  }
};

/**
 * 歴史を 1 本の時間で再生する。actor ごとに発番器を 1 つ持ち、**trunk と branch で共有する**
 * (本物と同じ: seq は File の中で actor ごとに 1 系列)。`branchAt` 手目の直前に branch を切り、
 * 以後の `onBranch` の手は branch へ積む。
 *
 * 返す `prefixes[i]` は「i 手目まで積んだ時点」の trunk / branch と、その時点の切断面
 * (`heldMaxima`) である。**切断面の主張は「vector で切った姿 = その時点に実際にあった姿」**
 * なので、比べる相手として各時点の実物を残す
 */
function replay(steps: Step[], branchAt: number) {
  const clocks = new Map<Actor, CausalClock>([
    [ALICE, new CausalClock(ALICE)],
    [BOB, new CausalClock(BOB)],
  ]);
  const issue = (actor: Actor, ops: Op[], sheetId?: SheetId): Batch => {
    const stamp = (clocks.get(actor) as CausalClock).issue();
    return {
      id: `${actor}@${stamp.seq}` as Batch['id'],
      actor,
      ...stamp,
      timestamp: stamp.clock,
      ops,
      ...(sheetId && { sheetId }),
    };
  };

  const trunk: Batch[] = [
    issue(ALICE, [{ kind: 'sheet.create', target: SHEET, name: 'S' }]),
  ];
  const branchBatches: Batch[] = [];
  let branch: Branch | undefined;
  const prefixes: Array<{ trunk: Batch[]; branch: Batch[] }> = [];

  steps.forEach((step, i) => {
    if (i === branchAt) {
      branch = {
        id: BRANCH,
        name: 'b',
        base: makeBaseCommit('base' as CommitId, 'base', ALICE, trunk),
        status: BRANCH_STATUS.OPEN,
      };
    }
    if (branch && step.onBranch) {
      branchBatches.push(issue(step.actor, [toOp(step)]));
    } else {
      trunk.push(issue(step.actor, [toOp(step)], SHEET));
    }
    prefixes.push({ trunk: [...trunk], branch: [...branchBatches] });
  });
  // branchAt が手数を超えたら最後に切る (branch は空)
  branch ??= {
    id: BRANCH,
    name: 'b',
    base: makeBaseCommit('base' as CommitId, 'base', ALICE, trunk),
    status: BRANCH_STATUS.OPEN,
  };
  return { trunk, branchBatches, branch, prefixes };
}

const trunkAddress = (cut: GraphViewAddress['cut']): GraphViewAddress => ({
  fileId: FILE,
  sheetId: SHEET,
  branchId: null,
  cut,
});
const branchAddress = (cut: GraphViewAddress['cut']): GraphViewAddress => ({
  ...trunkAddress(cut),
  branchId: BRANCH as BranchId,
});

const sheetOf = (batches: Batch[]) =>
  projectFile(batches, FILE as FileId).sheets.find((s) => s.id === SHEET);

const arbHistory = fc
  .array(arbStep, { minLength: 1, maxLength: 12 })
  .chain((steps) =>
    fc.record({
      steps: fc.constant(steps),
      branchAt: fc.integer({ min: 0, max: steps.length }),
      cutAt: fc.integer({ min: 0, max: steps.length - 1 }),
    }),
  );

describe('projectAddress (step3 Phase 3 S3-1)', () => {
  test('性質: head の trunk は、いまの projection と一致する', () => {
    fc.assert(
      fc.property(arbHistory, ({ steps, branchAt }) => {
        const { trunk } = replay(steps, branchAt);
        expect(projectAddress(trunkAddress(HEAD_CUT), { trunk })).toEqual(
          sheetOf(trunk),
        );
      }),
    );
  });

  test('性質: head の branch は、いまの branch の projection と一致する', () => {
    fc.assert(
      fc.property(arbHistory, ({ steps, branchAt }) => {
        const { trunk, branchBatches, branch } = replay(steps, branchAt);
        const meta = sheetOf(trunk);
        if (!meta) throw new Error('sheet が無い');
        expect(
          projectAddress(branchAddress(HEAD_CUT), {
            trunk,
            branch: { branch, batches: branchBatches },
          }),
        ).toEqual(branchSheet(branch, trunk, branchBatches, meta));
      }),
    );
  });

  /**
   * 切断面の中心の主張。vector で切った姿は、**その時点に実際にあった姿**と一致する。
   * 後から積まれた batch は、どの actor のものでも、clock がいくつでも入らない
   */
  test('性質: 切断面で切った姿は、その時点に実際にあった姿である (trunk と branch)', () => {
    fc.assert(
      fc.property(arbHistory, ({ steps, branchAt, cutAt }) => {
        const { trunk, branchBatches, branch, prefixes } = replay(
          steps,
          branchAt,
        );
        const then = prefixes[cutAt] as { trunk: Batch[]; branch: Batch[] };
        const cut = heldMaxima([...then.trunk, ...then.branch]);

        expect(projectAddress(trunkAddress(cut), { trunk })).toEqual(
          sheetOf(then.trunk),
        );

        const meta = sheetOf(then.trunk);
        if (!meta) throw new Error('sheet が無い');
        expect(
          projectAddress(branchAddress(cut), {
            trunk,
            branch: { branch, batches: branchBatches },
          }),
        ).toEqual(branchSheet(branch, then.trunk, then.branch, meta));
      }),
    );
  });

  test('性質: 全部を覆う切断面は head と同じ姿になる', () => {
    fc.assert(
      fc.property(arbHistory, ({ steps, branchAt }) => {
        const { trunk, branchBatches, branch } = replay(steps, branchAt);
        const all = heldMaxima([...trunk, ...branchBatches]);
        const logs = { trunk, branch: { branch, batches: branchBatches } };
        expect(projectAddress(trunkAddress(all), logs)).toEqual(
          projectAddress(trunkAddress(HEAD_CUT), logs),
        );
        expect(projectAddress(branchAddress(all), logs)).toEqual(
          projectAddress(branchAddress(HEAD_CUT), logs),
        );
      }),
    );
  });

  test('性質: 分岐点より前の切断面では、branch は分岐する前の trunk と同じ姿になる', () => {
    fc.assert(
      fc.property(arbHistory, ({ steps, branchAt, cutAt }) => {
        fc.pre(cutAt < branchAt);
        const { trunk, branchBatches, branch, prefixes } = replay(
          steps,
          branchAt,
        );
        const then = prefixes[cutAt] as { trunk: Batch[]; branch: Batch[] };
        const cut = heldMaxima(then.trunk);
        const logs = { trunk, branch: { branch, batches: branchBatches } };
        expect(projectAddress(branchAddress(cut), logs)).toEqual(
          projectAddress(trunkAddress(cut), logs),
        );
      }),
    );
  });

  test('シートがまだ無い切断面では undefined', () => {
    const { trunk } = replay(
      [{ actor: ALICE, onBranch: false, op: 'add', node: 0, content: 'x' }],
      1,
    );
    expect(projectAddress(trunkAddress({}), { trunk })).toBeUndefined();
  });

  test('branch のアドレスに別の branch の op-log を渡すと投げる', () => {
    const { trunk, branch } = replay([], 0);
    const other = { ...branch, id: BranchIdSchema.parse(crypto.randomUUID()) };
    expect(() =>
      projectAddress(branchAddress(HEAD_CUT), {
        trunk,
        branch: { branch: other, batches: [] },
      }),
    ).toThrow();
  });

  test('過去の切断面は読み取り専用、head は編集できる', () => {
    expect(isReadOnlyCut(HEAD_CUT)).toBe(false);
    expect(isReadOnlyCut({ [ALICE]: 1 })).toBe(true);
  });
});
