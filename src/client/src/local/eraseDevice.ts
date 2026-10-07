/**
 * この端末の conversensus のデータを消す (#288 — 共有の端末)。
 *
 * ログアウトしても手元の正典 (OPFS) は残るので、同じブラウザで次にログインした人に前の人の File が
 * 見える。ログアウトのときに「この端末のデータも消す」を選べるようにする (既定は残す)。
 *
 * **消すのは次の起動の最初** (二段階):
 *
 * 1. ログアウトの後、印 (`sessionStorage`) を付けて再読み込みする (`requestErase`)
 * 2. 起動の最初、保存領域 (Worker の SQLite) も OAuth の client も開く前に、印があれば消す
 *    (`eraseIfRequested`)
 * 3. 消したら保存領域を開き直さず、「消しました」の画面だけを出す (`main.tsx`)。次に開けば空から始まる
 *
 * 動いている画面の中では消せない — 正典の DB は Worker が OPFS の同期ハンドルで開いたままで、
 * OAuth の client は IndexedDB の接続を持ったままだから。起動の最初なら、このタブは何も開いていない。
 *
 * **別のタブが開いていれば消さない**。そのタブの Worker が同じ DB を開いている。タブは deviceId の
 * Web Lock を持つ (`deviceClaim.ts`) ので、それで数える。
 */

import { DEVICE_LOCK_PREFIX } from './deviceClaim';

/** 消す印 (このタブの再読み込みをまたいで残る) */
export const ERASE_REQUEST_KEY = 'conversensus_erase_requested';
const ERASE_REQUESTED = '1';

/** OPFS の消去が、閉じたばかりのハンドルに阻まれたときに待ち直す回数と間隔 */
const REMOVE_RETRIES = 5;
const REMOVE_RETRY_MS = 100;
/** IndexedDB の削除の返事を待つ上限 */
const DELETE_DATABASE_WAIT_MS = 2_000;

export type EraseOutcome = 'none' | 'erased' | 'otherTabs';

/** `navigator.locks.query()` のうち使う部分 */
export type LockQuery = () => Promise<{ held?: { name?: string }[] }>;

/** OPFS の根のうち使う部分 */
export type OpfsRoot = {
  keys(): AsyncIterable<string>;
  removeEntry(name: string, options: { recursive: true }): Promise<void>;
};

export type EraseDeps = {
  session: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  local: Pick<Storage, 'clear'>;
  /** Web Locks が無ければ undefined (別のタブを数えられない) */
  queryLocks: LockQuery | undefined;
  opfsRoot: () => Promise<OpfsRoot>;
  /** IndexedDB の DB の名前の一覧と、1 つを消す */
  listDatabases: () => Promise<string[]>;
  deleteDatabase: (name: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * 別の conversensus のタブが開いているか。**数えられないとき (Web Locks が無い) は開いているとみなす** —
 * 消してよいと言えないなら消さない。`selfHolds` はこのタブ自身が deviceId の lock を持っているか
 * (起動の最初はまだ持っていない)
 */
export async function otherTabsOpen(
  queryLocks: LockQuery | undefined,
  selfHolds: boolean,
): Promise<boolean> {
  if (!queryLocks) return true;
  const { held = [] } = await queryLocks();
  const tabs = held.filter((lock) =>
    lock.name?.startsWith(DEVICE_LOCK_PREFIX),
  ).length;
  return tabs > (selfHolds ? 1 : 0);
}

/** 次の起動で消す印を付ける (この後に再読み込みする) */
export function requestErase(session: Pick<Storage, 'setItem'>): void {
  session.setItem(ERASE_REQUEST_KEY, ERASE_REQUESTED);
}

/** 起動の最初に呼ぶ。印があれば (別のタブが無ければ) 消す */
export async function eraseIfRequested(deps: EraseDeps): Promise<EraseOutcome> {
  if (deps.session.getItem(ERASE_REQUEST_KEY) !== ERASE_REQUESTED)
    return 'none';
  // 印は先に外す — 消す途中で失敗しても、起動のたびに消し直そうとしない
  deps.session.removeItem(ERASE_REQUEST_KEY);
  if (await otherTabsOpen(deps.queryLocks, false)) return 'otherTabs';

  const root = await deps.opfsRoot();
  const names: string[] = [];
  for await (const name of root.keys()) names.push(name);
  for (const name of names) await removeWithRetry(root, name, deps.sleep);

  for (const name of await deps.listDatabases())
    await deps.deleteDatabase(name);
  deps.local.clear();
  return 'erased';
}

/** 閉じたばかりの同期ハンドルが解けるまで少し待ち直す (ブラウザによっては解放が遅れる) */
async function removeWithRetry(
  root: OpfsRoot,
  name: string,
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await root.removeEntry(name, { recursive: true });
      return;
    } catch (error) {
      if (attempt >= REMOVE_RETRIES) throw error;
      await sleep(REMOVE_RETRY_MS);
    }
  }
}

/** ブラウザの本物を束ねる */
export function browserEraseDeps(): EraseDeps {
  return {
    session: sessionStorage,
    local: localStorage,
    queryLocks: navigator.locks
      ? () => navigator.locks.query() as ReturnType<LockQuery>
      : undefined,
    opfsRoot: async () =>
      (await navigator.storage.getDirectory()) as unknown as OpfsRoot,
    listDatabases: async () =>
      (await indexedDB.databases()).flatMap((db) => (db.name ? [db.name] : [])),
    deleteDatabase: (name) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        // blocked は他の接続が閉じるのを待っている状態。起動の最初なので、別のタブが無ければ
        // そのうち通る。止まらずに次へ進む (消し終わるのはブラウザの側)
        request.onblocked = () => resolve();
        // どちらも来ないまま待ち続けると「消した」の画面に進めない。少し待って先へ進む
        setTimeout(resolve, DELETE_DATABASE_WAIT_MS);
      }),
  };
}
