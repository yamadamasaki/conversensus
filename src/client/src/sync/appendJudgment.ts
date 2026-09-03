/**
 * 判断 op を書く (step2 Phase 1)
 *
 * ここが **clock 空間の共有**を成立させる一点である。
 *
 * pre 条件は「記録された承認が、**この操作より前に**記録されていること」のように
 * 「より前」を含むので、判断ログとグラフの op-log を同じ物差しで並べられなければ
 * ならない (`deepse/spikes/u6-p2-report.md` の検証 5)。**新しい採番器を作らず、
 * グラフと同じ `LamportClock` から発番する。**
 *
 * それだけでは足りない。tap の clock は**グラフの op-log の最大値**から seed される
 * ので、判断ログの方が進んでいると衝突する (同じ clock の batch が 2 つできる)。
 * 衝突すると順序は `(actor, id)` の tiebreak で決まり、「より前」が意図どおりに
 * ならない。したがって**書く前に判断ログの最大値でも seed する**。
 */

import type {
  Actor,
  BatchId,
  FileId,
  JudgmentBatch,
  JudgmentOp,
  Lamport,
} from '@conversensus/shared';
import type { TapClock } from '../hooks/useEventSyncTap';

export type AppendJudgmentDeps = {
  /** **グラフと同じ clock。**ここに独立した採番器を渡してはならない */
  clock: TapClock;
  /** この端末の actor (`<did>#<deviceId>`) */
  actor: Actor;
  putJudgment: (fileId: FileId, batch: JudgmentBatch) => Promise<void>;
  newBatchId: () => BatchId;
  now?: () => number;
};

/** 判断ログの最大 clock。空なら 0 (genesis の clock がそこにいる) */
export function maxJudgmentClock(batches: readonly JudgmentBatch[]): Lamport {
  return batches.reduce((max, b) => Math.max(max, b.clock), 0);
}

/**
 * 判断 op を 1 つの batch にまとめて書く。
 *
 * `known` はこの File について**今わかっている判断ログ**である (名簿を読んだときの
 * 結果を渡す)。clock の seed に使う。渡し忘れるとグラフ側の clock だけで発番して
 * しまうので、引数にして省略できないようにしてある。
 */
export async function appendJudgment(
  deps: AppendJudgmentDeps,
  fileId: FileId,
  ops: readonly JudgmentOp[],
  known: readonly JudgmentBatch[],
): Promise<JudgmentBatch> {
  if (ops.length === 0)
    throw new Error('appendJudgment: op が空の batch は書けない');

  // グラフ側の seed は tap が済ませている。ここでは判断ログの分だけ引き上げる
  deps.clock.seed(maxJudgmentClock(known));

  const batch: JudgmentBatch = {
    id: deps.newBatchId(),
    actor: deps.actor,
    clock: deps.clock.tick(),
    timestamp: (deps.now ?? Date.now)(),
    ops: [...ops],
  };
  await deps.putJudgment(fileId, batch);
  return batch;
}
