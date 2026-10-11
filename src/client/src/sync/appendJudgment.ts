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
 * ## 発番器は File ごとに 1 つで、開いていなくても使う (#261)
 *
 * clock 空間は **File ごと**である。以前は「判断を書く File を前に開いていれば tap の発番器、
 * そうでなければ判断ログだけから復元した使い捨ての発番器」としていた (2026-09-05 実機で、
 * 開いていない File の承認で tap が無く落ちたため)。使い捨ては「その File のグラフ op-log は
 * 手元に 1 件も無い」を前提にしていたが、**背後のタブで開いている File や、前に開いた File**
 * では成り立たない。同じ点 `(actor, seq)` をグラフと判断で 2 度振りうる (S5-3 で残った窓 2)。
 *
 * 今は**セッションの置き場の発番器** (`FileSessionPool.causalOf`) を File ごとに借りる。セッションが
 * 無くても返り、セッションより長く生きる。借りる側 (`clockFor`) が**その File のローカルの
 * op-log から復元してから**返すので、開いていない File でもグラフの点を知った上で振る。
 * 承認のように File がまだ手元に無ければ、復元するものが無いので判断ログの最大値 + 1 になる
 * (以前と同じ)。
 *
 * 振った点は `rememberPoint` で手元に覚える。判断ログはローカル正典に載らないので、覚えないと
 * 再読み込みの後に File を開いた直後 (最初の受信サイクルまで) の編集が同じ点を振る (窓 1)
 */

import type {
  Actor,
  BatchId,
  CausalClock,
  FileId,
  JudgmentBatch,
  JudgmentOp,
  Lamport,
} from '@conversensus/shared';
import type { OwnJudgmentPoint } from './ownJudgmentPoint';

export type AppendJudgmentDeps = {
  /**
   * **その File のグラフと同じ発番器** (clock・seq・因果の知識) を、その File のローカルの op-log
   * から復元して返す。ここに独立した発番器を渡してはならない。別の File のものも渡してはならない
   * (別の因果の範囲で振ることになる)
   */
  clockFor: (fileId: FileId) => Promise<CausalClock>;
  /** 振った点を手元に覚える (`ownJudgmentPoint`)。省くと覚えない (テスト) */
  rememberPoint?: (fileId: FileId, point: OwnJudgmentPoint) => void;
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

  // グラフ側の復元は `clockFor` が済ませているので、判断ログの分を足す
  const clock = await deps.clockFor(fileId);
  clock.restore(known);
  const stamp = clock.issue();
  deps.rememberPoint?.(fileId, {
    actor: deps.actor,
    seq: stamp.seq,
    clock: stamp.clock,
  });

  const batch: JudgmentBatch = {
    id: deps.newBatchId(),
    actor: deps.actor,
    ...stamp,
    timestamp: (deps.now ?? Date.now)(),
    ops: [...ops],
  };
  await deps.putJudgment(fileId, batch);
  return batch;
}
