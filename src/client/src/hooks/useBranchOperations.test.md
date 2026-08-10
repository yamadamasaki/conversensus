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
- activeBranch が null、isTrunk が true、pendingChanges が空配列
- newCommitsSinceMerge が 0、commitDialogOpen が false
- diff 関連の Set が空、対象シートの branches が空

### pendingChanges の status ゲート
`pendingChanges` は「コミットできる変更があるか」= コミットボタンの有効/無効。
- OPEN / MERGED の branch で変更があれば含まれる
- **CLOSED の branch では空** (閉じた branch にコミットさせない)
- trunk 表示中は空

### 差分状態 (ANA-120)

**なぜここだけ差分計算を本物にするか**: 他のテストは `computeSheetChanges` をスタブに
差し替えているが、スタブは**基準に関わらず同じ配列を返す**ので「どの Sheet を起点に
したか」を区別できない。起点の切り替わりこそがこのスライスの検証対象なので、
`realChanges` オプションで本物の差分計算を使い、`activeSheet` を rerender で
差し替えることで画面上の編集を再現する。

判定規則は `resolveBranchDiffState` として hook の外に切り出してあり、4 状態
(trunk / 無変更 / 変更中 / commit 済み) を単体で固定する。**未コミットの変更があれば
commit の有無に依らず「変更中」**である点が要 (commit 済みの表示に引きずられない)。

hook 側では状態遷移を通しで検証する。

- 分岐直後 = 無変更 → ハイライトも `pendingChanges` も空
- 編集 → 変更中。起点は直近コミット (まだ無いので分岐点)
- commit → **commit 済み。起点が分岐点へ切り替わり、差分は出続ける** (= 次の merge の
  対象)。消えるのは `pendingChanges` (= 次の commit の対象) の方である。仕様書
  「ブランチの作成と利用」の表がこの 3 状態を定義している
- 🔴 **commit 後に編集すると、commit 済みの変更はハイライトから外れる** — これが
  ANA-120 の核心。以前はハイライトが常に分岐点基準だったため、commit 済みのノードが
  「変更中」の画面に出続け、commit ダイアログ (直近コミット基準) と食い違っていた
- ハイライトと commit ダイアログが**同じ集合**を指す (起点が 1 つであることの帰結)
- ゴースト表示 (削除) も同じ起点に従う — 削除を commit した後に別の編集を始めると
  ゴーストは消える
- trunk に戻ると状態は trunk になり差分は一切出ない

CLOSED の branch は `pendingChanges` が常に空なので「commit 済み」か「無変更」に落ちる。
未 merge のコミットが無ければ差分は出ない (以前は分岐点基準のハイライトが出続けていた)。

#### merge 済み branch の再オープン (ANA-119 S6)

同一セッション中は `afterMerge` が merge 時点を控えているので正しかったが、**その控えは
React の state / ref なのでアプリを閉じると消える**。以前は「merge 済みコミット数」も
セッション内の ref (`mergedCommitCounts`) に積んでいたため、開き直すと起点が元の分岐点に
戻り、**merge 済みの内容まで差分に出ていた**。S4 で merge が `commits` に `sourceAt` 付きで
載るようになったので、merge 時点をログから導けるようになった。

**アプリの開き直しをどう再現するか**: in-memory の op-log ストア (`oplogDeps`) を引き継いだ
まま hook を作り直す (`reuse` オプション)。React の state / ref は消え、ログに書いたものだけが
残る — これが「アプリを閉じて開く」との差である。

- 🔴 **起点が merge 時点になり、merge 済みの変更は差分に出ない** (`newCommitsSinceMerge` も 0)。
  **これは S6 の実装を外すと落ちることを確認済み** (`lastMergeSourceAt` の結果を undefined に
  固定すると、この項目と下の commit の項目が落ちる)
- 開き直した後の編集は「変更中」として出る (この項目だけは S6 前でも通る — 未コミット変更の
  基準 `lastCommitBase` は元から直近コミットをログから導いていたため)
- 開き直した後の commit は「次の merge の対象」になり、差分は **merge 後の編集だけ**を指す

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

`computeSheetChanges` だけを `BranchOpsDeps` から差し替えている
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
- **`pendingChanges` は diff 由来のまま** (p5-4 の確定事項)。op-log の未コミット batch を
  そのまま数えると「編集して undo」の往復が 2 変更に見えるため、表示は正味の差分に、
  コミットの実体はログ位置に、と役割を分ける。テストでは branch 選択**前**に
  `_setComputeOps` で変更ありの状態を作る (`pendingChanges` は useMemo なので選択後に
  差し込んでも再計算されない)。

### merge — trunk 先端の後へ再スタンプ + 一級の記録 (ANA-122)

- **merge 理由は必須**。理由の入力に答えない (空白だけ) と merge は起きず、trunk も
  branch の status も動かない。以前は確認ダイアログだったが、**理由の入力そのものが
  確認**なので二段構えにしない。テストは `answerMergeReason` で入力に答える —
  答えないと Promise が解決せず merge に進まない。
- **merge の記録が trunk 側の commits に `kind=merge` で残る** (理由・実行者・由来 branch)。
  branch の status が MERGED になるだけでは「いつ・誰が・何のために」が残らなかった。

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
