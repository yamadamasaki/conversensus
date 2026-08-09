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
  BRANCH_STATUS,
  type Branch,
  batchesUpTo,
  branchSheet,
  COMMIT_KIND,
  makeCommit,
  makeMergeCommit,
  tipClock,
} from './branchLog';
import { type Batch, BatchIdSchema, type Op } from './unified';

const nid = (): NodeId => NodeIdSchema.parse(crypto.randomUUID());
const cid = (): CommitId => CommitIdSchema.parse(crypto.randomUUID());
const bid = (): BranchId => BranchIdSchema.parse(crypto.randomUUID());

function batch(clock: number, ops: Op[]): Batch {
  return {
    id: BatchIdSchema.parse(crypto.randomUUID()),
    actor: 'local',
    clock,
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
