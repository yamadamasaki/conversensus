/**
 * ログマージ (step1 Phase 2)
 *
 * 現行の `mergeBranchToTrunk` (レコード複製) を置換する。ブランチのマージを
 * 「ブランチの batches を trunk へ追記する」操作として表現する (O3 spike の設計)。
 *
 * D7 の解決ルール:
 *   - content  : LWW (projection の clock 順畳み込みで確定) + 並行変更を「対立」として検出
 *   - layout   : LWW のみ (対立にしない)。追記して projection に委ねる
 *   - structure: 追記して projection に委ねる (clock-LWW。add-wins OR-Set 厳密化は将来課題)
 *
 * 解決そのものは `projectBatches` の決定論的な clock 順畳み込みに委ね、
 * この関数は「追記 + content 対立の検出」に集中する。
 */

import type { Batch, BatchId, Op } from './unified';
import { opCategory } from './unified';

/** content の並行変更 = 合意形成の機会。グラフ上に可視化する候補 */
export type MergeConflict = {
  target: string;
  category: 'content';
  ours: { batchId: BatchId; op: Op }; // trunk 側
  theirs: { batchId: BatchId; op: Op }; // branch 側
};

export type MergeResult = {
  /** trunk へ追記される、マージ後のログ (projection で解決される) */
  merged: Batch[];
  /** 検出された content 対立 */
  conflicts: MergeConflict[];
};

type TaggedOp = { batchId: BatchId; clock: number; op: Op };

function flattenContentOps(batches: Batch[]): TaggedOp[] {
  const out: TaggedOp[] = [];
  for (const batch of batches) {
    for (const op of batch.ops) {
      if (opCategory(op) === 'content') {
        out.push({ batchId: batch.id, clock: batch.clock, op });
      }
    }
  }
  return out;
}

/** target ごとの「最後の content 変更」を引く索引 (clock 最大) */
function lastContentByTarget(tagged: TaggedOp[]): Map<string, TaggedOp> {
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

  // content の並行変更を対立として検出する
  const trunkContent = lastContentByTarget(flattenContentOps(trunkAfterBase));
  const conflicts: MergeConflict[] = [];
  for (const theirs of flattenContentOps(branchBatches)) {
    const ours = trunkContent.get(theirs.op.target);
    if (ours && opValueDiffers(ours.op, theirs.op)) {
      conflicts.push({
        target: theirs.op.target,
        category: 'content',
        ours: { batchId: ours.batchId, op: ours.op },
        theirs: { batchId: theirs.batchId, op: theirs.op },
      });
    }
  }

  return { merged, conflicts };
}
