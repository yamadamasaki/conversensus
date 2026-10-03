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
  type Did,
  didFromActor,
  type ForkMeta,
  isFork,
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

/**
 * fork が凍結した競合の記述を、merger の競合の形に戻す (S5-3)。両側の batch と op は記述に焼き込まれている
 * (相手の batch が後から引けるとは限らない, `ForkSide`)
 */
export function conflictOfFork(fork: ForkMeta): MergeConflict {
  const { origin } = fork;
  const base = {
    target: origin.target,
    ...(origin.propertyName !== undefined && {
      propertyName: origin.propertyName,
    }),
    ours: { batchId: origin.ours.batchId, op: origin.ours.op },
    theirs: { batchId: origin.theirs.batchId, op: origin.theirs.op },
  };
  if (origin.category === 'layout') {
    return { ...base, category: 'layout', aspect: origin.aspect ?? 'position' };
  }
  if (origin.category === 'structure') {
    return {
      ...base,
      category: 'structure',
      kind: origin.kind ?? 'parallelChange',
    };
  }
  return { ...base, category: 'content' };
}

/** conflict list での競合の両側の呼び名 */
export type SideLabels = { ours: string; theirs: string };

/**
 * fork の両側の呼び名 (S5-3)。fork の両側は trunk と branch ではなく**並行に書いた 2 人**なので、書いた人の
 * 名前で呼ぶ。書いた人が引けなかった側 (`ForkSide.actor` が空) は「一方」「もう一方」と呼ぶ
 */
export function forkSideLabels(
  fork: ForkMeta,
  labelOf: (did: Did) => string,
): SideLabels {
  const nameOf = (actor: string, fallback: string) =>
    actor === '' ? fallback : labelOf(didFromActor(actor) as Did);
  return {
    ours: nameOf(fork.origin.ours.actor, '一方'),
    theirs: nameOf(fork.origin.theirs.actor, 'もう一方'),
  };
}

/**
 * 計算し直した競合が、fork に凍結した競合と同じものか。
 *
 * fork の分岐点は**検出した人の手元**なので、届いた側の op (凍結した記述の片側) は分岐点の後の trunk に
 * 居る。解決の編集をすると、その op と解決の編集の組が競合として計算し直される。これは凍結した競合を
 * 解いている最中の姿であって、別の競合ではない — 揉めた単位が同じで、trunk 側がどちらかの側の batch で
 * あるものを同じとみなす。trunk 側が別の batch (fork の後に trunk が進んだ) なら新しい競合である (O3)
 */
function isSameFork(frozen: MergeConflict, c: MergeConflict): boolean {
  return (
    conflictUnit(frozen) === conflictUnit(c) &&
    (c.ours.batchId === frozen.ours.batchId ||
      c.ours.batchId === frozen.theirs.batchId)
  );
}

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
  // fork (implicit merge が保留した競合, S5-3) は中身が空なので、計算し直しても競合は出ない。
  // 競合は fork が検出時点で凍結した記述から作る (Q8)
  const frozen = isFork(meta) ? [conflictOfFork(meta)] : [];
  const conflicts = mergerConflicts([
    ...frozen,
    ...plan.conflicts.filter((c) => !frozen.some((f) => isSameFork(f, c))),
  ]);
  const labels = labelsOfConflicts(plan.base, plan.conflicts);
  if (isFork(meta)) labels.set(meta.origin.target, meta.origin.targetLabel);
  return {
    source: projectAddress(
      { fileId, sheetId: meta.sheetId, branchId: meta.id, cut: startedAt },
      { trunk, branch: { branch: meta, batches: branch } },
    ),
    target: sheetOf(trunk),
    result: sheetOf([...trunk, ...previewCopies(plan.toAppend, trunk, branch)]),
    conflicts,
    labels,
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
  return [conflictUnit(conflict), conflict.ours.batchId].join('\u0000');
}

/** 揉めた単位 (種別・対象・プロパティ名か layout の観点)。どちらの側の batch かは含めない */
function conflictUnit(conflict: MergeConflict): string {
  const about =
    conflict.category === 'layout'
      ? conflict.aspect
      : (conflict.propertyName ?? '');
  return [conflict.category, conflict.target, about].join('\u0000');
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
