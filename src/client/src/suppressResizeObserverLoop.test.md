# suppressResizeObserverLoop.test.ts — ResizeObserver ループ通知の抑止

## 何をテストするか

`ResizeObserver loop ...` の error イベントだけを既定の報告から外し, **それ以外のエラーには
触らない**こと。および**解除できる**こと。

## なぜテストするか

これは「無言の失敗を作らない」という step1 の原則に対する**意図的な例外**である。
例外である以上, **どこまでを消すのかを検査で固定しておかないと危険**である —
合致の条件が少しでも広がると, 本物のエラーが黙って消える。

WebKit ではノードのサイズ変更中にこの通知が未処理例外として数百件上がり,
コンソールが読めなくなる (経緯とエンジン差の実測は `tests/nodeResize.spec.md` と
モジュール冒頭のコメント)。出所は `@xyflow/react` の中なのでアプリ側に直す場所が無い。

## どのようにテストするか

- **既知の 2 文を認める**: WebKit/Chromium 現行の
  「completed with undelivered notifications」と Chromium 旧版の「loop limit exceeded」。
  文言はエンジンとバージョンで違うので両方を持つ
- **`ResizeObserver` を含む別のエラーは認めない**: 例として
  `TypeError: ... (evaluating 'new ResizeObserver()')` を与える。
  `includes('ResizeObserver')` のような広い条件で書いていれば, ここで落ちる
- **preventDefault の効きを値で見る**: `cancelable: true` の `ErrorEvent` を `dispatchEvent`
  して `defaultPrevented` を確認する。ハンドラが呼ばれたかではなく **結果**を見る
- **解除関数を検査する**: 解除した後は通知も素通しになること。
  消し続ける仕掛けを残さないための保証である
