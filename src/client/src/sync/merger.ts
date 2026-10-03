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
  type MergeConflict,
  projectAddress,
  projectFile,
  type Sheet,
  tipClock,
  type VersionVector,
} from '@conversensus/shared';
import { computeSheetChanges } from './computeOperations';
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
    conflicts: mergerConflicts(plan.conflicts),
    labels: labelsOfConflicts(plan.base, plan.conflicts),
  };
}

/**
 * conflict list のチェックの鍵 (step3 Phase 5)。種別・対象・揉めた単位と、**merge 先 (trunk) 側の batch**
 * から作る。
 *
 * `conflictKeyOf` (fork の同一性) は両側の batch を含むが、merger では branch 側の batch は**利用者自身の
 * 解決の編集で変わる** — 競合した本文を直すと、その op と trunk の op の組が新しい競合として現れる。それを
 * 別の競合とみなすと、解決の編集をするたびにチェックが外れて merge できない。trunk 側が進んだ (新しい
 * batch になった) ときだけ鍵が変わり、もう一度チェックが要る (仕様: merge 先が進んで再び競合が起きる, O3)
 */
export function mergerCheckKey(conflict: MergeConflict): string {
  const about =
    conflict.category === 'layout'
      ? conflict.aspect
      : (conflict.propertyName ?? '');
  return [
    conflict.category,
    conflict.target,
    about,
    conflict.ours.batchId,
  ].join('\u0000');
}

/**
 * conflict list に並べる競合。**チェックの鍵でまとめる** — 同じ対象に branch の op が複数あれば、
 * 競合は op の数だけ検出されるが、利用者にとっては 1 つである。残すのは最後の (いちばん新しい
 * branch 側の) もの
 */
export function mergerConflicts(
  conflicts: readonly MergeConflict[],
): MergeConflict[] {
  const byKey = new Map<string, MergeConflict>();
  for (const c of conflicts) byKey.set(mergerCheckKey(c), c);
  return [...byKey.values()];
}

/**
 * チェック状態を引き継ぐ (S5-2)。**いまの競合に残っている鍵だけを残す** — merge 先が進んで一覧を
 * 作り直しても、解消済みとした競合のチェックは残り、消えた競合のチェックは捨て、新しい競合は未チェック
 */
export function carryChecks(
  checked: readonly string[],
  conflicts: readonly MergeConflict[],
): string[] {
  const present = new Set(conflicts.map(mergerCheckKey));
  return checked.filter((key) => present.has(key));
}

/** すべての競合にチェックが入ったか (merge ボタンを押せるか) */
export function allChecked(
  checked: readonly string[],
  conflicts: readonly MergeConflict[],
): boolean {
  const done = new Set(checked);
  return conflicts.every((c) => done.has(mergerCheckKey(c)));
}

/** pane に付ける差分の印 (step3 Phase 5 S5-1b)。branch の表示と同じ色分けに使う */
export type DiffMarks = {
  addedNodes: Set<string>;
  updatedNodes: Set<string>;
  addedEdges: Set<string>;
  updatedEdges: Set<string>;
};

/**
 * `current` が `base` に比べて足した・変えた要素 (仕様: merge 元/先は互いとの差分、merge 後は merge 先との
 * 差分を、通常の branch と同様の方法で表示する)。消えた要素は `current` に居ないので印を付けない
 */
export function diffMarks(base: Sheet, current: Sheet): DiffMarks {
  const marks: DiffMarks = {
    addedNodes: new Set(),
    updatedNodes: new Set(),
    addedEdges: new Set(),
    updatedEdges: new Set(),
  };
  for (const { op } of computeSheetChanges(base, current)) {
    if (op.op === 'node.add') marks.addedNodes.add(op.nodeId);
    else if (op.op === 'node.update') marks.updatedNodes.add(op.nodeId);
    else if (op.op === 'edge.add') marks.addedEdges.add(op.edgeId);
    else if (op.op === 'edge.update') marks.updatedEdges.add(op.edgeId);
  }
  return marks;
}

/** 競合している要素の id (merge 元/先で点線で囲う) */
export function conflictTargets(
  conflicts: readonly MergeConflict[],
): Set<string> {
  return new Set(conflicts.map((c) => c.target));
}
