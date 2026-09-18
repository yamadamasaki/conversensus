/**
 * branch / commit のメタを trunk の op-log に記録し、そこから読む (step2 Phase 3 T7-1)
 *
 * 設計: `deepse/plans/step2-phase3-t7-branch-sync.md`
 *
 * これまで branch のメタは daemon の SQLite の行で、**相手に届かなかった**。しかも fork は
 * 保存の時点で `conflictKey` と `origin` を失っていた (設計 事実 G)。T7 では file 構造と
 * 同じく **trunk の tap に event を記録する**。tap が op-log と remote へ流すので、同期は
 * グラフの編集と同じ経路で成立し、読み出しは trunk を `foldBranches` で畳むだけになる。
 *
 * ## 名前を CRUD にしない
 *
 * 以前の口は `saveBranch(meta)` だった。同じ関数が「作成」も「状態の変更」も表していたので、
 * op にするには差分から意図を推し量るしかない。**記録する出来事ごとに口を分ける。**
 */

import {
  type Batch,
  type BranchFold,
  type BranchId,
  type BranchMeta,
  type BranchStatus,
  type Commit,
  type FileId,
  foldBranches,
} from '@conversensus/shared';
import { type GraphEvent, makeEventBase } from '../events/GraphEvent';

/** branch のメタを trunk の op-log に記録する口 */
export type BranchMetaRecorder = {
  /** branch を切った。fork (`ForkMeta`) もこの口で書く */
  branchCreated: (meta: BranchMeta) => void;
  statusChanged: (branchId: BranchId, status: BranchStatus) => void;
  /** 一度消したら戻らない */
  removed: (branchId: BranchId) => void;
  /** `branchId` を省けば trunk のコミット (merge を含む) */
  commitAdded: (commit: Commit, branchId?: BranchId) => void;
};

/**
 * trunk の tap の `record` から記録口を作る。
 *
 * **sheetId を渡さない** — これらは file 構造の batch である。sheetId を付けると
 * content batch として扱われ、そのシートの projection に混ざる。
 */
export function branchMetaRecorder(
  record: (event: GraphEvent) => void,
): BranchMetaRecorder {
  return {
    branchCreated: (meta) =>
      record({ ...makeEventBase('file'), type: 'BRANCH_CREATED', meta }),
    statusChanged: (branchId, status) =>
      record({
        ...makeEventBase('file'),
        type: 'BRANCH_STATUS_CHANGED',
        branchId,
        status,
      }),
    removed: (branchId) =>
      record({ ...makeEventBase('file'), type: 'BRANCH_REMOVED', branchId }),
    commitAdded: (commit, branchId) =>
      record({
        ...makeEventBase('file'),
        type: 'COMMIT_ADDED',
        commit,
        ...(branchId !== undefined && { branchId }),
      }),
  };
}

/** trunk の op-log を畳んで branch / commit のメタを読む */
export async function readBranchMeta(
  fetchBatches: (fileId: FileId) => Promise<Batch[]>,
  trunkFileId: FileId,
): Promise<BranchFold> {
  return foldBranches(await fetchBatches(trunkFileId), trunkFileId);
}
