/**
 * この端末だけの File (#253)
 *
 * 未ログインで作った File は、ログインしたときに「送るか」を訊く (FPR 前 L-1)。以前は「送らない」と
 * 答えても **File の起源 (genesis: 名前・最初の Sheet) はログインで送られ**、ログインした後の編集も
 * 送られた。「この端末にだけ残ります」という答えの範囲の外だった。
 *
 * そこで File ごとに「この端末だけ」の印を持ち、印のある File は **何も送らない** (genesis も、
 * ログインした後の編集も)。送る口は 1 つ (`RemoteSyncQueue.enqueue`) なので、そこで止める。
 *
 * - **未ログインで作った File は、作ったときから印を付ける** (`pending`)。ログインの直後は、問いに
 *   答えるより先に開いている File の catch-up が走るので、答えてから印を付けたのでは genesis が先に出る
 * - 問いに「送る」と答えたら印を外して送る。「送らない」と答えたら `declined` にし、次のログインでは
 *   訊かない。後から送るときは File の詳細の「アカウントに保存する」から
 * - **branch の op-log は別の file id を持つ**ので、印のある File に作った branch にも同じ印を付け、
 *   元の File (`trunk`) を覚えておく。印を外すときは branch ごと外す
 *
 * 端末の状態なので `localStorage` に置く (共有しない — 印は「この端末から出さない」という意味である)。
 */

import type { FileId } from '@conversensus/shared';
import { z } from 'zod';
import { safeLocalStorage } from './safeStorage';

export const LOCAL_ONLY_FILES_KEY = 'conversensus.localOnlyFiles';
/** 同じタブの中で印が変わったことを知らせる。別のタブへは `storage` イベントが届く */
const CHANGE_EVENT = 'conversensus:local-only-files';

/** `pending`: 未ログインで作り、まだ訊いていない / `declined`: 送らないと答えた */
export type LocalOnlyState = 'pending' | 'declined';

export type LocalOnlyEntry = {
  state: LocalOnlyState;
  /** branch の op-log なら、その元の File */
  trunk?: FileId;
};

const EntrySchema = z.object({
  state: z.enum(['pending', 'declined']),
  trunk: z.string().optional(),
});
const StoreSchema = z.record(z.string(), EntrySchema);

export type LocalOnlyFiles = ReadonlyMap<FileId, LocalOnlyEntry>;

export function readLocalOnlyFiles(
  storage: Storage | null = safeLocalStorage(),
): LocalOnlyFiles {
  try {
    const raw = storage?.getItem(LOCAL_ONLY_FILES_KEY);
    if (!raw) return new Map();
    const parsed = StoreSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return new Map();
    return new Map(
      Object.entries(parsed.data).map(([id, e]) => [
        id as FileId,
        { state: e.state, ...(e.trunk && { trunk: e.trunk as FileId }) },
      ]),
    );
  } catch {
    return new Map();
  }
}

function write(files: LocalOnlyFiles, storage: Storage | null): void {
  try {
    storage?.setItem(
      LOCAL_ONLY_FILES_KEY,
      JSON.stringify(Object.fromEntries(files)),
    );
  } catch (error) {
    // 書けなければ印が残らない。送らない約束を守れないので、黙らずに残す
    console.warn('[local-only] この端末だけの印を保存できなかった:', error);
  }
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** この File (branch を含む) から送ってはならないか */
export function isLocalOnlyFile(
  fileId: FileId,
  storage: Storage | null = safeLocalStorage(),
): boolean {
  return readLocalOnlyFiles(storage).has(fileId);
}

/** 印を付ける。branch なら元の File の印を写す */
export function markLocalOnly(
  fileId: FileId,
  entry: LocalOnlyEntry,
  storage: Storage | null = safeLocalStorage(),
): void {
  const files = new Map(readLocalOnlyFiles(storage));
  files.set(fileId, entry);
  write(files, storage);
}

/**
 * 印のある File に作った branch に、同じ印を付ける。元の File に印が無ければ何もしない
 */
export function inheritLocalOnly(
  branchFileId: FileId,
  trunk: FileId,
  storage: Storage | null = safeLocalStorage(),
): void {
  const entry = readLocalOnlyFiles(storage).get(trunk);
  if (entry)
    markLocalOnly(branchFileId, { state: entry.state, trunk }, storage);
}

/** 「送らない」と答えた File を `declined` にする (branch も)。印の無い File にも付ける */
export function declineLocalOnly(
  fileIds: readonly FileId[],
  storage: Storage | null = safeLocalStorage(),
): void {
  const files = new Map(readLocalOnlyFiles(storage));
  const asked = new Set(fileIds);
  for (const id of fileIds) files.set(id, { state: 'declined' });
  for (const [id, entry] of files) {
    if (entry.trunk && asked.has(entry.trunk))
      files.set(id, { state: 'declined', trunk: entry.trunk });
  }
  write(files, storage);
}

/**
 * 印を外す (送ってよくなった)。**branch ごと外す。**外した file id (元の File と branch) を返す —
 * 呼び出し側はそれぞれの catch-up で送る
 */
export function releaseLocalOnly(
  trunk: FileId,
  storage: Storage | null = safeLocalStorage(),
): FileId[] {
  const files = new Map(readLocalOnlyFiles(storage));
  const released = [...files]
    .filter(([id, entry]) => id === trunk || entry.trunk === trunk)
    .map(([id]) => id);
  if (released.length === 0) return [];
  for (const id of released) files.delete(id);
  write(files, storage);
  return released;
}

/** 印の変化を聞く (同じタブ・別のタブ) */
export function subscribeLocalOnlyFiles(listener: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === LOCAL_ONLY_FILES_KEY) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
