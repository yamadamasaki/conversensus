# computeOperations.test.ts — テスト仕様

## 何をテストするか

`computeOperations.ts` の純粋関数 `computeOperations` — 2 つの Sheet の差分を
`CommitOperation[]` として計算する。

## なぜテストするか

- branch 表示中のハイライト (追加・更新)、ゴースト表示 (削除)、未コミット変更件数
  (`pendingOps`) と merge ボタンの有効/無効が、すべてこの結果に依存している
- 純粋関数なのでモック不要で全分岐を固定できる

**step1 Phase 6 p6-5b**: このテストは `atproto/branchState.test.ts` から移設した。
同ファイルにあった非同期関数 (`fetchBranchesForSheet` / `fetchCommitsForBranch`) の
テストは、PDS レコード複製方式の退役に伴い対象ごと削除している。op-log 方式では
**コミットは差分を持たない** (ログ上のラベル付きオフセット) ため、この関数の役目は
UI 表示だけに絞られた。

## どのようにテストするか

| カテゴリ | テスト内容 |
|---------|-----------|
| node.add | base にないノードが追加として検出される。properties あり/なし両方を確認 |
| node.update | content・properties の変化を検出。同一内容で ops 空も確認 |
| node.remove | current にないノードを削除として検出 |
| edge.add | base にないエッジを追加として検出。label あり/なし両方を確認 |
| edge.update | label・properties の変化を検出 |
| edge.remove | current にないエッジを削除として検出 |
| 同一シート | base === current で ops が空 |
| layout 変更 | layouts/edgeLayouts のみの変化は commit 対象外なので ops 空 |
| 複合操作 | 追加・更新・削除の混在を正しく検出 |
| エッジケース | 空シート同士、全削除、追加順序の検証 |
