/**
 * useTemplateNotices: 前に出ている File の template の版の通知 (template-update D3)
 *
 * File が変わるたび (受信・自分の編集) に op-log を読み直して求める。中身は
 * `appliedTemplateVersions` → `templateNoticesOf` (純粋な関数)。既読は通知の受け箱 (`useNoticeInbox`) と
 * 同じ置き場を使う。
 *
 * - **前に出ている File だけ**を見る。競合の通知と同じく、判断はその File を見ながらする
 * - **読み直しは同時に 1 つだけ。**読んでいる間に File が変わったら、終わってからもう 1 度だけ読む。
 *   template graph を直している間は op が続くので、変更のたびに並べて読まない。決め打ちの待ち時間
 *   (タイマー) は置かない
 */

import {
  appliedTemplateVersions,
  type FileId,
  type GraphFile,
  projectFile,
} from '@conversensus/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBatches } from '../api';
import {
  type TemplateNotice,
  templateNoticesOf,
} from '../notices/templateNotices';
import type { NoticeKey } from '../notices/types';

export function useTemplateNotices({
  file,
  trunkSettled,
  dismissedIn,
  dismissKeys,
}: {
  /** 前に出ている File (無ければ通知も無い) */
  file: GraphFile | null | undefined;
  /** 自分の書き込みが落ち切るのを待つ (直前の template graph の編集を漏らさない) */
  trunkSettled: () => Promise<void>;
  dismissedIn: (fileId: FileId) => Promise<ReadonlySet<NoticeKey>>;
  dismissKeys: (fileId: FileId, keys: readonly NoticeKey[]) => Promise<void>;
}) {
  const [notices, setNotices] = useState<readonly TemplateNotice[]>([]);
  /** 次に読む File と、そのときの口。読んでいる間に替わったら、読み終えてから読み直す */
  const latestRef = useRef({ file, trunkSettled, dismissedIn });
  latestRef.current = { file, trunkSettled, dismissedIn };
  /** 読んでいる最中か / 読んでいる間に File が変わったか */
  const runningRef = useRef(false);
  const dirtyRef = useRef(false);

  // 口 (trunkSettled・dismissedIn) が替わったときも読み直す: ログインで既読の置き場が替わる
  // biome-ignore lint/correctness/useExhaustiveDependencies: 口は latestRef から読むが、替わったら読み直したい
  useEffect(() => {
    if (!file) return;
    dirtyRef.current = true;
    if (runningRef.current) return;
    runningRef.current = true;
    void (async () => {
      while (dirtyRef.current) {
        dirtyRef.current = false;
        const {
          file: current,
          trunkSettled: settled,
          dismissedIn: dismissedOf,
        } = latestRef.current;
        if (!current) break;
        try {
          await settled();
          const trunk = await fetchBatches(current.id);
          const versions = appliedTemplateVersions(
            projectFile(trunk, current.id).sheets,
            trunk,
            current.id,
          );
          const dismissed = await dismissedOf(current.id);
          setNotices(templateNoticesOf(current.id, versions, dismissed));
        } catch (error) {
          console.warn('[template] 版の通知を求められなかった:', error);
        }
      }
      runningRef.current = false;
    })();
  }, [file, trunkSettled, dismissedIn]);

  /** 通知を 1 つ閉じる (既読にする) */
  const dismiss = useCallback(
    (notice: TemplateNotice) => {
      void dismissKeys(notice.fileId, [notice.key]);
      setNotices((prev) => prev.filter((n) => n.key !== notice.key));
    },
    [dismissKeys],
  );

  // 前から外れた File の通知は出さない (読み直すまでの間も)
  const shown = notices.filter((n) => n.fileId === file?.id);
  return { templateNotices: shown, dismissTemplateNotice: dismiss };
}
