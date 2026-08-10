# computeOperations.test.ts — テスト仕様

## 何をテストするか

`computeOperations.ts` の純粋関数:

| 関数 | 責務 |
|---|---|
| `computeSheetChanges` | 2 つの Sheet の差分を `SheetChange[]` (op + 変更カテゴリ) として計算する |
| `computeOperations` | `computeSheetChanges` から op だけを取り出す薄い adapter |
| `isLayoutOnly` | その変更が「動かした / 大きさを変えた」だけかを判定する |

## なぜテストするか

- branch 表示中のハイライト (追加・更新)、ゴースト表示 (削除)、未コミット変更件数
  (`pendingChanges`) と merge ボタンの有効/無効が、すべてこの結果に依存している
- 純粋関数なのでモック不要で全分岐を固定できる
- **正規化が要になっている**。projection 由来の Sheet と React Flow を往復した編集中の
  Sheet は「省略」と「既定値の明示」が食い違うため、素朴に比べると**全ノードが「変更」に
  見えてしまう**。この正規化はテストで固定しておかないと簡単に壊れる

**step1 Phase 6 p6-5b**: このテストは `atproto/branchState.test.ts` から移設した。
同ファイルにあった非同期関数 (`fetchBranchesForSheet` / `fetchCommitsForBranch`) の
テストは、PDS レコード複製方式の退役に伴い対象ごと削除している。op-log 方式では
**コミットは差分を持たない** (ログ上のラベル付きオフセット) ため、この関数の役目は
UI 表示だけに絞られた。

**ANA-119/120/124 (2026-08-09)**: 差分の定義を確定し、layout を差分に含めた。
`computeOperations` を使う既存のテスト群は、**意味フィールドの判定が変わっていないことの
回帰テスト**として残してある。

## どのようにテストするか

### 意味フィールドの回帰 (`computeOperations`)

| カテゴリ | テスト内容 |
|---------|-----------|
| node.add | base にないノードが追加として検出される。properties あり/なし両方を確認 |
| node.update | content・properties の変化を検出。同一内容で ops 空も確認 |
| node.remove | current にないノードを削除として検出 |
| edge.add | base にないエッジを追加として検出。label あり/なし両方を確認 |
| edge.update | label・properties の変化を検出 |
| edge.remove | current にないエッジを削除として検出 |
| 同一シート | base === current で ops が空 |
| 複合操作 | 追加・更新・削除の混在を正しく検出 |
| エッジケース | 空シート同士、全削除、追加順序の検証 |

### layout も差分に出る (ANA-124)

| テスト内容 | 観点 |
|---|---|
| ノードを動かしただけで `node.update` が出る | ANA-124 の核。従来は差分に出ず commit もできなかった |
| layout だけの変更は `categories` が `['layout']` | commit ダイアログが「うち移動のみ」を出すための情報 |
| 意味と layout が同時に変わると両方入る | カテゴリは排他ではない |
| リサイズ (width/height) も差分に出る | 移動だけが layout ではない |
| エッジの経路 (pathType) の変更も差分に出る | edge 側の layout |

### 正規化 (誤検知を出さない)

| テスト内容 | なぜ必要か |
|---|---|
| layout の省略と既定値の明示は同じ | projection は layout を持たないが、React Flow を往復すると x=0 / 既定サイズが明示的に入る |
| pathType の省略と既定値の明示は同じ | 同上。`toFlowEdges` が既定の経路を埋める |
| 丸めで消える差 (1px 未満) は差分にしない | op-log は整数へ丸めて記録するので、丸めた後に同じなら op としては変化が無い |
| presentation (ラベル位置) は差分にしない | `edge.setLabelOffset` はローカル限定でバージョン管理の対象外 |
| properties の `undefined` と `{}` は同じ | 「プロパティが無い」の表し方が経路によって違う |
| properties はキーの順序に左右されない | JSON 文字列の一致で比べると順序で誤検知する |

### 同じ値に戻した編集 (§8-1 の確定事項)

| テスト内容 | 観点 |
|---|---|
| 内容を編集して元に戻すと差分に出ない | undo を含む。op-log には 2 件の op が積まれているが net の差は無い |
| 動かして元の位置に戻すと差分に出ない | layout でも同じ規則が効く |
| 同じノードを何度動かしても差分は 1 個 | 中間の位置は基準にも現在にも残らないので、しきい値なしで集約される |

### エッジの付け替え

| テスト内容 | 観点 |
|---|---|
| source / target が変わると `edge.update` が出る | 従来は端点の変化を見ておらず、付け替えが差分から抜けていた |
