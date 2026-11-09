/**
 * 通知の既読の鍵 (step3 Phase 6 S6-1a, 設計 F3)
 *
 * 既読の鍵は**どの端末で検出しても同じ値**でなければならない。1 台で閉じたものを
 * 他の端末で落とすための鍵だからである。
 */

import {
  conflictKeyOf,
  type ForkMeta,
  type MergeConflict,
} from '@conversensus/shared';
import { type OverwriteReport, overwriteKeyOf } from '../sync/overwrites';
import type { NoticeKey } from './types';

/** 鍵の区切り。`conflictKeyOf` と同じく、id にもプロパティ名にも現れない文字 */
const SEPARATOR = '\u0000';

/**
 * 競合の既読の鍵 = `conflictKeyOf` (対立した 2 つの batchId を含む)。
 *
 * **fork の鍵と同じ値になる** — fork は競合から同じ関数で同一性を導くので、
 * 競合の通知を閉じた人には、同じ競合の fork の到着も出さない (同じ出来事である)
 */
export function conflictNoticeKeyOf(conflict: MergeConflict): NoticeKey {
  return conflictKeyOf(conflict);
}

/** 届いた fork の既読の鍵 */
export function forkNoticeKeyOf(fork: ForkMeta): NoticeKey {
  return fork.conflictKey;
}

/**
 * 上書きの報告の既読の鍵。
 *
 * **`overwriteKeyOf` をそのまま使わない。**あれは溜めるときの重複除けで batchId を
 * 含まないので、既読の鍵にすると**同じ対象への将来の上書きまで**既読になってしまう。
 * 上書きした側とされた側の batchId を足して、1 回の上書きを 1 つの鍵にする
 */
export function overwriteNoticeKeyOf(report: OverwriteReport): NoticeKey {
  return [overwriteKeyOf(report), report.mine, report.theirs].join(SEPARATOR);
}
