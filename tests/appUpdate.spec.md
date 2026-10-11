# appUpdate.spec.ts — 新しい版の知らせ (#262)

## 何を

- 配信の版の印 (`version.json`) が変わらなければ知らせず、変われば**タブが前に戻ったとき**に
  「新しい版があります」を出し、再読み込みで消えること
- service worker が画面を握っていても、`version.json` を**キャッシュに入れず**毎回配信から取ること

## なぜ

版の印は build でだけ出し、service worker も本番ビルドでだけ登録するので、開発サーバで走る他の E2E は
どちらも通らない。ここは本番ビルド (`vite preview`, :5185 — `tests/ports.ts`) で開く。

service worker は同じ origin の GET を**キャッシュを先に**返す。`version.json` までそうすると、
最初に取った印を返し続け、**新しい版に永遠に気付けない**。これは単体では見えない (service worker は
ブラウザの中でしか動かない) ので E2E で見る。`sw.js` から素通しの 1 行を外すと、2 つ目のテストが
両方のエンジンで落ちることを確かめてある。

## どのように

- 新しい版を配ったことは、`version.json` の応答を `page.route` で差し替えて作る
- **1 つ目は Chromium だけ。**Playwright の WebKit は、service worker が素通しした要求を
  `page.route` で差し替えられない (service worker が画面を握った後は、差し替えずに配信の応答が届いた)。
  知らせの描き方はエンジンに依らない (単体と同じ React) ので、ここで落とすものは無い
- 2 つ目は応答を差し替えず、`caches.match('/version.json')` が空であることを見る。両方のエンジンで走る
- どちらも `pageProblems` で、未処理例外・コンソールエラー・読み込み失敗が 0 件であることを見る
