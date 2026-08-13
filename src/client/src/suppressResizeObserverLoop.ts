/**
 * ResizeObserver のループ通知だけを握り潰す (ANA-125 S4)
 *
 * **これは「無言の失敗を作らない」の例外である。** 例外にする理由を書いておく。
 *
 * WebKit (Safari / WKWebView) では, ノードのサイズ変更ハンドルを掴んで動かすと
 * `ResizeObserver loop completed with undelivered notifications.` が**未処理例外として**
 * 毎フレーム上がる。実 Safari の使い込みで数百件出た。Chromium では出ない (実測)。
 *
 * - **出所は我々のコードではない** — `ResizeObserver` は `@xyflow/react` (12.6.4) の中に
 *   2 箇所あり, どちらも rAF で包まれていない。アプリ側から直せる場所が無い
 * - **仕様上は非致命である** — 「このフレームで配りきれなかった通知を次フレームへ回した」
 *   という意味で, 観測も再描画も落ちていない
 * - **放置するとコンソールが読めなくなる** — コンソールは step1 が一貫して
 *   「無言の失敗」を見つけるために使ってきた唯一の道具である
 *   (`deepse/requirements/user-test-environment.md` §7.2)。数百件のノイズはその道具を壊す
 *
 * だから**このメッセージだけ**を消す。合致は既知の 2 文の前方一致に限る —
 * 広いパターンにすると, いつか本物のエラーを一緒に消す。
 */

/** 既知の ResizeObserver ループ通知。engine ごとに文言が違うので両方持つ */
const RESIZE_OBSERVER_LOOP_MESSAGES = [
  // WebKit / Chromium (現行)
  'ResizeObserver loop completed with undelivered notifications',
  // Chromium (旧)
  'ResizeObserver loop limit exceeded',
] as const;

/** そのメッセージが ResizeObserver のループ通知か */
export function isResizeObserverLoopMessage(message: string): boolean {
  return RESIZE_OBSERVER_LOOP_MESSAGES.some((known) =>
    message.startsWith(known),
  );
}

/**
 * ループ通知を既定の報告 (コンソールへの出力) から外す。**戻り値は解除関数**である。
 *
 * capture フェーズで登録するのは, 他のエラーハンドラより先に判定するためである。
 */
export function suppressResizeObserverLoopErrors(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  const handler = (event: Event) => {
    const message = (event as ErrorEvent).message ?? '';
    if (!isResizeObserverLoopMessage(message)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  target.addEventListener('error', handler, true);
  return () => target.removeEventListener('error', handler, true);
}
