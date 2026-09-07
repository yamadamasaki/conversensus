/**
 * 競合から fork を書く (step2 Phase 3 T6)
 *
 * implicit merge そのものは op-log に書かないが、**その副産物である fork は書く** —
 * 「この競合を保留した」という判断の記録だからである。書かないと、同期のたびに
 * 再計算されてユーザが解決したはずの fork が毎回復活する (`spec/merging.md`)。
 *
 * ## layout では fork を作らない
 *
 * 仕様の 3 段のうち fork が要るのは**人の判断が要る段**だけである。layout は
 * 「通知のみで DtR graph は起動しない」種別なので、保留する判断そのものが無い。
 * 判定は `requiresConfirmation` を共有する — explicit merge が「取り込む前に問うか」を
 * 決めるのと同じ線引きで、**どちらも「人の判断が要るか」を問うている**。
 *
 * ## 同じ競合に fork は 1 つ
 *
 * `conflictKey` で既存の fork と突き合わせる。T5 の検出は新着だけを見るので同じ競合を
 * 二度検出しないが、**それに頼らない** — 二度と復活しないことは fork を書くと決めた
 * 理由そのものなので、器の側でも保証する。
 */

import type {
  Batch,
  BranchMeta,
  FileId,
  ForkMeta,
  MergeConflict,
  SheetId,
} from '@conversensus/shared';
import {
  conflictKeyOf,
  isFork,
  makeFork,
  requiresConfirmation,
} from '@conversensus/shared';
import type { DetectedConflicts } from './conflicts';

export type ForkWriterDeps = {
  /** trunk にぶら下がる branch (fork を含む) を引く。重複を避けるのに使う */
  fetchBranches: (trunkFileId: FileId) => Promise<BranchMeta[]>;
  saveBranch: (meta: BranchMeta) => Promise<BranchMeta>;
  newId: () => string;
};

export type WriteForksInput = {
  trunkFileId: FileId;
  detected: DetectedConflicts;
  /** 検出時点の手元のログ。分岐点と、対立した op の actor / clock の引き先 */
  localBatches: readonly Batch[];
  /** 新しく届いた batch。相手側の op の actor / clock はここにある */
  incoming: readonly Batch[];
  /** fork を書いた actor (私) */
  actor: string;
};

/**
 * 競合の対象が属するシート。
 *
 * **content batch は必ず `sheetId` を持つ** (§3.1)。競合は content / structure の op の
 * 間で起きるので、対立した batch のどちらかから引ける。引けない競合は fork にしない —
 * branch は per-sheet なので、置き場所が決まらない。
 */
function sheetIdOf(
  conflict: MergeConflict,
  byId: Map<string, Batch>,
): SheetId | undefined {
  return (
    byId.get(conflict.ours.batchId)?.sheetId ??
    byId.get(conflict.theirs.batchId)?.sheetId
  );
}

/**
 * 検出した競合のうち、保留の記録が要るものを fork として書く。
 *
 * @returns 新しく書いた fork。既にあったものは含まない
 */
export async function writeForksForConflicts(
  input: WriteForksInput,
  deps: ForkWriterDeps,
): Promise<ForkMeta[]> {
  // layout は保留する判断が無いので fork を作らない (3 段の一番下)
  const needsFork = input.detected.conflicts.filter(requiresConfirmation);
  if (needsFork.length === 0) return [];

  const existing = await deps.fetchBranches(input.trunkFileId);
  const known = new Set(
    existing.filter(isFork).map((fork) => fork.conflictKey),
  );

  const byId = new Map<string, Batch>();
  for (const b of [...input.localBatches, ...input.incoming]) byId.set(b.id, b);

  const written: ForkMeta[] = [];
  for (const conflict of needsFork) {
    const key = conflictKeyOf(conflict);
    if (known.has(key)) continue;
    const sheetId = sheetIdOf(conflict, byId);
    if (sheetId === undefined) continue;
    // 同じサイクルの中でも重複させない (同じ単位の競合が 2 件出ることは無いはずだが、
    // ここで畳んでおけば器の側の保証が検出側の性質に依存しない)
    known.add(key);

    const fork = makeFork({
      conflict,
      targetLabel: input.detected.labels.get(conflict.target) ?? '',
      batchOf: (batchId) => byId.get(batchId),
      localBatches: [...input.localBatches],
      sheetId,
      trunkFileId: input.trunkFileId,
      authorActor: input.actor,
      newId: deps.newId,
    });
    await deps.saveBranch(fork);
    written.push(fork);
  }
  return written;
}
