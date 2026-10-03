import { describe, expect, test } from 'bun:test';
import {
  type Batch,
  BRANCH_STATUS,
  type BranchId,
  type BranchMeta,
  CausalClock,
  COMMIT_KIND,
  type CommitId,
  type FileId,
  LamportClock,
  type MergeConflict,
  makeFork,
  type NodeId,
  type Op,
  type SheetId,
} from '@conversensus/shared';
import fc from 'fast-check';
import { type MergeBranchDeps, mergeBranchOnOplog } from './mergeBranch';
import {
  allChecked,
  carryChecks,
  conflictOfFork,
  conflictTargets,
  diffMarks,
  forkSideLabels,
  mergerCheckKey,
  mergerConflicts,
  mergerSnapshot,
} from './merger';

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
    const checked = [mergerCheckKey(a), mergerCheckKey(b)];
    expect(carryChecks(checked, [a])).toEqual([mergerCheckKey(a)]);
  });

  test('すべてにチェックが入ったときだけ merge できる。新しい競合が増えたら押せなくなる', () => {
    expect(allChecked([mergerCheckKey(a)], [a])).toBe(true);
    expect(allChecked([mergerCheckKey(a)], [a, b])).toBe(false);
    expect(allChecked([], [])).toBe(true);
  });
});

describe('チェックの鍵 (step3 Phase 5)', () => {
  const conflict = (ours: string, theirs: string): MergeConflict => ({
    category: 'content',
    target: 'n1',
    ours: {
      batchId: ours as Batch['id'],
      op: { kind: 'node.remove', target: 'n1' as NodeId },
    },
    theirs: {
      batchId: theirs as Batch['id'],
      op: { kind: 'node.remove', target: 'n1' as NodeId },
    },
  });

  test('branch 側 (解決の編集) が変わっても鍵は変わらず、trunk 側が進めば変わる', () => {
    expect(mergerCheckKey(conflict('t1', 'b1'))).toBe(
      mergerCheckKey(conflict('t1', 'b2')),
    );
    expect(mergerCheckKey(conflict('t1', 'b1'))).not.toBe(
      mergerCheckKey(conflict('t2', 'b1')),
    );
  });

  test('同じ鍵の競合は 1 つにまとめ、いちばん新しい branch 側を残す', () => {
    expect(
      mergerConflicts([conflict('t1', 'b1'), conflict('t1', 'b2')]).map(
        (c) => c.theirs.batchId,
      ),
    ).toEqual(['b2' as Batch['id']]);
  });
});

describe('diffMarks / conflictTargets (step3 Phase 5 S5-1b)', () => {
  const sheet = (nodes: [string, string][]) => ({
    id: SHEET,
    name: 'S',
    nodes: nodes.map(([id, content]) => ({ id: id as NodeId, content })),
    edges: [],
  });

  test('足した node は追加、本文が違う node は変更、同じ node は印なし。消えた node は印を付けない', () => {
    const marks = diffMarks(
      sheet([
        ['n1', 'もと'],
        ['n2', 'そのまま'],
        ['n3', '消える'],
      ]),
      sheet([
        ['n1', '変えた'],
        ['n2', 'そのまま'],
        ['n4', '足した'],
      ]),
    );
    expect([...marks.addedNodes]).toEqual(['n4']);
    expect([...marks.updatedNodes]).toEqual(['n1']);
  });

  test('競合の対象の集合', () => {
    const c: MergeConflict = {
      category: 'content',
      target: 'n1',
      ours: {
        batchId: 'a' as Batch['id'],
        op: { kind: 'node.remove', target: 'n1' as NodeId },
      },
      theirs: {
        batchId: 'b' as Batch['id'],
        op: { kind: 'node.remove', target: 'n1' as NodeId },
      },
    };
    expect([...conflictTargets([c, c])]).toEqual(['n1']);
  });
});

