/**
 * U6-P2 スパイクの型スケッチ (投棄前提)
 *
 * 問い: **pre 条件つきの判断 op (承認) を、グラフの projection に分岐を足さずに
 * 分離できるか。**`isFileOp` → `foldFileStructure` の前例と同じ形に置けるか。
 *
 * 前例の形はこうである (`shared/src/events/project.ts`)。
 *
 *   - `projectBatches` は `if (isFileOp(op)) continue` で file op を**素通り**させる
 *   - `foldFileStructure` は `if (isFileOp(op))` で file op **だけ**を畳む
 *   - どちらの畳み込み器も、相手の意味論を知らない
 *
 * 承認が難しいのは、**pre 条件を満たさない op を捨てる**点である。グラフ側は
 * 「op はすべて有効」を前提にしているので (architecture §3)、同じ畳み込み器に
 * 混ぜると前提が壊れる。
 *
 * ここで確かめるのは次の 3 点である。
 *
 *   1. 判断の畳み込みが、グラフの畳み込みと**独立に**書けること
 *   2. 再 merge の可否が、グラフ側の畳み込み器に**分岐を足さずに**表せること
 *   3. 依存が**一方向** (判断 → グラフ) で、循環しないこと
 *
 * production コードは 1 行も変更していない。ここの型は本番の型ではなく、
 * 「この形なら置ける」ことを示すためのスケッチである。
 */

import type { Batch } from '@conversensus/shared';

export type Did = string;
export type DtrId = string;

/**
 * 判断 op (participation collection に置くもの)
 *
 * グラフ op と混ぜないので、`Op` の union には入れない。**別の collection に置くと
 * 決めた**時点で、routing は述語ですらなく「どちらの collection から来たか」になる。
 */
export type JudgmentOp =
  /** DtR を起動し、**呼び出し対象を確定して記録する** (S1 の決着) */
  | { kind: 'dtr.open'; dtrId: DtrId; callees: readonly Did[] }
  /** 呼び出された actor による承認 */
  | { kind: 'dtr.approve'; dtrId: DtrId };

/** 判断 op を運ぶ batch。clock と actor はグラフ側の `Batch` と同じ意味を持つ */
export type JudgmentBatch = {
  id: string;
  actor: Did;
  clock: number;
  ops: readonly JudgmentOp[];
};

/** 判断の畳み込みの結果。「どの DtR が再 merge 可能か」を clock つきで持つ */
export type Judgments = {
  /** dtrId → 呼び出し対象 (起動時に確定した集合) */
  callees: Map<DtrId, ReadonlySet<Did>>;
  /** dtrId → 承認済の actor */
  approvals: Map<DtrId, Set<Did>>;
  /**
   * dtrId → **全員の承認が揃った時点の clock**。揃っていなければ持たない。
   * 再 merge の pre 条件は「この clock より後であること」になる。
   */
  satisfiedAt: Map<DtrId, number>;
};

/** clock → actor → id の全順序 (`orderBatches` と同じ規則) */
function order<T extends { clock: number; actor: string; id: string }>(
  batches: readonly T[],
): T[] {
  return [...batches].sort(
    (a, b) =>
      a.clock - b.clock ||
      a.actor.localeCompare(b.actor) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * 判断の畳み込み。**pre 条件を満たさない op は捨てる。**
 *
 * ここが名簿 projection の中核で、グラフ projection には存在しない意味論である。
 * 捨てるのは 2 種類。
 *
 *   - 呼び出されていない actor の承認 (記録された集合に居ない)
 *   - 起動されていない DtR への承認 (`dtr.open` より前に来た承認)
 *
 * どちらも「不完全な情報の下でも、誰の手元でも同じ結論になる」ために要る。
 * 集合を起動時に固定してあるので、**判定は単調である** — 後から参加者が増えても
 * 既に出た結論はひっくり返らない (S1)。
 */
export function foldJudgments(batches: readonly JudgmentBatch[]): Judgments {
  const j: Judgments = {
    callees: new Map(),
    approvals: new Map(),
    satisfiedAt: new Map(),
  };

  for (const batch of order(batches))
    for (const op of batch.ops) {
      if (op.kind === 'dtr.open') {
        // 起動は 1 度だけ。2 度目は捨てる (呼び出し対象の書き換えを許さない)
        if (j.callees.has(op.dtrId)) continue;
        j.callees.set(op.dtrId, new Set(op.callees));
        j.approvals.set(op.dtrId, new Set());
        continue;
      }

      // --- 以下 dtr.approve の pre 条件 ---
      const callees = j.callees.get(op.dtrId);
      if (!callees) continue; // 起動されていない DtR への承認は捨てる
      if (!callees.has(batch.actor)) continue; // 呼ばれていない actor の承認は捨てる

      const approved = j.approvals.get(op.dtrId);
      if (!approved) continue;
      approved.add(batch.actor);

      // 全員揃った瞬間の clock を記録する。以後の再 merge がこれを参照する
      if (approved.size === callees.size && !j.satisfiedAt.has(op.dtrId))
        j.satisfiedAt.set(op.dtrId, batch.clock);
    }

  return j;
}

/**
 * 再 merge batch であることの印。**本番では batch のメタに置く**想定で、
 * ここでは判定を 1 箇所に閉じるためだけの形にしてある。
 */
export type RemergeMark = { dtrId: DtrId };

/**
 * グラフ側へ渡す**述語**。これがこのスパイクの答えである。
 *
 * 再 merge の可否をグラフの畳み込み器の中で判定しようとすると、そこに
 * 「無効な op がある」という名簿側の意味論が入り込む。そうではなく、
 * **畳み込みに入れる前に落とす** — `projectBatches` が `isFileOp` を素通りさせるのと
 * 同じ位置に置く。畳み込み器の本体は 1 行も変わらない。
 *
 * pre 条件は「記録された呼び出し対象の全員の承認が、**この操作より前に**記録されて
 * いること」なので、`satisfiedAt` の clock との比較になる。
 */
export function admissible(
  j: Judgments,
  remergeOf: (batch: Batch) => RemergeMark | undefined,
): (batch: Batch) => boolean {
  return (batch) => {
    const mark = remergeOf(batch);
    if (!mark) return true; // 普通のグラフ batch は常に有効 (グラフ側の前提を保つ)
    const satisfied = j.satisfiedAt.get(mark.dtrId);
    return satisfied !== undefined && satisfied < batch.clock;
  };
}
