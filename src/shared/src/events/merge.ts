/**
 * ログマージ (step1 Phase 2 / step2 ANA-206)
 *
 * 現行の `mergeBranchToTrunk` (レコード複製) を置換する。ブランチのマージを
 * 「ブランチの batches を trunk へ追記する」操作として表現する (O3 spike の設計)。
 *
 * D7 の解決ルール:
 *   - content  : LWW (projection の clock 順畳み込みで確定) + 並行変更を「対立」として検出
 *   - layout   : LWW のみ (対立にしない)。追記して projection に委ねる
 *   - structure: 追記して projection に委ねる (clock-LWW) + 競合を検出 (step 2)
 *
 * 解決そのものは `projectBatches` の決定論的な clock 順畳み込みに委ね、
 * この関数は「追記 + 対立の検出」に集中する。
 *
 * structure の競合が content と違うのは、**片方の操作がもう片方の前提を壊す**
 * という非対称なものを含む点である (`deepse/requirements/spec/merging.md`)。
 */

import type { Batch, BatchId, Op } from './unified';
import { isContentOp } from './unified';

/** 競合の片側。ours は trunk 側、theirs は branch 側 */
type ConflictSide = { batchId: BatchId; op: Op };

type MergeConflictBase = {
  /** 競合している要素の id。削除依存では「削除された要素」を指す */
  target: string;
  ours: ConflictSide; // trunk 側
  theirs: ConflictSide; // branch 側
};

/**
 * structure 競合の種別 (spec/merging.md の分類)
 * - `removeDependency`: 片方が削除した要素を、もう片方が前提にしている (非対称。S1/S2/S4)
 * - `parallelChange`  : 同じ対象の「一つしか持てない値」を並行に変更した (対称。S3/S5)
 */
export type StructureConflictKind = 'removeDependency' | 'parallelChange';

/** 並行変更 = 合意形成の機会。グラフ上に可視化する候補 */
export type MergeConflict =
  | (MergeConflictBase & { category: 'content' })
  | (MergeConflictBase & {
      category: 'structure';
      kind: StructureConflictKind;
    });

export type MergeResult = {
  /** trunk へ追記される、マージ後のログ (projection で解決される) */
  merged: Batch[];
  /** 検出された対立 (content / structure) */
  conflicts: MergeConflict[];
};

// op を target 持ちに絞って扱う — 対立検出は target ごとに引くので、target を
// 持たない op (sheet.reorder 等) が混ざらないことを型で示す
type OpWithTarget = Extract<Op, { target: unknown }>;
type TaggedOp = { batchId: BatchId; clock: number; op: OpWithTarget };

/**
 * 「一つしか持てない値」を持つ structure op。並行変更が content と同型の対立になる。
 *
 * `node.setParent` は所属グループを 1 つだけ、`edge.reconnect` は端点の組を 1 つだけ
 * しか持てないので、両側が別の値に変えたらどちらかしか残らない。
 */
const PARALLEL_STRUCTURE_KINDS = new Set<Op['kind']>([
  'node.setParent',
  'edge.reconnect',
]);

/** 要素を消す op か。消えた要素を前提にする op が削除依存の相手になる */
function isRemoveOp(op: Op): boolean {
  return op.kind === 'node.remove' || op.kind === 'edge.remove';
}

function isParallelStructureOp(op: Op): boolean {
  return PARALLEL_STRUCTURE_KINDS.has(op.kind);
}

/**
 * **この op が成立するために存在していなければならない要素**の id。
 *
 * 削除依存の検出はこれ一本で S1/S2/S4 をまとめて導く。自分が作る/消す要素は
 * 前提ではないので含めない (`node.add` の target、`*.remove` の target)。
 *
 * layout と presentation は対象外である。layout の競合は「通知のみで DtR を
 * 起動しない」と決めたので (spec/merging.md)、削除依存の判定には混ぜない。
 */
function prerequisitesOf(op: Op): string[] {
  switch (op.kind) {
    // 自分が作る/消すものは前提ではない。ただし作成時の所属先は前提になる
    case 'node.add':
      return op.parentId ? [op.parentId] : [];
    case 'node.remove':
    case 'edge.remove':
      return [];

    // 既存要素を動かす/繋ぎ替える — 対象と、新しい接続先の両方が要る
    case 'node.setParent':
      return op.parentId ? [op.target, op.parentId] : [op.target];
    case 'edge.add':
      return [op.source, op.dest];
    case 'edge.reconnect':
      return [op.target, op.source, op.dest];

    // 既存要素の中身を変える — 対象が要る
    case 'node.setContent':
    case 'node.setProperties':
    case 'edge.setLabel':
    case 'edge.setProperties':
      return [op.target];

    default:
      return [];
  }
}

