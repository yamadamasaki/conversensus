/**
 * 保存領域を開けなかった理由の札 (#50 i18n)。worker から画面へ送る
 *
 * worker は端末に覚えた画面の言語を読めない (`localStorage` が無い) ので、文ではなく札を送り、
 * 画面の側で辞書から文にする (`workerBackend.ts` の `startFailureReason`)。
 * **ここは辞書を読み込まない** — worker の中に辞書と React を持ち込まないため
 */
export const STORAGE_FAILURE = {
  noOpfs: 'storage:no-opfs',
  noIsolation: 'storage:no-isolation',
} as const;
