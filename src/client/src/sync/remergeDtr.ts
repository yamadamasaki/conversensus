/**
 * DtR の再 merge (step2 Phase 6 D3)
 *
 * 設計: `deepse/plans/step2-phase6-dtr.md`
 * 仕様: `deepse/requirements/spec/dialogueToResolveGraph.md`
 *
 * > 更新した DtR graph の再 merge
 * > - 呼び出された actor 全員が承認したら (**そして, その後の変更がなければ**),
 * >   再 merge が可能になる
 * > - 再 merge で, 再び競合が起きる可能性もある. その場合は, このプロセスが繰り返される
 *
 * **新しい merge 機構を作らない。**解決グラフは branch なので (決めたこと 10)、取り込みは
 * `mergeBranchOnOplog` そのものである。ここが足すのは**関門**と、merge コミットへの
 * **DtR の刻印**だけで、再スタンプ・べき等性・競合検出は既存の経路がそのまま担う。
 * 「再び競合したら繰り返す」も、返ってくる `conflicts` が非空なら DtR をもう一度
 * 起こせばよい — 特別な仕掛けを持たない。
 *
 * ## 関門は 2 つあり、効かせる場所が違う
 *
 * | 条件 | どこで | なぜ |
 * | --- | --- | --- |
 * | 承認が揃っている | **ここと、畳み込みの手前の両方** | trunk を書き換えるので、端末をまたいで一致しなければならない。早まって書いても `admissibleBatches` が落とす |
 * | その後の変更がない | **ここだけ** | 仕様は「再 merge が**可能になる**条件」として書いており、捨てる pre 条件としては書いていない。判定に解決 branch の op-log の先端が要るので、表示のたびに別のログを読むことになる |
 *
 * **後者を畳み込みに委ねない理由は、委ねなくても安全だからである。**変更があったのに
 * 書いてしまっても、承認の条件は依然として畳み込みが判定するので、**勝手に trunk が
 * 書き換わることはない**。
 */

import type {
  Actor,
  Batch,
  BranchMeta,
  Dtr,
  FileId,
  Lamport,
} from '@conversensus/shared';
import { tipClock } from '@conversensus/shared';
import {
  type MergeBranchDeps,
  type MergeBranchResult,
  mergeBranchOnOplog,
} from './mergeBranch';

/** 再 merge を拒む理由。**UI に出す材料**でもある (なぜ押せないのかを言う) */
export type RemergeBlockedReason =
  /** 呼び出し対象の全員が承認していない (= 保留) */
  | 'notApproved'
  /** 承認の後に解決グラフが動いた。**承認が指していた内容ではなくなっている** */
  | 'changedAfterApproval'
  /** 解決 branch が見つからない (記録と op-log が食い違っている) */
  | 'resolveBranchMissing';

export type RemergeGate =
  | { ok: true }
  | { ok: false; reason: RemergeBlockedReason };

/**
 * その DtR を、いま再 merge してよいか。**純粋な述語である。**
 *
 * I/O と分けてあるのは、**関門の規則そのものを変異試験で固定するため**である。
 * 読み込みと混ぜると「読めなかったから通らなかった」のか「規則が効いたのか」が
 * テストから区別できなくなる。
 *
 * @param resolveTip 解決 branch の op-log の先端 (`tipClock`)
 */
export function canStartRemerge(dtr: Dtr, resolveTip: Lamport): RemergeGate {
  if (dtr.satisfiedAt === undefined)
    return { ok: false, reason: 'notApproved' };
  // **承認が揃った位置より後に解決グラフが動いていないこと。**動いていたら、
  // 承認した人が見たものと取り込む内容が違う
  if (resolveTip > dtr.satisfiedAt)
    return { ok: false, reason: 'changedAfterApproval' };
  return { ok: true };
}

export type RemergeDtrDeps = MergeBranchDeps & {
  /** trunk の op-log から branch のメタを引く (`readBranchMeta` の `branches`) */
  readBranches: (trunkFileId: FileId) => Promise<Map<string, BranchMeta>>;
  /** 解決 branch の op-log を読む。先端が関門の材料になる */
  fetchBatches: (fileId: FileId) => Promise<Batch[]>;
};

export type RemergeDtrParams = {
  /** 何のために再 merge したか。通常の merge と同じく必須 */
  message: string;
  actor: Actor;
  /**
   * 取り込み先の trunk。
   *
   * **`Dtr` からは引けない。**判断 batch は fileId を持たず (rkey が運ぶ)、DtR の記録にも
   * 載っていないので、どの File の話かは呼び出し側だけが知っている。
   */
  trunkFileId: FileId;
};

export type RemergeDtrResult =
  | { ok: true; merge: MergeBranchResult }
  | { ok: false; reason: RemergeBlockedReason };

/**
 * 解決グラフを trunk へ取り込み、DtR を決着させる。
 *
 * **関門を通らなければ何も書かない。**理由を返すので、呼び出し側はなぜ進めないかを
 * そのまま人に言える (「まだ全員の承認が揃っていない」「承認の後に解決が変わった」)。
 */
export async function remergeDtr(
  dtr: Dtr,
  params: RemergeDtrParams,
  deps: RemergeDtrDeps,
): Promise<RemergeDtrResult> {
  const branches = await deps.readBranches(params.trunkFileId);
  const resolve = branches.get(dtr.resolveBranchId);
  if (!resolve) return { ok: false, reason: 'resolveBranchMissing' };

  const resolveTip = tipClock(await deps.fetchBatches(resolve.branchFileId));
  const gate = canStartRemerge(dtr, resolveTip);
  if (!gate.ok) return gate;

  // **刻印はここだけ。**merge コミットに dtrId が載り、写しは mergedIn でそれを指す
  // ので、承認を経ていない再 merge は projection の手前で落とせる
  const merge = await mergeBranchOnOplog(
    resolve,
    { message: params.message, actor: params.actor, dtrId: dtr.id },
    deps,
  );
  return { ok: true, merge };
}
