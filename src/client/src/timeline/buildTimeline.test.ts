import { describe, expect, test } from 'bun:test';
import {
  type Batch,
  BRANCH_STATUS,
  type BranchId,
  COMMIT_KIND,
  type Commit,
  type CommitId,
  type FileId,
  foldBranches,
  type NodeId,
  type Op,
  type SheetId,
} from '@conversensus/shared';
import fc from 'fast-check';
import {
  buildTimeline,
  type ChangePoint,
  cutOfBatch,
  type TimelineLane,
  touchedElements,
} from './buildTimeline';

const A = 'did:plc:alice#d1';
/** File を作った actor (genesis)。branch の commit の vector には現れない */
const G = 'did:plc:alice#genesis';
const TRUNK = '00000000-0000-4000-8000-0000000000f1' as FileId;
const BRANCH_FILE = '00000000-0000-4000-8000-0000000000f2' as FileId;
const SHEET = '00000000-0000-4000-8000-0000000000a1' as SheetId;
const OTHER_SHEET = '00000000-0000-4000-8000-0000000000a2' as SheetId;
const B1 = '00000000-0000-4000-8000-0000000000b1' as BranchId;

const addNode = (id: string): Op => ({
  kind: 'node.add',
  target: id as NodeId,
  content: id,
});
const setContent = (id: string): Op => ({
  kind: 'node.setContent',
  target: id as NodeId,
  content: `${id}'`,
});

/** alice が seq 順に書いた batch。deps は自分しか居ないので空 */
const batch = (seq: number, ops: Op[], over: Partial<Batch> = {}): Batch => ({
  id: `batch-${seq}` as Batch['id'],
  actor: A,
  clock: seq,
  seq,
  deps: {},
  timestamp: 1_700_000_000_000 + seq,
  sheetId: SHEET,
  ops,
  ...over,
});

const commit = (
  id: string,
  at: number,
  upTo: number,
  over: Partial<Commit> = {},
): Commit => ({
  id: id as CommitId,
  message: id,
  at,
  authorActor: A,
  kind: COMMIT_KIND.COMMIT,
  vector: { [A]: upTo },
  ...over,
});

/**
 * trunk に n1・n2 を置き、b1 を切り (分岐点は seq 2 まで)、trunk で n1 を変える。b1 で n3 を置いて
 * commit し、n4 を置いて merge する。merge の写し (n3, n4) は trunk に載る。別のシートの編集も混ぜる
 */
function scenario() {
  const trunk: Batch[] = [
    batch(1, [addNode('n1')]),
    batch(2, [addNode('n2')]),
    batch(
      3,
      [
        {
          kind: 'branch.create',
          target: B1,
          name: 'b1',
          sheetId: SHEET,
          branchFileId: BRANCH_FILE,
          base: commit('base', 3, 2, { vector: { [G]: 1, [A]: 2 } }),
        },
      ],
      { sheetId: undefined },
    ),
    batch(4, [setContent('n1')]),
    batch(
      7,
      [{ kind: 'commit.add', branchId: B1, commit: commit('c1', 7, 6) }],
      { sheetId: undefined },
    ),
    batch(
      9,
      [
        {
          kind: 'commit.add',
          commit: commit('m1', 9, 8, {
            kind: COMMIT_KIND.MERGE,
            sourceBranchId: B1,
          }),
        },
        { kind: 'branch.setStatus', target: B1, status: BRANCH_STATUS.MERGED },
      ],
      { sheetId: undefined },
    ),
    batch(10, [addNode('n3'), addNode('n4')], {
      mergedIn: 'm1' as CommitId,
      copyOf: { actor: A, seq: 5 },
    }),
    batch(11, [addNode('x')], { sheetId: OTHER_SHEET }),
  ];
  const branch: Batch[] = [
    batch(5, [addNode('n3')]),
    batch(6, [setContent('n3')]),
    batch(8, [addNode('n4')]),
  ];
  return { trunk, branch };
}

