import { describe, expect, test } from 'bun:test';
import {
  type BranchId,
  BranchIdSchema,
  type CommitId,
  CommitIdSchema,
  type NodeId,
  NodeIdSchema,
  type SheetId,
  SheetIdSchema,
} from '../schemas';
import {
  type Branch,
  batchesUpTo,
  branchSheet,
  isUpTo,
  makeBaseCommit,
  makeCommit,
  makeMergeCommit,
  tipClock,
} from './branchLog';
import {
  type Batch,
  BatchIdSchema,
  BRANCH_STATUS,
  COMMIT_KIND,
  type Op,
} from './unified';

const nid = (): NodeId => NodeIdSchema.parse(crypto.randomUUID());
const cid = (): CommitId => CommitIdSchema.parse(crypto.randomUUID());
const bid = (): BranchId => BranchIdSchema.parse(crypto.randomUUID());

function batch(clock: number, ops: Op[]): Batch {
  return {
    id: BatchIdSchema.parse(crypto.randomUUID()),
    actor: 'local',
    clock,
    seq: clock,
    deps: {},
    timestamp: clock,
    ops,
  };
}

describe('tipClock / makeCommit / batchesUpTo', () => {
  test('tipClock は最大 clock を返す (空なら 0)', () => {
    expect(tipClock([])).toBe(0);
    expect(tipClock([batch(3, []), batch(7, []), batch(5, [])])).toBe(7);
  });

  test('makeCommit は現在の先端を指すラベル付きオフセットを作る', () => {
    const batches = [batch(2, []), batch(5, [])];
    const commit = makeCommit(cid(), 'wip', 'did:example:alice', batches);
    expect(commit.at).toBe(5);
    expect(commit.message).toBe('wip');
    // 種別は既定で通常のコミット。merge だけが別種になる (ANA-122)
    expect(commit.kind).toBe(COMMIT_KIND.COMMIT);
    expect(commit.sourceBranchId).toBeUndefined();
  });

  test('makeMergeCommit は trunk 先端と branch 側の取り込み位置を両方指す', () => {
    // 🔴 `at` (trunk) と `sourceAt` (branch) は**別系列の clock**。片方だけでは
    // 「trunk のどこに、branch のどこまでを」取り込んだかを復元できない。
    const trunkAfterMerge = [batch(2, []), batch(9, [])];
    const branchId = bid();
    const merge = makeMergeCommit(
      cid(),
      '案A を採用',
      'did:example:alice',
      trunkAfterMerge,
      { branchId, at: 4 },
    );
    expect(merge.kind).toBe(COMMIT_KIND.MERGE);
    expect(merge.at).toBe(9);
    expect(merge.sourceAt).toBe(4);
    expect(merge.sourceBranchId).toBe(branchId);
  });

  test('batchesUpTo は base コミット時点までの batches を切り出す', () => {
    const batches = [batch(1, []), batch(3, []), batch(5, [])];
    const commit = makeCommit(cid(), 'base', 'local', [batch(3, [])]);
    expect(batchesUpTo(batches, commit).map((b) => b.clock)).toEqual([1, 3]);
  });
});

describe('branchSheet', () => {
  test('base 時点の trunk にブランチ変更を重ねて sheet を導出する', () => {
    const a = nid();
    const b = nid();
    // trunk: clock1 で A 追加, clock2 で A を 'A-trunk' に (base より後 = ブランチには含めない)
    const trunkBatches = [
      batch(1, [{ kind: 'node.add', target: a, content: 'A' }]),
      batch(2, [{ kind: 'node.setContent', target: a, content: 'A-trunk' }]),
    ];
    // base コミットは clock 1 時点
    const base = makeCommit(cid(), 'base', 'local', [batch(1, [])]);
    const branch: Branch = {
      id: bid(),
      name: 'feature',
      base,
      status: BRANCH_STATUS.OPEN,
    };
    // ブランチ側: B 追加 + A を 'A-branch' に
    const branchBatches = [
      batch(3, [
        { kind: 'node.add', target: b, content: 'B' },
        { kind: 'node.setContent', target: a, content: 'A-branch' },
      ]),
    ];
    const sheetId: SheetId = SheetIdSchema.parse(crypto.randomUUID());
    const sheet = branchSheet(branch, trunkBatches, branchBatches, {
      id: sheetId,
      name: 'S',
    });

    // base は clock<=1 なので trunk の clock2 変更 (A-trunk) は含まれない
    // → ブランチ側の A-branch が見える
    const nodeA = sheet.nodes.find((n) => n.id === a);
    expect(nodeA?.content).toBe('A-branch');
    expect(sheet.nodes.some((n) => n.id === b)).toBe(true);
  });
});

