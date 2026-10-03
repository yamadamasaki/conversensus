/**
 * 画面右下の通知 (競合 / 上書きの報告 / 届いた fork) の state と、閉じた通知の既読
 * (step3 Phase 6 S6-1a)。
 *
 * 通知の内容は今までどおり受信と merge で検出する。ここで足すのは
 * **「閉じた」を自分の PDS に書き、他の端末で同じ通知を出さない**ことである (設計 §2.1)。
 * 出す前に File の既読を待って落とすので、起動直後の catch-up の通知も落ちる。
 *
 * App にあった 3 つの state をここへ移した。既読の鍵を引くには通知がどの File の
 * ものかが要るので、受け取り口が fileId を取る。
 */

import type { Did, FileId, ForkMeta } from '@conversensus/shared';
import { useCallback, useMemo, useRef, useState } from 'react';
import { pdsNoticeDismissalStore } from '../atproto/noticeDismissalStore';
import { NoticeDismissals } from '../notices/noticeDismissals';
import {
  conflictNoticeKeyOf,
  forkNoticeKeyOf,
  overwriteNoticeKeyOf,
} from '../notices/noticeKeys';
import type { NoticeKey } from '../notices/types';
import { accumulateArrivedForks, NO_ARRIVED_FORKS } from '../sync/forkArrival';
import {
  accumulateOverwrites,
  type DetectedOverwrites,
  NO_OVERWRITE_NOTICE,
  type OverwriteNoticeState,
} from '../sync/overwrites';
import type { ConflictNoticeState } from './useBranchOperations';

const NO_CONFLICT_NOTICE: ConflictNoticeState = {
  conflicts: [],
  labels: new Map(),
};

/** 鍵を File ごとに束ねる (既読は File ごとに書く) */
function groupByFile(
  entries: readonly { fileId: FileId; key: NoticeKey }[],
): Map<FileId, NoticeKey[]> {
  const byFile = new Map<FileId, NoticeKey[]>();
  for (const { fileId, key } of entries) {
    byFile.set(fileId, [...(byFile.get(fileId) ?? []), key]);
  }
  return byFile;
}

/**
 * @param did ログインしている DID。null なら既読はこの端末の記憶の中だけになる
 */
