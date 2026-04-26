# branchState.test.ts — テスト仕様

## 何をテストするか

`branchState.ts` の `computeOperations(base, current)` 純粋関数。
2つの `Sheet` の差分を `CommitOperation[]` として計算する。

## なぜテストするか

- ブランチの orange 表示・pending ops 計算・merge ボタン有効/無効がすべてこの関数の結果に依存している
- テストが皆無なのはリスクが高い
- 純粋関数のためモック不要でテストが容易

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