/**
 * 分岐点を vector で切る (step3 Phase 1 D3)。scalar の `at` で切ると、分岐時には持っていなかった
 * batch が clock の小ささだけで後から base に入る (step3-entry §2.1)
 */
describe('makeBaseCommit / isUpTo: 分岐点は vector で切る', () => {
  const pointOf = (actor: string, seq: number, clock: number): Batch => ({
    ...batch(clock, []),
    actor,
    seq,
  });

  test('🔴 分岐後に届いた、clock の小さい別の actor の batch は base に入らない', () => {
    const held = [pointOf('alice', 1, 1), pointOf('bob', 1, 5)];
    const base = makeBaseCommit(cid(), 'base', 'alice', held);
    // carol の batch は分岐時には手元に無かった。clock 2 は base.at (5) より小さい
    const late = pointOf('carol', 1, 2);
    expect(late.clock).toBeLessThan(base.at);
    expect(isUpTo(base, late)).toBe(false);
    // scalar で切っていた頃の答え (比較のため): これが穴だった
    expect(late.clock <= base.at).toBe(true);
  });

  test('分岐時に持っていた batch は base に入る', () => {
    const held = [pointOf('alice', 1, 1), pointOf('bob', 1, 5)];
    const base = makeBaseCommit(cid(), 'base', 'alice', held);
    expect(batchesUpTo(held, base)).toHaveLength(2);
  });

  test('同じ actor の、分岐時より後の seq は base に入らない', () => {
    const base = makeBaseCommit(cid(), 'base', 'alice', [
      pointOf('bob', 1, 1),
      pointOf('bob', 2, 2),
    ]);
    expect(isUpTo(base, pointOf('bob', 3, 1))).toBe(false);
  });

  /**
   * 歯抜けは恒久的に生じうる — 参加期間のフィルタは離脱中の batch を取り込まない。
   * 歯抜けで止まると (`contiguousFrontier`)、戻ってきた人のその後の編集が base に入らなくなる
   */
  test('歯抜けがあっても、持っていた最大の seq まで base に入る', () => {
    const held = [pointOf('bob', 1, 1), pointOf('bob', 3, 7)];
    const base = makeBaseCommit(cid(), 'base', 'alice', held);
    expect(base.vector).toEqual({ bob: 3 });
    expect(batchesUpTo(held, base)).toHaveLength(2);
  });

  test('vector を持たない古いコミットは clock で切る', () => {
    const { vector: _, ...legacy } = makeCommit(cid(), 'c', 'alice', [
      pointOf('alice', 1, 3),
    ]);
    expect(isUpTo(legacy, pointOf('bob', 9, 3))).toBe(true);
    expect(isUpTo(legacy, pointOf('bob', 1, 4))).toBe(false);
  });

  /**
   * step3 Phase 3 S3-1: 「merge も切断面の一つ」。分岐点だけでなく通常の commit と
   * merge の commit も vector で切る。clock で切ると、遅れて届いた別の actor の batch が
   * clock が小さいというだけで「その時点」に入る (分岐点で Phase 1 が直したのと同じずれ)
   */
  test('通常の commit も vector で切る (遅れて届いた別の actor の batch は入らない)', () => {
    const commit = makeCommit(cid(), 'c', 'alice', [pointOf('alice', 1, 3)]);
    expect(commit.vector).toEqual({ alice: 1 });
    // clock は小さいがコミット時点には持っていなかった
    expect(isUpTo(commit, pointOf('bob', 1, 2))).toBe(false);
    expect(isUpTo(commit, pointOf('alice', 1, 3))).toBe(true);
  });

  test('merge の commit は追記後の trunk の切断面を持つ', () => {
    const trunk = [pointOf('alice', 1, 1), pointOf('bob', 2, 4)];
    const merge = makeMergeCommit(cid(), 'm', 'alice', trunk, {
      branchId: bid(),
      at: 4,
    });
    expect(merge.vector).toEqual({ alice: 1, bob: 2 });
    expect(batchesUpTo(trunk, merge)).toHaveLength(2);
  });
});
