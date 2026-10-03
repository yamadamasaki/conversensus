/**
 * 閉じた通知の集合 (step3 Phase 6 S6-1a)
 *
 * 通知の内容は受信のたびに検出し、PDS には「閉じた」ことだけを置く (設計 Q4)。
 * ここはその集合を File ごとに読み、閉じたものを足す。
 *
 * - **足すだけ** (grow-only set)。2 台が同時に別の通知を閉じても両方残る (Q1)
 * - **File ごとに 1 度だけ読む。**通知を出す前に `dismissedIn` を待つので、起動直後の
 *   catch-up で出る通知も、読み終えてから落とされる
 * - 保存先が無い (ログインしていない) ときは、この端末の記憶の中だけで動く
 */

import type { FileId } from '@conversensus/shared';
import type { NoticeDismissal, NoticeKey } from './types';

/** 閉じた通知の保存先 (PDS)。テストでは偽物を渡す */
export type NoticeDismissalStore = {
  listByFile: (fileId: FileId) => Promise<NoticeDismissal[]>;
  put: (dismissal: NoticeDismissal) => Promise<void>;
};

export class NoticeDismissals {
  private readonly loaded = new Map<FileId, Promise<Set<NoticeKey>>>();

  private readonly store: NoticeDismissalStore | null;
  private readonly now: () => Date;

  constructor(
    store: NoticeDismissalStore | null,
    now: () => Date = () => new Date(),
  ) {
    this.store = store;
    this.now = now;
  }

  /** その File の閉じた通知の鍵。初回だけ保存先から読む */
  dismissedIn(fileId: FileId): Promise<ReadonlySet<NoticeKey>> {
    return this.setOf(fileId);
  }

  /**
   * 通知を閉じる。手元の集合へはすぐに足し、保存先へは 1 件ずつ書く。
   *
   * **書けなくても例外にしない** (警告だけ)。閉じる操作そのものは手元で済んでいて、
   * 失うのは「他の端末で出さない」ことだけである
   */
  async dismiss(fileId: FileId, keys: readonly NoticeKey[]): Promise<void> {
    const set = await this.setOf(fileId);
    const fresh = [...new Set(keys)].filter((key) => !set.has(key));
    for (const key of fresh) set.add(key);
    const store = this.store;
    if (store === null || fresh.length === 0) return;
    const dismissedAt = this.now().toISOString();
    await Promise.all(
      fresh.map((key) =>
        store.put({ fileId, key, dismissedAt }).catch((err: unknown) => {
          console.warn('[notices] failed to record a dismissal', err);
        }),
      ),
    );
  }

  private setOf(fileId: FileId): Promise<Set<NoticeKey>> {
    let set = this.loaded.get(fileId);
    if (set === undefined) {
      set = this.load(fileId);
      this.loaded.set(fileId, set);
    }
    return set;
  }

  private async load(fileId: FileId): Promise<Set<NoticeKey>> {
    if (this.store === null) return new Set();
    try {
      const dismissals = await this.store.listByFile(fileId);
      return new Set(dismissals.map((d) => d.key));
    } catch (err) {
      // 読めなければ何も落とさない (通知が出直すだけ)。次に訊かれたら読み直す
      console.warn('[notices] failed to read dismissals', err);
      this.loaded.delete(fileId);
      return new Set();
    }
  }
}
