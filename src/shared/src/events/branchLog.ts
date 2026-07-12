/**
 * ブランチ/コミットのログドメイン (step1 Phase 2)
 *
 * O3 spike の Go 判定に基づく再定義:
 *   - コミット = 操作ログ上の**ラベル付きオフセット** (どの clock までを含むか)
 *   - ブランチ = base コミット + そのブランチで追記された batches
 *   - ブランチの sheet = base までの trunk batches + branch batches の projection
 *
 * 現行 `branchState.ts` の rkey 複製方式 (createMainBranch/createBranch/
 * fetchBranchSheetFromPds/mergeBranchToTrunk 等) のドメイン概念を置換する。
 * PDS I/O (sync-provider への退避分) は含めない (Phase 4)。
 */

import type { BranchId, CommitId, Sheet, SheetId } from '../schemas';
import { projectBatches, toSheet } from './project';
import type { Batch, Lamport } from './unified';

export const BRANCH_STATUS = {
  CREATING: 'creating',
  OPEN: 'open',
  MERGED: 'merged',
  CLOSED: 'closed',
} as const;
export type BranchStatus = (typeof BRANCH_STATUS)[keyof typeof BRANCH_STATUS];

/** コミット = 操作ログ上のラベル付きオフセット */
export type Commit = {
  id: CommitId;
  message: string;
  /** このコミットが指すログ位置。clock <= at の batch を含む */
  at: Lamport;
  authorActor: string;
};

/** ブランチ = base コミットからの分岐 */
export type Branch = {
  id: BranchId;
  name: string;
  base: Commit;
  status: BranchStatus;
};

/** batches 中の最大 clock (= 現在のログ先端)。空なら 0 */
export function tipClock(batches: Batch[]): Lamport {
  return batches.reduce((max, b) => Math.max(max, b.clock), 0);
}

/** 現在のログ先端にラベル付きコミット (オフセット) を作る */
export function makeCommit(
  id: CommitId,
  message: string,
  authorActor: string,
  batches: Batch[],
): Commit {
  return { id, message, at: tipClock(batches), authorActor };
}

/** base コミット時点までの batches (clock <= base.at) を切り出す */
export function batchesUpTo(batches: Batch[], commit: Commit): Batch[] {
  return batches.filter((b) => b.clock <= commit.at);
}

/**
 * ブランチの sheet を導出する。
 * base 時点の trunk batches に、ブランチ側 batches を重ねて projection する。
 */
export function branchSheet(
  branch: Branch,
  trunkBatches: Batch[],
  branchBatches: Batch[],
  meta: { id: SheetId; name: string; description?: string },
): Sheet {
  const base = batchesUpTo(trunkBatches, branch.base);
  return toSheet(projectBatches([...base, ...branchBatches]), meta);
}
