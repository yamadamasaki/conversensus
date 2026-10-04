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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pdsNoticeDismissalStore } from '../atproto/noticeDismissalStore';
import { loadNotices, saveNotices } from '../notices/noticeCache';
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
import { safeLocalStorage } from '../sync/safeStorage';
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
  /**
   * 受け取り口は**いまの**既読を引く。セッションの復元の前に始まった受信や読み込みが、
   * 復元の後で古い (保存先の無い) 既読で通知を通さないように
   */
  const dismissalsRef = useRef(dismissals);
  dismissalsRef.current = dismissals;

  const [conflictNotice, setConflictNotice] =
    useState<ConflictNoticeState>(NO_CONFLICT_NOTICE);
  /**
   * 競合の通知は**検出のたびに置き換わる**。既読を待つ間に次の検出が来たら、遅れて
   * 解けた古い方で上書きしない
   */
  const conflictSeqRef = useRef(0);

  /** いま競合の通知に出ている競合の鍵 (fork を重ねないため) */
  const shownConflictKeysRef = useRef(new Set<NoticeKey>());
  /** いま競合の通知に出ている File (actor が替わったときに既読で落とし直すため) */
  const conflictFileRef = useRef<FileId | undefined>(undefined);
  useEffect(() => {
    conflictFileRef.current = conflictNotice.fileId;
    shownConflictKeysRef.current = new Set(
      conflictNotice.conflicts.map(conflictNoticeKeyOf),
    );
  }, [conflictNotice]);

  /**
   * 競合の通知を出す (implicit / explicit merge)。既読のものを落とす。
   * fileId の無い通知 (古い呼び出し元) は落とさずに出す
   */
  const showConflicts = useCallback((notice: ConflictNoticeState) => {
    const seq = ++conflictSeqRef.current;
    const fileId = notice.fileId;
    if (fileId === undefined || notice.conflicts.length === 0) {
      setConflictNotice(notice);
      return;
    }
    void dismissalsRef.current.dismissedIn(fileId).then((dismissed) => {
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
  }, []);

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
      void dismissalsRef.current.dismissedIn(fileId).then((dismissed) => {
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
    [],
  );

  /**
   * 相手が保留した競合 (fork) の到着 (Phase 3 T7-5)。**競合の通知に出す** — ただし競合の
   * 検出は毎回置き換わるので、同じ state に入れると次の検出で消える。受信サイクルをまたいで
   * 溜め、通知を閉じたときに一緒に消す
   */
  const [arrivedForks, setArrivedForks] =
    useState<readonly ForkMeta[]>(NO_ARRIVED_FORKS);
  /** actor が替わったときに既読で落とし直すため (effect の外から今の値を読む) */
  const arrivedForksRef = useRef(arrivedForks);
  arrivedForksRef.current = arrivedForks;
  const handleForksArrived = useCallback((forks: readonly ForkMeta[]) => {
    const byFile = new Map<FileId, ForkMeta[]>();
    for (const fork of forks) {
      byFile.set(fork.trunkFileId, [
        ...(byFile.get(fork.trunkFileId) ?? []),
        fork,
      ]);
    }
    for (const [fileId, ofFile] of byFile) {
      void dismissalsRef.current.dismissedIn(fileId).then((dismissed) => {
        // 競合の通知に出ている競合の fork は重ねない (同じ出来事。自分が検出して書いた fork を、
        // 再読み込みの後に op-log から求め直したときに起きる)
        const fresh = ofFile.filter(
          (f) =>
            !dismissed.has(forkNoticeKeyOf(f)) &&
            !shownConflictKeysRef.current.has(forkNoticeKeyOf(f)),
        );
        setArrivedForks((prev) => accumulateArrivedForks(prev, fresh));
      });
    }
  }, []);

  // --- 端末の控え (S6-1b, 設計 Q2) ---

  const storage = useMemo(() => safeLocalStorage(), []);
  /**
   * 控えを読み終えた actor。**読み終える前に書かない** — 書くと、まだ空の state で
   * その actor の控えを上書きしてしまう。`undefined` はまだ誰の分も読んでいない
   */
  const [loadedFor, setLoadedFor] = useState<Did | null | undefined>(undefined);

  // actor が替わったら (起動時のセッションの復元を含む) その人の控えを読み、
  // 他の端末で閉じられたものを落とす
  useEffect(() => {
    const cached = loadNotices(storage, did);
    setLoadedFor(did);
    // **置き換えずに足す。**受信はセッションの復元 (did が state に載る) より先に走りうるので、
    // 読み終える前に検出した通知が既にある。それを消さない
    let conflictFile = conflictFileRef.current;
    if (cached !== null) {
      for (const [key, fileId] of cached.overwrites.files) {
        overwriteFileRef.current.set(key, fileId);
      }
      if (conflictFile === undefined) conflictFile = cached.conflicts.fileId;
      setConflictNotice((prev) =>
        prev.conflicts.length > 0
          ? prev
          : { ...cached.conflicts, labels: new Map(cached.conflicts.labels) },
      );
      setOverwriteNotice((prev) =>
        accumulateOverwrites(
          {
            reports: cached.overwrites.reports,
            labels: new Map(cached.overwrites.labels),
          },
          prev,
        ),
      );
    }

    // 控えから戻したものも、復元の前に検出したものも、既読で落とす
    if (conflictFile !== undefined) {
      void dismissals.dismissedIn(conflictFile).then((dismissed) => {
        setConflictNotice((prev) => {
          const conflicts = prev.conflicts.filter(
            (c) => !dismissed.has(conflictNoticeKeyOf(c)),
          );
          return conflicts.length === prev.conflicts.length
            ? prev
            : {
                ...prev,
                conflicts,
                forkCount: Math.min(prev.forkCount ?? 0, conflicts.length),
              };
        });
      });
    }
    for (const fileId of new Set(overwriteFileRef.current.values())) {
      void dismissals.dismissedIn(fileId).then((dismissed) => {
        setOverwriteNotice((prev) => ({
          ...prev,
          reports: prev.reports.filter((r) => {
            const key = overwriteNoticeKeyOf(r);
            return !(
              overwriteFileRef.current.get(key) === fileId && dismissed.has(key)
            );
          }),
        }));
      });
    }
    for (const fileId of new Set(
      arrivedForksRef.current.map((f) => f.trunkFileId),
    )) {
      void dismissals.dismissedIn(fileId).then((dismissed) => {
        setArrivedForks((prev) =>
          prev.filter(
            (f) =>
              !(f.trunkFileId === fileId && dismissed.has(forkNoticeKeyOf(f))),
          ),
        );
      });
    }
  }, [did, storage, dismissals]);

  useEffect(() => {
    if (loadedFor !== did) return;
    saveNotices(storage, did, {
      conflicts: {
        ...conflictNotice,
        labels: [...conflictNotice.labels],
      },
      overwrites: {
        reports: overwriteNotice.reports,
        labels: [...overwriteNotice.labels],
        files: [...overwriteFileRef.current],
      },
    });
  }, [conflictNotice, overwriteNotice, loadedFor, did, storage]);

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
