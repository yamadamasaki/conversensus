/**
 * 前に出ていない File の競合の通知の控え (#260)
 *
 * 右下の競合の通知は、前に出ている File の分だけを出す (判断はその File を見ながらする)。
 * 背後のタブの File で検出した競合と、前から外れた File の出ていた通知は、File ごとにここへ溜め、
 * タブに印を付ける。そのタブを前に出したら、溜めていた分を通知として出す (利用者判断 2026-10-11)。
 *
 * 純粋な関数だけを置く。state は `useNoticeInbox` が持つ。
 */

import type { FileId } from '@conversensus/shared';
import type { ConflictNoticeState } from '../hooks/useBranchOperations';
import { conflictNoticeKeyOf } from './noticeKeys';

export type PendingConflicts = ReadonlyMap<FileId, ConflictNoticeState>;

export const NO_PENDING_CONFLICTS: PendingConflicts = new Map();

/**
 * 通知をその File の控えに足す。**同じ競合 (鍵) は先に溜めた方を残す** — 受信のたびに検出し直す
 * わけではないが、前から外した通知と背後で検出した通知が重なることはある。名前は両方を合わせ、
 * 保留の件数は足す (どちらの検出も、その時に書いた fork の数)
 */
export function addPending(
  pending: PendingConflicts,
  notice: ConflictNoticeState,
): PendingConflicts {
  const { fileId } = notice;
  if (fileId === undefined || notice.conflicts.length === 0) return pending;
  const prev = pending.get(fileId);
  const next = new Map(pending);
  if (prev === undefined) {
    next.set(fileId, notice);
    return next;
  }
  const known = new Set(prev.conflicts.map(conflictNoticeKeyOf));
  const fresh = notice.conflicts.filter(
    (c) => !known.has(conflictNoticeKeyOf(c)),
  );
  next.set(fileId, {
    fileId,
    conflicts: [...prev.conflicts, ...fresh],
    labels: new Map([...notice.labels, ...prev.labels]),
    forkCount: Math.min(
      (prev.forkCount ?? 0) + (notice.forkCount ?? 0),
      prev.conflicts.length + fresh.length,
    ),
  });
  return next;
}

/** その File の控えを取り出す。残りの控えと組で返す */
export function takePending(
  pending: PendingConflicts,
  fileId: FileId,
): [ConflictNoticeState | undefined, PendingConflicts] {
  const mine = pending.get(fileId);
  if (mine === undefined) return [undefined, pending];
  const rest = new Map(pending);
  rest.delete(fileId);
  return [mine, rest];
}
