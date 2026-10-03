/**
 * 通知の既読 (step3 Phase 6 S6-1)
 *
 * 通知の**内容**は受信のたびに op-log から検出し直す (設計 Q4)。PDS に置くのは
 * 「閉じた」ことだけである。
 */

import type { FileId, ISODateString } from '@conversensus/shared';

/**
 * 通知の同一性。**どの端末で検出しても同じ値になる**ものでなければならない
 * (`conflictKeyOf` など、設計 F3)。1 台で閉じたものを他の端末で落とすための鍵である
 */
export type NoticeKey = string;

/** 閉じた通知 1 件 */
export type NoticeDismissal = {
  fileId: FileId;
  key: NoticeKey;
  dismissedAt: ISODateString;
};
