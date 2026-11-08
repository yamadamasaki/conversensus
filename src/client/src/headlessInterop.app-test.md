# headlessInterop.app-test.tsx — ブラウザの人間と headless の agent の App 結合の仕様

## 何を

App (ブラウザの画面) の alice と、headless (`src/headless`) の agent が、同じ偽の PDS の上で
招待・参加・読み書きを一周すること (agent 段 2 の完了基準 1〜4)。

## なぜ

headless は client の部品を**別に組み立てる** (ブラウザでは hooks が組み立てる)。部品は同じでも、
組み立ての食い違い (名簿の読み方、送る batch の選び方、発番器の戻し方) は、**片方だけを見るテストでは
捕まらない**。App 結合が「フックと子の間を一周する値」を見るのと同じ理由で、App と headless の間を
一周させる。

## どのように

App 結合の世界 (`testing/appWorld.ts`) の中で、端末の切り替えと同じように App と headless を
交互に動かす。headless は 1 プロセスに 1 つで、開くと正典・認証の口・`localStorage` を差し替え、
閉じると戻す。閉じたときに外れる認証の口は、App 結合の口 (パスワード) を入れ直す。

- 🔴 App の alice が File を作って node を 1 つ置き、agent を招待する → headless の agent が
  参加コードで参加し、alice の File と node を読み、node を 1 つ書いて送る → alice が同期すると、
  **agent の node が alice の画面に描かれる**
- agent の書き込みは agent の repo にあり、agent の actor で書かれている (由来, 設計 D1)