describe('fork から merger を開く (step3 Phase 5 S5-3)', () => {
  const forkOf = (conflict: MergeConflict, localBatches: Batch[]) => {
    let n = 0;
    return makeFork({
      conflict,
      targetLabel: 'もと',
      batchOf: () => undefined,
      localBatches,
      sheetId: SHEET,
      trunkFileId: TRUNK,
      authorActor: ALICE,
      newId: () => `fork-${++n}`,
    });
  };

  /**
   * 種別ごとの細目 (structure の kind / layout の aspect) とプロパティ名の有無を全部引く。op は本文の
   * 書き換えに固定する — 往復で落ちうるのは記述の形 (種別と細目) であって、op は素通しされる
   */
  const arbConflict: fc.Arbitrary<MergeConflict> = fc
    .record({
      variant: fc.constantFrom(
        { category: 'content' as const },
        { category: 'structure' as const, kind: 'removeDependency' as const },
        { category: 'structure' as const, kind: 'parallelChange' as const },
        { category: 'layout' as const, aspect: 'position' as const },
        { category: 'layout' as const, aspect: 'size' as const },
        { category: 'layout' as const, aspect: 'route' as const },
      ),
      target: fc.constantFrom(...NODES),
      propertyName: fc.option(fc.constantFrom('担当', '期限'), {
        nil: undefined,
      }),
      ours: fc.constantFrom('b1', 'b2'),
      theirs: fc.constantFrom('b3', 'b4'),
    })
    .map(
      ({ variant, target, propertyName, ours, theirs }) =>
        ({
          ...variant,
          target,
          ...(propertyName !== undefined && { propertyName }),
          ours: {
            batchId: ours as Batch['id'],
            op: { kind: 'node.setContent', target, content: 'y' },
          },
          theirs: {
            batchId: theirs as Batch['id'],
            op: { kind: 'node.setContent', target, content: 'x' },
          },
        }) as MergeConflict,
    );

  test('∀ 競合. fork に凍結した記述から戻した競合は、元の競合と同じ', () => {
    fc.assert(
      fc.property(arbConflict, (conflict) => {
        expect(conflictOfFork(forkOf(conflict, genesis()))).toEqual(conflict);
      }),
    );
  });

  test('元は fork の分岐点、後は trunk の最新 (fork は空)。競合は計算し直さず凍結した記述から出す', () => {
    // 検出時点の手元 = genesis。その後 trunk に n2 が足された
    const trunk = [
      ...genesis(),
      {
        id: 't2' as Batch['id'],
        actor: BOB,
        clock: 3,
        seq: 3,
        deps: {},
        timestamp: 3,
        sheetId: SHEET,
        ops: [
          { kind: 'node.add', target: NODES[1] as NodeId, content: 'あと' },
        ],
      } satisfies Batch,
    ];
    const conflict: MergeConflict = {
      category: 'content',
      target: NODES[0] as NodeId,
      ours: {
        batchId: 'b1' as Batch['id'],
        op: {
          kind: 'node.setContent',
          target: NODES[0] as NodeId,
          content: 'y',
        },
      },
      theirs: {
        batchId: 'b2' as Batch['id'],
        op: {
          kind: 'node.setContent',
          target: NODES[0] as NodeId,
          content: 'x',
        },
      },
    };
    const fork = forkOf(conflict, genesis());
    const snapshot = mergerSnapshot(fork, trunk, [], {
      genesis: 1,
      [ALICE]: 2,
      [BOB]: 3,
    });
    expect(shape(snapshot.source)).toEqual([['n1', 'もと']]);
    expect(shape(snapshot.target)).toEqual([
      ['n1', 'もと'],
      ['n2', 'あと'],
    ]);
    expect(shape(snapshot.result)).toEqual(shape(snapshot.target));
    expect(snapshot.conflicts).toEqual([conflict]);
    expect(snapshot.labels.get('n1')).toBe('もと');
  });

  /** 届いた側 (alice の b2) は分岐点 (検出した人の手元 = genesis) の後の trunk に居る */
  const setContent = (
    id: string,
    actor: string,
    clock: number,
    content: string,
  ): Batch => ({
    id: id as Batch['id'],
    actor,
    clock,
    seq: clock,
    deps: {},
    timestamp: clock,
    sheetId: SHEET,
    ops: [{ kind: 'node.setContent', target: NODES[0] as NodeId, content }],
  });
  const frozenConflict: MergeConflict = {
    category: 'content',
    target: NODES[0] as NodeId,
    ours: {
      batchId: 't1' as Batch['id'],
      op: { kind: 'node.add', target: NODES[0] as NodeId, content: 'もと' },
    },
    theirs: {
      batchId: 'b2' as Batch['id'],
      op: { kind: 'node.setContent', target: NODES[0] as NodeId, content: 'x' },
    },
  };
  const everything = { genesis: 1, [ALICE]: 9, [BOB]: 9 };

  test('解決の編集と、分岐点の後に居る届いた側の組は、凍結した競合と同じものとみなす (増えない)', () => {
    const fork = forkOf(frozenConflict, genesis());
    const trunk = [...genesis(), setContent('b2', BOB, 3, 'x')];
    const resolution = [setContent('r1', ALICE, 4, 'まとめ')];
    const snapshot = mergerSnapshot(fork, trunk, resolution, everything);
    expect(snapshot.conflicts).toEqual([frozenConflict]);
    expect(shape(snapshot.result)).toEqual([['n1', 'まとめ']]);
  });

  test('fork の後に trunk が別の batch で進めば、それは新しい競合 (O3)', () => {
    const fork = forkOf(frozenConflict, genesis());
    const trunk = [
      ...genesis(),
      setContent('b2', BOB, 3, 'x'),
      setContent('b3', BOB, 4, 'さらに'),
    ];
    const resolution = [setContent('r1', ALICE, 5, 'まとめ')];
    const snapshot = mergerSnapshot(fork, trunk, resolution, everything);
    expect(
      snapshot.conflicts.map((c) => c.ours.batchId as string).sort(),
    ).toEqual(['b3', 't1']);
  });

  test('両側は書いた人の名前で呼び、書いた人が引けない側は「一方」「もう一方」', () => {
    const fork = forkOf(frozenConflict, genesis());
    const named = {
      ...fork,
      origin: {
        ...fork.origin,
        ours: { ...fork.origin.ours, actor: `${BOB}` },
      },
    };
    expect(forkSideLabels(named, (did) => `@${did}`)).toEqual({
      ours: '@did:plc:bob',
      theirs: 'もう一方',
    });
  });
});
