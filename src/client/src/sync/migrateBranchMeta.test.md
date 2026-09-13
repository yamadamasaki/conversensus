# migrateBranchMeta テスト仕様 (step2 Phase 3 T7-6)

## 何を

- `planBranchMetaMigration`: SQLite にあって trunk の op-log に無い branch / commit を、記録する手の列にする
- `applyBranchMetaMigration`: その手を記録口 (`branchMetaRecorder`) で書く
- `migrateBranchMeta`: SQLite の行を読んで上の 2 つを通す

## なぜ

T7-1 で branch / commit のメタの読み取りを trunk の op-log の畳み込みに切り替えた。
**T7-1 より前のメタは SQLite にしか無い**ので、載せ直さないと古い branch が一覧から消え、
相手にも届かない (設計の決定 2)。Phase 3 の実 PDS 試験で書いた fork もここに含まれる。

壊れ方は 2 方向ある。

- **足りない**: 載せ直した後の畳み込みが SQLite の内容を再現しない (commit の所属や status が落ちる)
- **やりすぎる**: 既に op-log にある branch を上書きする (T7-1 以降の status の変更を古い行で戻す)、
  あるいは削除した branch を作り直して一覧に戻す

## どのように

記録は**本物の経路**で batch にする — `branchMetaRecorder` → `graphEventToBatch`。読み口は
`foldBranches` そのもの。手書きの op だと、記録口と畳み込みの食い違いを見逃す。

### planBranchMetaMigration

- **SQLite にだけある branch を、作成 → コミット → status の順で載せ直す**。status は open でない
  ときだけ書く
- **🔴 載せ直した後の畳み込みが SQLite の内容を再現する**: branch のメタ・branch のコミット・
  trunk の merge コミットがそれぞれ同じ値で出る。branch のコミットは branch 専用 file_id に、
  merge コミットは trunk の file_id に保存されていた (T7-1 以前の書き分け) ので、両方から読む
- **op-log に既にある branch は、status も含めて触らない**: op-log では closed、SQLite の古い行では
  open のとき、何も書かない
- **🔴 T7-1 以降に削除した branch は作り直しても見えないまま**: T7-1 以降の削除は `branch.remove`
  だけを書き、SQLite の行は残る。載せ直しの判定を畳み込みの結果で行うと「無い」に見えるので、
  **判定は生の op** で行う。作り直しが起きても remove-wins で一覧に戻らないことを畳み込みで見る
- **既に記録されたコミットは載せ直さない**: commit id で判定する
- **既存の fork は普通の branch として移る**: SQLite は `conflictKey` / `origin` を保存していなかった
  (事実 G) ので、名前は残るが記述は付かない (決定 6)

### 性質: べき等

**載せ直した後にもう一度計画すると空である。**端末を再起動するたびに走っても、2 台の端末が
走らせても op-log を汚さないことの根拠である。

**生成器の判断**: branch を 0〜4 個、それぞれに status (open / merged / closed)、「既に op-log に
あるか」「削除済みか」、commit 数 0〜2 を引く。trunk の merge コミットも 0〜2。
**削除済み (create の無い `branch.remove`) を混ぜている** — これが無いと、判定を畳み込みの結果で
行う誤った実装も通ってしまう (その場合 2 回目の計画で削除済みの branch がまた現れる)。

### migrateBranchMeta

- **trunk と branch 専用 file_id の SQLite の行を読んで載せ直し、件数を返す**
- **読み出しが失敗したら何も書かずに投げる**: すべて読んでから書く。次の契機で再試行する

## テストしていないこと

- **画面を開いたときに走ること** — `useBranchOperations.test.ts`
- **実データ (:3000 の SQLite)** — T7-7 の実機で確かめる
