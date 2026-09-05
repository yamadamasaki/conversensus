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
 *
 * ## ⚠️ tap があるのは「その File を開いているとき」だけである (2026-09-05 実機で発覚)
 *
 * clock 空間は **File ごと**である。tap も File ごとに作られるので、**判断を書く File を
 * 開いていなければ tap は無い**。
 *
 * 承認 (`participation.accept`) がまさにその場合である。承認する時点でその File は
 * 手元に無い (グラフの batch が 1 件も来ていない) ので、開きようがない。**開いている
 * 別の File の tap を使ってはならない** — 別の clock 空間の採番器であり、しかもその
 * File の clock を無関係に進めてしまう。
 *
 * tap が無いときは**判断ログの最大値 + 1** で発番する。グラフ側と衝突しないのは、
 * その File のグラフ op-log が手元に 1 件も無いからである。依頼者の tap は
 * グラフの最大値から seed されているので、依頼の clock は既にグラフを追い越しており、
 * その + 1 は「依頼より後」を正しく表す。
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
  /**
   * **その File のグラフと同じ clock。**ここに独立した採番器を渡してはならない。
   *
   * **その File を開いていなければ `null`** — tap は File ごとなので、別の File の
   * tap を渡すと別の clock 空間の採番器を使うことになる。承認はこの場合にあたる。
   */
  clock: TapClock | null;
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

  const floor = maxJudgmentClock(known);
  // tap があれば: グラフ側の seed は tap が済ませているので、判断ログの分だけ引き上げる。
  // tap が無ければ (その File を開いていない): 判断ログの最大値 + 1。その File の
  // グラフ op-log は手元に 1 件も無いので、衝突する相手がいない
  deps.clock?.seed(floor);
  const clock = deps.clock ? deps.clock.tick() : floor + 1;

  const batch: JudgmentBatch = {
    id: deps.newBatchId(),
    actor: deps.actor,
    clock,
    timestamp: (deps.now ?? Date.now)(),
    ops: [...ops],
  };
  await deps.putJudgment(fileId, batch);
  return batch;
}
