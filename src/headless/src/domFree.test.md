# domFree.test.ts — DOM の無い bun のテスト仕様

## 何を

headless が**素の bun のプロセス** (DOM 無し) で、参加・受信・書き込みを一周できること。
そして**終われば自分でプロセスが終わる**こと。

## なぜ

- `bun test` は preload で happy-dom を入れる (`bunfig.toml`)。テストの中では `window`・`document`・
  `localStorage` が在ってしまい、**ブラウザへの依存が隠れる**。agent が実際に走るのは DOM の無い
  プロセスである
- spike (計画 §2.1 S4) で、ブラウザ版の OAuth (`@atproto/oauth-client-browser`) を読み込んだだけで
  **プロセスが終わらなくなった**。常駐しない使い方 (CLI・一度だけの同期) では致命的になる

## どのように

`testing/domFreeRun.ts` を**別のプロセス**で `bun run` する (preload が効かない)。script は最初に
DOM の大域が無いことを確かめ、alice と agent を順に開いて一周させ、結果を `RESULT {...}` の 1 行で返す。
**`process.exit` を呼ばない。**

- 子が 20 秒以内に終了コード 0 で終わる。時間切れなら終わらなかったとみなす
- agent が書いた node を alice が読める。偽の PDS の外へは通信しない

壊して確かめた: script でブラウザ版の OAuth を import すると、時間切れで落ちる。
