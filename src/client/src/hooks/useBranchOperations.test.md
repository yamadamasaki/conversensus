# useBranchOperations のテスト

## 何をテストするか

`useBranchOperations` はブランチ/コミット管理の全 state/ref/callback/effect を束ねるカスタムフック。
ATProto モジュールをモックし、branch の作成・merge・close・delete・commit の各フローを検証する。

## なぜテストするか

App.tsx から抽出された最大のビジネスロジックの塊であり、
branch のライフサイクル全体の正確性を保証する必要がある。

## テストケース

### 初期状態
- activeBranch が null、isTrunk が true、pendingOps が空配列
- newCommitsSinceMerge が 0、commitDialogOpen が false
- diff 関連の Set が空

### branch 作成
- handleCreateBranch: 名前を入力して branch を作成し sheetBranches に追加
- 空の名前では作成されないこと

### branch 操作
- handleMergeBranch: merge を実行しステータスが merged になる、merge 後も branch mode 継続
- handleMergeBranch: 確認でキャンセルした場合は merge されない
- handleCloseBranch: branch を close する
- handleDeleteBranch: branch を削除する

### commit
- handleCommit: pendingOps が空の場合はコミットされない

### branch 切り替え
- handleSelectBranch (trunk): branch 状態がリセットされる
- handleSelectBranch (branch): branch 状態が設定される

### ヘルパー
- resetBranchState: 全 branch 状態をリセットする
- setBranchBases: branchOriginalBase と lastCommitBase を設定する
- setCommitDialogOpen: commitDialogOpen を切り替えられる
