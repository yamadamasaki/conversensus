/**
 * merger の姿 (step3 Phase 5 S5-0, 仕様 merger)
 *
 * merger は 3 つの姿を並べる:
 *
 * - **merge 元** = merge する branch を、merger を開いた時点 (`startedAt`) で切った姿 (Q4)。解決の編集は
 *   branch 自身に積む (Q1) ので、最新を見せると元の姿が編集に追随してしまう
 * - **merge 先** = trunk の最新 (動く。merge 先が進めば作り直す, O3)
 * - **merge 後** = trunk の最新 + branch の最新を、**実際の merge と同じ手順で**重ねた姿 (Q2)。
 *   実際の merge は branch の (まだ写していない) batch を trunk の先端より後の点で写して足す
 *   (`mergeBranchOnOplog`)。ここでは同じ計画 (`planMerge`) を使い、点だけを仮に振って projection する
 *
 * 競合は実際の merge が検出するものと同じ (`planMerge` の `conflicts`)。
 */

import {
  type Batch,
  type BatchId,
  type BranchMeta,
  conflictKeyOf,
  type MergeConflict,
  projectAddress,
  projectFile,
  type Sheet,
  tipClock,
  type VersionVector,
} from '@conversensus/shared';
import { labelsOfConflicts } from './conflicts';
import { originOf, planMerge } from './mergeBranch';

/** 仮の写しの actor。実際の merge では merge した人の actor になる */
const PREVIEW_ACTOR = 'merger-preview';

export type MergerSnapshot = {
  source: Sheet | undefined;
  target: Sheet | undefined;
  result: Sheet | undefined;
  conflicts: MergeConflict[];
  /** 競合の対象の**分岐点での名前** (消された要素は今のグラフに居ない) */
  labels: Map<string, string>;
};

/**
 * 実際の merge が足す写しを、仮の点で作る。点は trunk と branch の両方の先端より後にする —
 * 実際の merge も発番器を両方に追随させてから振る (`mergeBranchOnOplog`)
 */
function previewCopies(toAppend: Batch[], trunk: Batch[], branch: Batch[]) {
  const after = Math.max(tipClock(trunk), tipClock(branch));
  return toAppend.map((batch, i): Batch => {
    const { copyOf: _nested, mergedIn: _previous, ...content } = batch;
    return {
      ...content,
      id: `merger-preview-${i}` as BatchId,
      actor: PREVIEW_ACTOR,
      clock: after + i + 1,
      seq: i + 1,
      deps: {},
      copyOf: originOf(batch),
    };
  });
}

export function mergerSnapshot(
  meta: BranchMeta,
  trunk: Batch[],
  branch: Batch[],
  startedAt: VersionVector,
): MergerSnapshot {
  const fileId = meta.trunkFileId;
  const sheetOf = (batches: Batch[]) =>
    projectFile(batches, fileId).sheets.find((s) => s.id === meta.sheetId);
  const plan = planMerge(meta, trunk, branch);
  return {
    source: projectAddress(
      { fileId, sheetId: meta.sheetId, branchId: meta.id, cut: startedAt },
      { trunk, branch: { branch: meta, batches: branch } },
    ),
    target: sheetOf(trunk),
    result: sheetOf([...trunk, ...previewCopies(plan.toAppend, trunk, branch)]),
    conflicts: plan.conflicts,
    labels: labelsOfConflicts(plan.base, plan.conflicts),
  };
}

/**
 * チェック状態を引き継ぐ (S5-2)。**いまの競合に残っている鍵だけを残す** — merge 先が進んで一覧を
 * 作り直しても、解消済みとした競合のチェックは残り、消えた競合のチェックは捨て、新しい競合は未チェック
 */
export function carryChecks(
  checked: readonly string[],
  conflicts: readonly MergeConflict[],
): string[] {
  const present = new Set(conflicts.map(conflictKeyOf));
  return checked.filter((key) => present.has(key));
}

/** すべての競合にチェックが入ったか (merge ボタンを押せるか) */
export function allChecked(
  checked: readonly string[],
  conflicts: readonly MergeConflict[],
): boolean {
  const done = new Set(checked);
  return conflicts.every((c) => done.has(conflictKeyOf(c)));
}
