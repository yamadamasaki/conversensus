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

## op-log 経路 (step1 Phase 5 p5-4)

hook は 2 つの経路を持つ。上の各ケースは **`branchFromOplog: false` を明示して
旧 PDS 経路を張る** — フラグ off の安全弁が無傷であることの固定に役目が変わった。
以下は既定 (`BRANCH_FROM_OPLOG=true`) の op-log 経路。

deps は `createInMemoryBranchOplogDeps` (batches / branches / commits の in-memory ストア)。
**branch tap の書き込み口と projection の読取口が同じストアを共有する**のが要で、
「編集を branch 専用 op-log へ流し、そこから読み直す」までを単体で閉じて検証できる。

### branch 作成 — 複製しないこと
- base は分岐時点のログ先端 (`tipClock`) を指す。
- **trunk op-log は 1 件も増えず、branch 専用 op-log も空のまま**。旧経路が trunk の
  全レコードを `{branchId}_` prefix で複製していたのに対し、op-log では「どこで
  分岐したか」を記録するだけでよい (設計 §3.1)。複製が復活したらここが赤くなる。

### branch 編集の宛先 — 🔴 載せ替えの核心
- **branch 表示中の編集は branch 専用 op-log にだけ積まれ、trunk は不変**。
  旧配線では branch 表示中も GraphEditor が trunk 用 tap を使っていたため、
  branch の編集が trunk のログを汚していた (W3d で branch を凍結した際の積み残し)。
- **発番は分岐点の後から始まる** (`clockFloor = base.at`)。空の branch op-log は
  放っておくと clock 1 から発番し、`branchSheet` の projection で base 時点の
  trunk batch (より大きい clock) に LWW で負ける。
- trunk 表示中は `branchSyncRecord` が null = trunk 用 tap を使う、という切替点も固定する。
- なお **structure op (`sheet.create` 等) は branch op-log へ流れない** — 構造操作は
  `useFileSheetOperations` の syncRecord (trunk 用) から出るため、経路が構造的に分かれる。
  branch op-log に構造 op が入ると branch がファイル一覧に現れる (`eventStore.test.ts` が
  この条件ごと固定している)。

### commit — ログ上のオフセット
- 保存されるのは `{message, at}` であって差分ではない。`at` は branch op-log の先端。
- 変更が無ければコミットしない (旧経路と同じ早期 return)。
- **`pendingOps` は diff 由来のまま** (p5-4 の確定事項)。op-log の未コミット batch を
  そのまま数えると「編集して undo」の往復が 2 変更に見えるため、表示は正味の差分に、
  コミットの実体はログ位置に、と役割を分ける。テストでは branch 選択**前**に
  `_setComputeOps` で変更ありの状態を作る (`pendingOps` は useMemo なので選択後に
  差し込んでも再計算されない)。

### merge — trunk 先端の後へ再スタンプ
- branch batch が **id を保持したまま** trunk op-log に現れ、clock は merge 時点の
  trunk 先端より後になる。id 保持が再 merge のべき等性そのもの (p5-3)。
- 再スタンプの発番は **trunk の tap と同じ clock** で行う (`trunkClock`)。発番器を
  分けると、次のローカル編集が merge 済み batch と同じ `(clock, actor)` を持ちうる。
- キャンセル時は trunk も branch の status も動かない。

### close / delete
- close は status を closed にし、branch op-log は残す (再開の余地を残す)。
- delete は **メタと branch 専用 op-log をまとめて**消す (server 側は 1 tx)。