function hasTarget(op: Op): op is OpWithTarget {
  return 'target' in op;
}

function flattenOps(batches: Batch[], keep: (op: Op) => boolean): TaggedOp[] {
  const out: TaggedOp[] = [];
  for (const batch of batches) {
    for (const op of batch.ops) {
      if (keep(op) && hasTarget(op)) {
        out.push({ batchId: batch.id, clock: batch.clock, op });
      }
    }
  }
  return out;
}

/** target ごとの「最後の変更」を引く索引 (clock 最大) */
function lastByTarget(tagged: TaggedOp[]): Map<string, TaggedOp> {
  const m = new Map<string, TaggedOp>();
  for (const t of tagged) {
    const prev = m.get(t.op.target);
    if (!prev || t.clock > prev.clock) m.set(t.op.target, t);
  }
  return m;
}

function opValueDiffers(a: Op, b: Op): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * 同じ target への並行変更を対立として集める。content と structure で同型なので
 * 共通化してある — 違うのは「どの op を見るか」と「結果に付ける分類」だけ。
 */
function collectParallelChanges(
  trunkAfterBase: Batch[],
  branchBatches: Batch[],
  keep: (op: Op) => boolean,
  label: (base: MergeConflictBase) => MergeConflict,
): MergeConflict[] {
  const ourLast = lastByTarget(flattenOps(trunkAfterBase, keep));
  const out: MergeConflict[] = [];
  for (const theirs of flattenOps(branchBatches, keep)) {
    const ours = ourLast.get(theirs.op.target);
    if (ours && opValueDiffers(ours.op, theirs.op)) {
      out.push(
        label({
          target: theirs.op.target,
          ours: { batchId: ours.batchId, op: ours.op },
          theirs: { batchId: theirs.batchId, op: theirs.op },
        }),
      );
    }
  }
  return out;
}

/**
 * 片方が削除した要素を、もう片方が前提にしている組を集める (非対称)。
 *
 * `removals` と `dependents` は trunk/branch のどちらでもよいが、結果の
 * ours/theirs は常に「ours = trunk 側、theirs = branch 側」に揃える。
 */
function collectRemoveDependencies(
  removals: Batch[],
  dependents: Batch[],
  removalIsOurs: boolean,
): MergeConflict[] {
  const removed = new Map<string, TaggedOp>();
  for (const t of flattenOps(removals, isRemoveOp)) removed.set(t.op.target, t);
  if (removed.size === 0) return [];

  const out: MergeConflict[] = [];
  for (const batch of dependents) {
    for (const op of batch.ops) {
      for (const id of prerequisitesOf(op)) {
        const removal = removed.get(id);
        if (!removal) continue;
        const removalSide = { batchId: removal.batchId, op: removal.op };
        const dependentSide = { batchId: batch.id, op };
        out.push({
          target: id, // 競合の主題は「消された要素」
          category: 'structure',
          kind: 'removeDependency',
          ours: removalIsOurs ? removalSide : dependentSide,
          theirs: removalIsOurs ? dependentSide : removalSide,
        });
      }
    }
  }
  return out;
}

/**
 * base 以降の trunk batches と branch batches をマージする。
 *
 * @param trunkAfterBase 分岐点 (base) 以降に trunk 側で追記された batches
 * @param branchBatches  ブランチ側で追記された batches
 */
export function mergeBranches(
  trunkAfterBase: Batch[],
  branchBatches: Batch[],
): MergeResult {
  // 解決は projection の clock 順畳み込みに委ねるため、両者を素直に連結する
  const merged = [...trunkAfterBase, ...branchBatches];

  const conflicts: MergeConflict[] = [
    // content の並行変更
    ...collectParallelChanges(
      trunkAfterBase,
      branchBatches,
      isContentOp,
      (base) => ({ ...base, category: 'content' }),
    ),
    // structure の並行変更 (S3/S5)
    ...collectParallelChanges(
      trunkAfterBase,
      branchBatches,
      isParallelStructureOp,
      (base) => ({ ...base, category: 'structure', kind: 'parallelChange' }),
    ),
    // structure の削除依存 (S1/S2/S4)。どちらが削除した場合も拾う
    ...collectRemoveDependencies(trunkAfterBase, branchBatches, true),
    ...collectRemoveDependencies(branchBatches, trunkAfterBase, false),
  ];

  return { merged, conflicts };
}
