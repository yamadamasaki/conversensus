import { GlobalRegistrator } from '@happy-dom/global-registrator';

// environment = "happy-dom" (bunfig.toml) が有効な場合は既に DOM が利用可能なため
// 二重登録を避けるためにスキップする
if (typeof globalThis.document === 'undefined') {
  // happy-dom は大域の Response を自分のものに替える。bun 1.4 の Bun.serve は bun の Response しか
  // 受けず、受け口 (oauthLoopback) の応答が例外になる。Response だけは bun のものに戻す
  const NativeResponse = globalThis.Response;
  GlobalRegistrator.register();
  globalThis.Response = NativeResponse;
}

// 画面の言語を ja に固定する (#50 i18n)。テストは日本語の文言で要素を引くが、happy-dom の
// navigator.language は en-US で、ブラウザに従うと en で描かれる。言語の選択は辞書を読む前
// (モジュールの読み込み時) に決まるので、ここで先に固める
Object.defineProperty(globalThis.navigator, 'languages', {
  configurable: true,
  get: () => ['ja-JP'],
});
Object.defineProperty(globalThis.navigator, 'language', {
  configurable: true,
  get: () => 'ja-JP',
});
