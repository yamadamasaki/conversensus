# useBranchOperations のテスト

## 何をテストするか

`useBranchOperations` はブランチ/コミット管理の全 state/ref/callback/effect を束ねるカスタムフック。
branch の作成・選択・編集・commit・merge・close・delete の各フローを検証する。

## なぜテストするか

App.tsx から抽出された最大のビジネスロジックの塊であり、
branch のライフサイクル全体の正確性を保証する必要がある。

**step1 Phase 6 p6-5b**: 安全弁 `BRANCH_FROM_OPLOG` の撤去で hook から旧 PDS 経路
(`branchState.ts` のレコード複製方式) が消えたため、**経路は op-log の 1 本だけ**に
なった。旧経路専用だったケース (PDS レコードの読み書きを確認していたもの) は対象ごと
削除し、経路に依らない表示ロジック (状態ゲート・ハイライト・ゴースト表示・リセット)
は op-log ハーネスへ移した。

## 表示状態 (経路に依らないもの)

### 初期状態
- activeBranch が null、isTrunk が true、pendingOps が空配列
- newCommitsSinceMerge が 0、commitDialogOpen が false
- diff 関連の Set が空、対象シートの branches が空

### pendingOps の status ゲート
`pendingOps` は「コミットできる変更があるか」= コミットボタンの有効/無効。
- OPEN / MERGED の branch で変更があれば含まれる
- **CLOSED の branch では空** (閉じた branch にコミットさせない)
- trunk 表示中は空

### ゴースト表示 (deletedNodes / deletedEdges)
- `node.remove` は base に存在するノードをゴーストとして残し、**ハイライト
  (conflicted) には入れない**
- `node.add` はハイライトに入る

### リセット・ダイアログ
- activeFile.id が変わると activeBranch が null に戻る
- resetBranchState で branch 状態が消える
- setCommitDialogOpen で commitDialogOpen を切り替えられる
- 空の名前では branch を作成しない
- activeBranch が null のとき handleCommit は早期 return する

`computeOperations` だけを `BranchOpsDeps` から差し替えている
(p6-5b 後に残る唯一の注入点)。**UI の見え方が差分計算の結果だけで決まる**ことを、
シートを実際に編集せずに固定するため。

## branch 操作 (op-log)

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
- 変更が無ければコミットしない。
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

### critic レビューで足した観点 (p5-4 修正分)

- **🔴 コミットは直前の編集の着地を待つ**: `record` は非同期に flush するので、待たずに
  op-log を読むとその編集がコミット位置に入らず、再オープン時に未コミットとして復活する。
  テストは branch tap の push を 30ms 遅らせ、`record` の直後に `handleCommit` を呼ぶ
  (`slowBranchPush`)。**待ちを外すと落ちることを確認済み**。merge も同じ理由で待つ
  (待たないと trunk に載らないまま branch だけ MERGED になる)。
- **`resetBranchState` が復帰した trunk のファイルを返す**: 呼び出し側 (App のシート追加)
  が **trunk のファイルを土台に**処理を続けるための返り値。branch 表示中の `activeFile` を
  土台にすると branch の内容が trunk へ移る。
