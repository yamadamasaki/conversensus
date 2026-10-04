/**
 * 閉じた通知の保存先 = 自分の PDS (step3 Phase 6 S6-1a)
 *
 * 判断ログ (`judgmentStore.ts`) と同じく outbox を通さず直に書く。outbox は batch の
 * 語彙で組まれていて、既読は「後で送る」必要も無い — 書けなければ他の端末で出直すだけである。
 */

import type { FileId } from '@conversensus/shared';
import type { NoticeDismissalStore } from '../notices/noticeDismissals';
import type { NoticeDismissal } from '../notices/types';
import { noticeDismissals } from './collections';
import {
  noticeDismissalRkey,
  noticeDismissalToRecord,
  recordToNoticeDismissal,
} from './noticeDismissalMapper';

export const pdsNoticeDismissalStore: NoticeDismissalStore = {
  async listByFile(fileId: FileId) {
    const records = await noticeDismissals.listByFile(fileId);
    const found: NoticeDismissal[] = [];
    let broken = 0;
    for (const record of records) {
      const dismissal = recordToNoticeDismissal(record.value);
      // rkey の prefix が合っても、本文の fileId が違えば別の File のものである
      if (dismissal === null || dismissal.fileId !== fileId) broken += 1;
      else found.push(dismissal);
    }
    if (broken > 0) {
      console.warn(
        `[notices] skipped ${broken} malformed dismissal record(s) of ${fileId}`,
      );
    }
    return found;
  },
  async put(dismissal) {
    const rkey = await noticeDismissalRkey(dismissal.fileId, dismissal.key);
    await noticeDismissals.put(rkey, noticeDismissalToRecord(dismissal));
  },
};
