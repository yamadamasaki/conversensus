/**
 * 閉じていない通知の端末の控え (step3 Phase 6 S6-1b, 設計 Q2)
 *
 * 競合と上書きの通知は「受信前の手元」を分岐点にして検出するので、受信が済んだ後には
 * 求め直せない (設計 F4)。閉じる前に再読み込みすると消えてしまうので、**この端末の
 * localStorage に控える**。PDS には置かない — 内容は導出、PDS は既読だけ (Q4)。
 *
 * fork は op-log から求め直せるので控えない (`openForksOf`)。
 *
 * **actor (DID) ごとに分ける。**同じブラウザで別の人がログインしたら、その人の通知ではない。
 */

import type { Did, FileId, MergeConflict } from '@conversensus/shared';
import type { OverwriteReport } from '../sync/overwrites';
import type { NoticeKey } from './types';

const CACHE_KEY_PREFIX = 'conversensus.notices';
/** ログインしていない端末の控え */
const LOCAL_ACTOR = 'local';

/** 控えの形。Map は JSON にならないので組の配列で持つ */
export type CachedNotices = {
  conflicts: {
    fileId?: FileId;
    conflicts: MergeConflict[];
    labels: [string, string][];
    forkCount?: number;
  };
  overwrites: {
    reports: OverwriteReport[];
    labels: [string, string][];
    /** 報告の既読の鍵 → File (報告そのものは File を持たない) */
    files: [NoticeKey, FileId][];
  };
};

export function noticeCacheKey(did: Did | null): string {
  return `${CACHE_KEY_PREFIX}.${did ?? LOCAL_ACTOR}`;
}

export function saveNotices(
  storage: Storage | null,
  did: Did | null,
  notices: CachedNotices,
): void {
  if (storage === null) return;
  const empty =
    notices.conflicts.conflicts.length === 0 &&
    notices.overwrites.reports.length === 0;
  try {
    if (empty) storage.removeItem(noticeCacheKey(did));
    else storage.setItem(noticeCacheKey(did), JSON.stringify(notices));
  } catch (err) {
    // 容量超過など。控えが残らないだけで、画面の通知は消えない
    console.warn('[notices] failed to save notices', err);
  }
}

const isPairs = (value: unknown): value is [string, string][] =>
  Array.isArray(value) &&
  value.every(
    (pair) =>
      Array.isArray(pair) &&
      pair.length === 2 &&
      typeof pair[0] === 'string' &&
      typeof pair[1] === 'string',
  );

/**
 * 控えを読む。無い・壊れているなら `null` (通知が出ないだけで、害は無い)。
 *
 * 中身の競合・報告の形までは検証しない。書いたのはこの端末の同じアプリで、
 * 外から来る値ではない
 */
export function loadNotices(
  storage: Storage | null,
  did: Did | null,
): CachedNotices | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(noticeCacheKey(did));
    if (raw === null) return null;
    const value = JSON.parse(raw) as CachedNotices;
    const ok =
      Array.isArray(value?.conflicts?.conflicts) &&
      isPairs(value.conflicts.labels) &&
      Array.isArray(value?.overwrites?.reports) &&
      isPairs(value.overwrites.labels) &&
      isPairs(value.overwrites.files);
    return ok ? value : null;
  } catch {
    return null;
  }
}
