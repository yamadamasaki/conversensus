/**
 * forkArrival: 相手が書いた fork の到着を見つけて溜める (step2 Phase 3 T7-5)
 *
 * 設計: `deepse/plans/step2-phase3-t7-branch-sync.md` 決定 4 /
 * 仕様: `spec/merging.md`「implicit merging は, merge できない場合には fork し, actor にはそれを通知する」
 *
 * ## なぜ要るか
 *
 * implicit merge の競合を検出するのは **LWW で勝つ側だけ**である (Phase 3 の実 PDS 観察)。
 * 勝った側は競合の通知を見て fork を書くが、負けた側には T8 の控えめな印
 * (「内容が書き換えられました」) しか出ない。**判断を保留した競合があることを片側しか知らない。**
 * fork は trunk の op-log に載って相手に届く (T7-1) ので、その到着を通知すれば両側に揃う。
 *
 * ## 通知の対象
 *
 * **受信で初めて現れた `conflictKey` の fork** である。
 *
 * - **自分がこのサイクルで書いた fork は除く** — それは競合の通知が既に伝えている
 * - **同じ競合の fork を自分が先に持っていれば出さない** — 両側が同時に検出した場合で、
 *   畳み込みは同じ `conflictKey` の fork を 1 つに畳む (T7-0)。鍵で比べるので別名も同じ扱いになる
 * - **削除された fork は出さない** — 畳み込みが見えなくするものは届いていないのと同じ
 */

import {
  type Batch,
  type FileId,
  type ForkMeta,
  foldBranches,
  isFork,
} from '@conversensus/shared';

export type DetectArrivedForksInput = {
  trunkFileId: FileId;
  /** 受信**前**のローカル正典 (trunk) */
  local: readonly Batch[];
  /** 新しく届いた batch */
  incoming: readonly Batch[];
  /** この受信の中で自分が書いた fork */
  written: readonly ForkMeta[];
};

function forkKeysOf(batches: readonly Batch[], trunkFileId: FileId) {
  return new Set(
    [...foldBranches(batches, trunkFileId).branches.values()]
      .filter(isFork)
      .map((fork) => fork.conflictKey),
  );
}

/** 受信で初めて現れた、相手が書いた fork を返す */
export function detectArrivedForks(input: DetectArrivedForksInput): ForkMeta[] {
  if (input.incoming.length === 0) return [];
  const known = forkKeysOf(input.local, input.trunkFileId);
  for (const fork of input.written) known.add(fork.conflictKey);

  const after = foldBranches(
    [...input.local, ...input.incoming],
    input.trunkFileId,
  );
  return [...after.branches.values()]
    .filter(isFork)
    .filter((fork) => !known.has(fork.conflictKey));
}

/** 通知に溜めている到着分が無い状態 */
export const NO_ARRIVED_FORKS: readonly ForkMeta[] = [];

/**
 * 新しく届いた fork を、溜めてある分へ足す。
 *
 * **受信サイクルをまたいで溜める。**競合の通知は検出のたびに置き換わるので、同じ state に
 * 入れると次の検出で消える。同じ `conflictKey` は同じ競合なので**先に届いた方を残す** —
 * 記述は検出時点で凍結されたもので、後から届いた別の参加者の記述に差し替える理由が無い。
 */
export function accumulateArrivedForks(
  prev: readonly ForkMeta[],
  next: readonly ForkMeta[],
): readonly ForkMeta[] {
  if (next.length === 0) return prev;
  const byKey = new Map(prev.map((fork) => [fork.conflictKey, fork]));
  for (const fork of next) {
    if (!byKey.has(fork.conflictKey)) byKey.set(fork.conflictKey, fork);
  }
  return [...byKey.values()];
}