/** 線を読みやすい形にする: operation point は種類と名前、change point の続きは seq の並び */
function shape(lane: TimelineLane): string[] {
  return lane.entries.map((e) => {
    if (e.kind === 'changes')
      return `changes(${e.points.map((p) => p.batch.seq).join(',')})`;
    const p = e.point;
    return p.kind === 'branch'
      ? `branch:${p.branch.name}`
      : `${p.kind}:${p.commit.id}`;
  });
}

function build(focus?: { nodeIds: string[]; edgeIds?: string[] }) {
  const { trunk, branch } = scenario();
  return buildTimeline({
    sheetId: SHEET,
    trunk,
    fold: foldBranches(trunk, TRUNK),
    branchBatches: new Map([[B1, branch]]),
    ...(focus && {
      focus: {
        nodeIds: new Set(focus.nodeIds),
        edgeIds: new Set(focus.edgeIds ?? []),
      },
    }),
  });
}

describe('buildTimeline (#73 T1)', () => {
  test('trunk と branch の線に、operation point と畳んだ change point を op-log の順に並べる', () => {
    const [trunk, b1] = build();
    expect(trunk?.name).toBe('trunk');
    expect(shape(trunk as TimelineLane)).toEqual([
      'changes(1,2)',
      'branch:b1',
      'changes(4)',
      'merge:m1',
    ]);
    expect(b1?.name).toBe('b1');
    expect(b1?.status).toBe(BRANCH_STATUS.MERGED);
    expect(shape(b1 as TimelineLane)).toEqual([
      'changes(5,6)',
      'commit:c1',
      'changes(8)',
    ]);
  });

  test('merge の写しと、別のシートの編集は change point にしない', () => {
    const [trunk] = build();
    const seqs = (trunk as TimelineLane).entries.flatMap((e) =>
      e.kind === 'changes' ? e.points.map((p) => p.batch.seq) : [],
    );
    expect(seqs).not.toContain(10);
    expect(seqs).not.toContain(11);
  });

  test('選んだ要素に触れた change point だけを残す。operation point は残す', () => {
    const [trunk, b1] = build({ nodeIds: ['n1'] });
    expect(shape(trunk as TimelineLane)).toEqual([
      'changes(1)',
      'branch:b1',
      'changes(4)',
      'merge:m1',
    ]);
    expect(shape(b1 as TimelineLane)).toEqual(['commit:c1']);
  });

  test('operation point は切断面を持つ (分岐点は base の vector)', () => {
    const [trunk] = build();
    const ops = (trunk as TimelineLane).entries.flatMap((e) =>
      e.kind === 'operation' ? [e.point] : [],
    );
    expect(ops.map((p) => p.cut)).toEqual([{ [G]: 1, [A]: 2 }, { [A]: 8 }]);
  });

  test('branch の上の点の切断面は、分岐点の切断面と合わせる (commit の vector は branch の op-log だけから作られる)', () => {
    const [, b1] = build();
    const points = (b1 as TimelineLane).entries.flatMap((e) =>
      e.kind === 'operation' ? [e.point.cut] : e.points.map((p) => p.cut),
    );
    // commit c1 と change point のどれも、genesis の actor を含む
    for (const cut of points) expect(cut?.[G]).toBe(1);
    const commitCut = (b1 as TimelineLane).entries.find(
      (e) => e.kind === 'operation',
    );
    expect(
      commitCut?.kind === 'operation' ? commitCut.point.cut : null,
    ).toEqual({ [G]: 1, [A]: 6 });
  });

  test('operation point の時刻は、その op を運んだ batch の壁時計', () => {
    const [trunk, b1] = build();
    const times = [trunk, b1].flatMap((lane) =>
      (lane as TimelineLane).entries.flatMap((e) =>
        e.kind === 'operation' ? [e.point.timestamp] : [],
      ),
    );
    const at = (seq: number) => 1_700_000_000_000 + seq;
    // 分岐 (batch 3)、merge (batch 9)、commit (batch 7)
    expect(times).toEqual([at(3), at(9), at(7)]);
  });

  test('関係する要素: commit は直前からの変更、merge は取り込んだ写し、分岐は無し', () => {
    const [trunk, b1] = build();
    const touched = (lane: TimelineLane | undefined) =>
      (lane as TimelineLane).entries.flatMap((e) =>
        e.kind === 'operation'
          ? [[e.point.kind, [...e.point.touched.nodeIds].sort()]]
          : [],
      );
    expect(touched(trunk)).toEqual([
      ['branch', []],
      ['merge', ['n3', 'n4']],
    ]);
    expect(touched(b1)).toEqual([['commit', ['n3']]]);
  });

  test('絞っても commit の関係する要素は変わらない (絞る前の変更から求める)', () => {
    const [, b1] = build({ nodeIds: ['n1'] });
    const commitPoint = (b1 as TimelineLane).entries.find(
      (e) => e.kind === 'operation',
    );
    expect(
      commitPoint?.kind === 'operation'
        ? [...commitPoint.point.touched.nodeIds]
        : [],
    ).toEqual(['n3']);
  });

  test('fork と、開いていない (閉じた) branch は出さない', () => {
    const { trunk } = scenario();
    const fold = foldBranches(trunk, TRUNK);
    const b1 = fold.branches.get(B1);
    if (!b1) throw new Error('b1 が無い');
    const closed = { ...b1, status: BRANCH_STATUS.CLOSED };
    const fork = {
      ...b1,
      id: 'fork' as BranchId,
      conflictKey: 'k',
      origin: {},
    };
    const lanes = buildTimeline({
      sheetId: SHEET,
      trunk,
      fold: {
        ...fold,
        branches: new Map<BranchId, typeof b1>([
          [B1, closed],
          ['fork' as BranchId, fork as typeof b1],
        ]),
      },
      branchBatches: new Map(),
    });
    expect(lanes.map((l) => l.name)).toEqual(['trunk']);
  });

  test('cutOfBatch: 書いた人が見ていたもの + その batch', () => {
    expect(
      cutOfBatch(batch(5, [addNode('n')], { deps: { 'did:plc:bob#d1': 3 } })),
    ).toEqual({ 'did:plc:bob#d1': 3, [A]: 5 });
  });

  test('touchedElements: node と edge の op の対象を分けて集める', () => {
    const touched = touchedElements(
      batch(1, [addNode('n1'), { kind: 'edge.remove', target: 'e1' as never }]),
    );
    expect([...touched.nodeIds]).toEqual(['n1']);
    expect([...touched.edgeIds]).toEqual(['e1']);
  });

  /**
   * 性質: どう絞っても (要素の部分集合)、
   * - 線の change point は、グラフを変えるこのシートの batch のうち絞りに触れたもの**ちょうど**である (落とさず、重ねない)
   * - operation point の並びは絞りによらない
   */
  test('性質: change point は絞りに触れた batch ちょうどで、operation point は絞りによらない', () => {
    const all = build();
    const opsOf = (lanes: TimelineLane[]) =>
      lanes.map((l) => shape(l).filter((s) => !s.startsWith('changes')));
    const changesOf = (lanes: TimelineLane[]) =>
      lanes.flatMap((l) =>
        l.entries.flatMap((e) =>
          e.kind === 'changes'
            ? e.points.map((p: ChangePoint) => p.batch.seq)
            : [],
        ),
      );
    const allChanges = changesOf(all);
    const { trunk, branch } = scenario();
    const bySeq = new Map([...trunk, ...branch].map((b) => [b.seq, b]));
    fc.assert(
      fc.property(fc.subarray(['n1', 'n2', 'n3', 'n4']), (nodeIds) => {
        const lanes = build({ nodeIds });
        expect(opsOf(lanes)).toEqual(opsOf(all));
        const expected = allChanges.filter((seq) => {
          const b = bySeq.get(seq);
          return b
            ? [...touchedElements(b).nodeIds].some((id) => nodeIds.includes(id))
            : false;
        });
        expect(changesOf(lanes)).toEqual(expected);
      }),
    );
  });
});
