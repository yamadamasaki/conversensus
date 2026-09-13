/**
 * migrateBranchMeta: SQLite に残る branch / commit を trunk の op-log へ載せ直す
 * (step2 Phase 3 T7-6)
 *
 * 設計: `deepse/plans/step2-phase3-t7-branch-sync.md` §5 決定 2・6
 *
 * T7-1 より前の branch / commit のメタは daemon の SQLite の行 (`branches` / `commits`) にしか無い。
 * T7-1 以降は trunk の op-log の畳み込みから読むので、**載せ直さないと古い branch が一覧から消える**
 * (Phase 3 の実 PDS 試験で書いた fork も含む)。
 *
 * ## 何を書くか
 *
 * - **op-log に `branch.create` の無い branch** → `branch.create`、status が open でなければ
 *   `branch.setStatus`。**既に op-log にある branch は触らない** — T7-1 以降の記録が正で、
 *   SQLite の行は古い
 * - **op-log に `commit.add` の無い commit** → `commit.add`。branch のコミットは branch 専用
 *   file_id に、merge コミットは trunk の file_id に保存されていた (T7-1 以前の書き分け)
 *
 * **既存の fork は普通の branch として移る** (決定 6)。SQLite は `conflictKey` / `origin` を
 * 保存していなかった (事実 G) ので、復元できるのは名前・分岐点・status だけである。
 *
 * ## べき等である
 *
 * 判定は**畳み込みの結果ではなく生の op** で行う。畳み込みは削除した branch を結果から
 * 消すので、T7-1 以降に削除した (`branch.remove` はあるが `branch.create` が無い) branch を
 * 「無い」と見て作り直してしまう。生の op で見れば、作り直しは起きない。
 * 仮に 2 台の端末が同じ branch を載せ直しても、畳み込みは `branch.create` の最初の 1 回だけを、
 * commit は id で 1 回だけを数えるので結果は同じになる。
 */

import {
  type Batch,
  BRANCH_STATUS,
  type BranchId,
  type BranchMeta,
  type Commit,
  type FileId,
} from '@conversensus/shared';
import type { BranchMetaRecorder } from './branchMetaLog';

/** 載せ直しの 1 手。この順に記録する (作成 → コミット → status) */
export type BranchMetaMigrationStep =
  | { kind: 'branchCreated'; meta: BranchMeta }
  | { kind: 'commitAdded'; commit: Commit; branchId?: BranchId }
  | { kind: 'statusChanged'; branchId: BranchId; status: BranchMeta['status'] };

export type PlanBranchMetaMigrationInput = {
  /** trunk の op-log (T7-1 以降の記録を含む) */
  trunkBatches: readonly Batch[];
  /** SQLite の branch 行 */
  legacyBranches: readonly BranchMeta[];
  /** SQLite の commit 行。trunk と各 branch 専用 file_id の分 */
  legacyCommits: ReadonlyMap<FileId, readonly Commit[]>;
  trunkFileId: FileId;
};

/** op-log に既に記録されている branch と commit の id (生の op から集める) */
function recordedIds(batches: readonly Batch[]) {
  const branches = new Set<string>();
  const commits = new Set<string>();
  for (const batch of batches) {
    for (const op of batch.ops) {
      if (op.kind === 'branch.create') branches.add(op.target);
      if (op.kind === 'commit.add') commits.add(op.commit.id);
    }
  }
  return { branches, commits };
}

/** SQLite にあって op-log に無いものを、記録する手の列にする。**何も書かない** */
export function planBranchMetaMigration(
  input: PlanBranchMetaMigrationInput,
): BranchMetaMigrationStep[] {
  const recorded = recordedIds(input.trunkBatches);
  const steps: BranchMetaMigrationStep[] = [];
  const commitsOf = (fileId: FileId) =>
    (input.legacyCommits.get(fileId) ?? []).filter(
      (commit) => !recorded.commits.has(commit.id),
    );

  for (const meta of input.legacyBranches) {
    if (meta.trunkFileId !== input.trunkFileId) continue;
    // op-log にある branch は T7-1 以降の記録が正。status も上書きしない
    if (recorded.branches.has(meta.id)) continue;
    steps.push({ kind: 'branchCreated', meta });
    for (const commit of commitsOf(meta.branchFileId)) {
      steps.push({ kind: 'commitAdded', commit, branchId: meta.id });
    }
    if (meta.status !== BRANCH_STATUS.OPEN) {
      steps.push({
        kind: 'statusChanged',
        branchId: meta.id,
        status: meta.status,
      });
    }
  }
  // merge コミットは trunk の file_id に保存されていた。branchId を付けない = trunk のコミット
  for (const commit of commitsOf(input.trunkFileId)) {
    steps.push({ kind: 'commitAdded', commit });
  }
  return steps;
}

/** 手の列を記録口で書く */
export function applyBranchMetaMigration(
  steps: readonly BranchMetaMigrationStep[],
  recorder: BranchMetaRecorder,
): void {
  for (const step of steps) {
    switch (step.kind) {
      case 'branchCreated':
        recorder.branchCreated(step.meta);
        break;
      case 'commitAdded':
        recorder.commitAdded(step.commit, step.branchId);
        break;
      case 'statusChanged':
        recorder.statusChanged(step.branchId, step.status);
        break;
    }
  }
}

export type MigrateBranchMetaDeps = {
  fetchBatches: (fileId: FileId) => Promise<Batch[]>;
  /** SQLite の branch 行 (`GET /files/:id/branches`) */
  fetchLegacyBranches: (trunkFileId: FileId) => Promise<BranchMeta[]>;
  /** SQLite の commit 行 (`GET /files/:id/commits`) */
  fetchLegacyCommits: (fileId: FileId) => Promise<Commit[]>;
  recorder: BranchMetaRecorder;
};

export type MigrateBranchMetaResult = {
  /** 載せ直した branch */
  branches: BranchMeta[];
  /** 載せ直した commit 数 */
  commits: number;
};

/**
 * 1 つの trunk について載せ直す。
 *
 * **すべて読んでから書く。**途中で読み出しが失敗したら何も書かずに投げる — 半分だけ
 * 載せ直すと、後から載る commit が先に書かれた branch に紐づかない形は起きないが、
 * 失敗の原因 (daemon 障害) を記録の途中に混ぜないためである。次の契機で再試行する。
 */
export async function migrateBranchMeta(
  trunkFileId: FileId,
  deps: MigrateBranchMetaDeps,
): Promise<MigrateBranchMetaResult> {
  const [trunkBatches, legacyBranches] = await Promise.all([
    deps.fetchBatches(trunkFileId),
    deps.fetchLegacyBranches(trunkFileId),
  ]);
  const fileIds = [
    trunkFileId,
    ...legacyBranches.map((meta) => meta.branchFileId),
  ];
  const legacyCommits = new Map<FileId, Commit[]>(
    await Promise.all(
      fileIds.map(
        async (fileId) =>
          [fileId, await deps.fetchLegacyCommits(fileId)] as const,
      ),
    ),
  );
  const steps = planBranchMetaMigration({
    trunkBatches,
    legacyBranches,
    legacyCommits,
    trunkFileId,
  });
  applyBranchMetaMigration(steps, deps.recorder);
  return {
    branches: steps.flatMap((step) =>
      step.kind === 'branchCreated' ? [step.meta] : [],
    ),
    commits: steps.filter((step) => step.kind === 'commitAdded').length,
  };
}
