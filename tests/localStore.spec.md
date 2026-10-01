# localStore.spec.ts — ブラウザ内のローカル正典 (step3 Phase 2 S2-3)

## 何を

ローカルサーバをやめ、op-log と blob をブラウザの OPFS 上の SQLite (SQLite-WASM、`opfs` VFS、
dedicated Worker) に置いた。そのうち**エンジンをまたいで壊れうる所**を見る。

## なぜ

中身のロジック (`LocalStore`) は単体と App 結合が `bun:sqlite` の上で見ている。ブラウザで
新しく効くのは次の 3 つで、どれも bun では確かめられない:

1. **SQLite-WASM のドライバが `bun:sqlite` と同じに振る舞う** — でなければ、テストで通した
   `EventStore` がブラウザで違う答えを出す
2. **本当に OPFS に保存されている** — メモリ上の DB でも画面は普通に動くので、見た目では
   区別できない
3. **保存領域の無い窓で黙って動かない** — WebKit は使い捨ての context (≒ プライベート
   ブラウズ) で OPFS を拒む (S0-4)。メモリに落とすと、閉じた瞬間に編集が消える

## どのように

| テスト | 見ること |
| --- | --- |
| ドライバの契約 | `sqlDriverContract.ts` を、開発ビルドが出す口 (`window.__conversensus.runDriverContract`) から Worker の中の SQLite-WASM に当てる。違反の一覧が空であること |
| 🔴 再読み込みの後も残る | File を作り、再読み込みしてもサイドバーに居る。未処理例外・コンソールエラーが 0 件 |
| 🔴 保存領域の無い窓 | **使い捨ての context** (`@playwright/test` の素の `test`) で開き、「この窓では保存できません」が出て、ファイル名の入力欄が無い。**WebKit だけ** — Chromium は使い捨ての context でも OPFS を開ける |

他のテストは `fixtures.ts` の persistent context (テストごとに新しいプロファイル) で走る。

変異で確かめたこと: Worker の DB をメモリにすると「再読み込みの後も残る」が、ドライバの
トランザクションを外すと「ドライバの契約」が落ちる。

## テストしていないこと

- **複数のタブ** — S2-4 (タブごとの actor とタブ間の知らせ)
- **cross-origin isolation が無いとき** — 開発サーバと本番の配信がヘッダを付けるので、
  E2E からは作れない。そのときも同じ画面が出る (理由の文言が違う)
- **`persist()` と ITP の消去** — 自動化では見えない (S0-4 の注意 3)。実機で見る