export function useNoticeInbox(did: Did | null) {
  const dismissals = useMemo(
    () => new NoticeDismissals(did === null ? null : pdsNoticeDismissalStore),
    [did],
  );

  const [conflictNotice, setConflictNotice] =
    useState<ConflictNoticeState>(NO_CONFLICT_NOTICE);
  /**
   * 競合の通知は**検出のたびに置き換わる**。既読を待つ間に次の検出が来たら、遅れて
   * 解けた古い方で上書きしない
   */
  const conflictSeqRef = useRef(0);
  /**
   * 競合の通知を出す (implicit / explicit merge)。既読のものを落とす。
   * fileId の無い通知 (古い呼び出し元) は落とさずに出す
   */
  const showConflicts = useCallback(
    (notice: ConflictNoticeState) => {
      const seq = ++conflictSeqRef.current;
      const fileId = notice.fileId;
      if (fileId === undefined || notice.conflicts.length === 0) {
        setConflictNotice(notice);
        return;
      }
      void dismissals.dismissedIn(fileId).then((dismissed) => {
        if (seq !== conflictSeqRef.current) return;
        const conflicts = notice.conflicts.filter(
          (c) => !dismissed.has(conflictNoticeKeyOf(c)),
        );
        setConflictNotice({
          ...notice,
          conflicts,
          // 保留した件数は残った競合の数を超えない (全部落ちたら 0)
          forkCount: Math.min(notice.forkCount ?? 0, conflicts.length),
        });
      });
    },
    [dismissals],
  );

  /**
   * 上書きの報告 (step2 Phase 3 T8)。**受信サイクルをまたいで溜める。**
   *
   * 競合の通知と違って自動では開かないので、上書きして消すと**人が見に行く前に
   * 消える**。検出は競合と同じく 1 度きり (次のサイクルではその batch は手元にある)
   * なので、溜めるのはここしかない。
   */
  const [overwriteNotice, setOverwriteNotice] =
    useState<OverwriteNoticeState>(NO_OVERWRITE_NOTICE);
  /** 溜めている報告の既読の鍵 → File。報告そのものは File を持たない */
  const overwriteFileRef = useRef(new Map<NoticeKey, FileId>());
  const handleOverwrites = useCallback(
    (fileId: FileId, detected: DetectedOverwrites) => {
      void dismissals.dismissedIn(fileId).then((dismissed) => {
        const reports = detected.reports.filter(
          (r) => !dismissed.has(overwriteNoticeKeyOf(r)),
        );
        for (const r of reports) {
          overwriteFileRef.current.set(overwriteNoticeKeyOf(r), fileId);
        }
        setOverwriteNotice((prev) =>
          accumulateOverwrites(prev, { ...detected, reports }),
        );
      });
    },
    [dismissals],
  );

  /**
   * 相手が保留した競合 (fork) の到着 (Phase 3 T7-5)。**競合の通知に出す** — ただし競合の
   * 検出は毎回置き換わるので、同じ state に入れると次の検出で消える。受信サイクルをまたいで
   * 溜め、通知を閉じたときに一緒に消す
   */
  const [arrivedForks, setArrivedForks] =
    useState<readonly ForkMeta[]>(NO_ARRIVED_FORKS);
  const handleForksArrived = useCallback(
    (forks: readonly ForkMeta[]) => {
      const byFile = new Map<FileId, ForkMeta[]>();
      for (const fork of forks) {
        byFile.set(fork.trunkFileId, [
          ...(byFile.get(fork.trunkFileId) ?? []),
          fork,
        ]);
      }
      for (const [fileId, ofFile] of byFile) {
        void dismissals.dismissedIn(fileId).then((dismissed) => {
          const fresh = ofFile.filter(
            (f) => !dismissed.has(forkNoticeKeyOf(f)),
          );
          setArrivedForks((prev) => accumulateArrivedForks(prev, fresh));
        });
      }
    },
    [dismissals],
  );

  /** 競合の通知を閉じる。出ていた競合と fork を既読にする */
  const closeConflictNotice = useCallback(() => {
    const entries = [
      ...(conflictNotice.fileId === undefined
        ? []
        : conflictNotice.conflicts.map((c) => ({
            fileId: conflictNotice.fileId as FileId,
            key: conflictNoticeKeyOf(c),
          }))),
      ...arrivedForks.map((f) => ({
        fileId: f.trunkFileId,
        key: forkNoticeKeyOf(f),
      })),
    ];
    for (const [fileId, keys] of groupByFile(entries)) {
      void dismissals.dismiss(fileId, keys);
    }
    conflictSeqRef.current += 1;
    setConflictNotice(NO_CONFLICT_NOTICE);
    setArrivedForks(NO_ARRIVED_FORKS);
  }, [conflictNotice, arrivedForks, dismissals]);

  /** 上書きの報告を閉じる。溜めていた報告を既読にする */
  const dismissOverwrites = useCallback(() => {
    const entries = overwriteNotice.reports.flatMap((r) => {
      const key = overwriteNoticeKeyOf(r);
      const fileId = overwriteFileRef.current.get(key);
      return fileId === undefined ? [] : [{ fileId, key }];
    });
    for (const [fileId, keys] of groupByFile(entries)) {
      void dismissals.dismiss(fileId, keys);
    }
    overwriteFileRef.current.clear();
    setOverwriteNotice(NO_OVERWRITE_NOTICE);
  }, [overwriteNotice, dismissals]);

  return {
    conflictNotice,
    showConflicts,
    closeConflictNotice,
    overwriteNotice,
    handleOverwrites,
    dismissOverwrites,
    arrivedForks,
    handleForksArrived,
  };
}
