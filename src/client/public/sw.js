/**
 * service worker (step3 Phase 2 S2-5) — **オフラインで起動する**ためだけのもの
 *
 * - 画面 (navigation) は**ネットワークを先に**、繋がらなければ最後に取れた画面を返す。
 *   繋がっていれば常に新しい版が届く
 * - それ以外の同じ origin の GET (ビルドの成果物・Worker・SQLite-WASM の .wasm) は
 *   **キャッシュを先に**。ビルドの成果物は名前に hash が入るので、同じ URL の中身は変わらない
 * - **別の origin (PDS など) には触らない**。同期は op-log の側の仕事で、ここで古い応答を返すと
 *   受信が壊れる
 *
 * 保存した応答はヘッダごと残るので、オフラインで返す画面にも COOP/COEP が付いたままになる
 * (cross-origin isolation が無いと SQLite-WASM の `opfs` VFS が開けない)。
 *
 * 新しい版の出し方 (設計 U2、#262): 開いているタブは `version.json` を見て「新しい版があります」を
 * 出し、利用者が再読み込みする (`src/update/appUpdate.ts`)。**`version.json` はここで握らない** —
 * キャッシュから返すと、古い印を見て新しい版に気付けない。
 */

const CACHE_NAME = 'conversensus-v1';
/** オフラインで返す画面の鍵 */
const APP_SHELL = '/';
/** 新しい版の印。常にネットワークから取らせる (`src/update/appUpdate.ts` の `VERSION_PATH`) */
const VERSION_PATH = '/version.json';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

async function networkFirstShell(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(APP_SHELL, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(APP_SHELL);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  // **元の Request を渡し直さず、URL から取り直す。**WebKit では、Worker のスクリプトの要求を
  // そのまま `fetch(request)` すると "Load failed" で落ち、Worker が起動できなかった
  // (offline.spec.ts の「service worker が握った画面でも…」)
  const response = await fetch(request.url);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === VERSION_PATH) return;
  event.respondWith(
    request.mode === 'navigate'
      ? networkFirstShell(request)
      : cacheFirst(request),
  );
});
