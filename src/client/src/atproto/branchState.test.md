# branchState.test.ts — テスト仕様

## 何をテストするか

`branchState.ts` の純粋関数 `computeOperations` と、非同期関数 `fetchBranchesForSheet`, `fetchCommitsForBranch`。

## なぜテストするか

- ブランチの orange 表示・pending ops 計算・merge ボタン有効/無効がすべて `computeOperations` の結果に依存している
- PDS アクセスを DI 化したことで非同期関数もテスト可能になった
- 純粋関数パートはモック不要、非同期パートは in-memory collection でテストできる

## どのようにテストするか

### computeOperations (純粋関数)

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

### 非同期関数 (in-memory DI)

| カテゴリ | テスト内容 |
|---------|-----------|
| fetchBranchesForSheet | 空 collection、該当シートのみ取得、全フィールドのマッピング確認 |
| fetchCommitsForBranch | 空 collection、parentCommit チェーン順の取得、別 branch の commit 非混入 |
