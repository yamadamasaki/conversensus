# EditableNode テスト仕様

## 何をテストするか

`EditableNode` カスタムノードコンポーネントのインタラクション動作。

## なぜテストするか

- ダブルクリック→インライン編集→確定/キャンセルの状態遷移は UI の核心機能
- textarea による複数行入力に変更したため、Enter キーの確定動作が排除された
- `setNodes` の呼び出し有無でビジネスロジック（永続化フロー）の正確性を担保する
- ghost (削除予定表示) は「もう存在しないノード」なので、そこからエッジを引けてしまうと
  存在しないノードを指すエッジ (孤児エッジ) が trunk へ載りうる (ANA-121)。
  React Flow で接続を止めるのは `connectable` / `isConnectable` であって `selectable` では
  ないため、**見た目は操作できなさそうなのに実は繋げる**という取り違えが起きやすい

## どのようにテストするか

`@testing-library/react` + `happy-dom` で DOM 環境を構築。
`@xyflow/react` を `mock.module()` でスタブ化し、`useReactFlow().setNodes` の呼び出しを検証。
`react-markdown` と `remark-gfm` もスタブ化して DOM テストを簡略化。

`Handle` は **描画せず props を記録するスタブ**にしてある。接続可否は DOM のクラス名では
なく「`Handle` へ渡した `isConnectable`」で判定する — React Flow の内部実装 (クラス名) に
テストを縛らないためである。

| テストケース | 検証内容 |
|---|---|
| ラベルを表示する | `label` が描画される |
| 空ラベルでは編集促進テキストを表示する | 空ラベル時に「ダブルクリックで編集」が表示される |
| ダブルクリックで編集モードに切り替わる | dblclick 後に textarea が出現し value が現在のラベル |
| onBlur で確定し setNodes を呼び出す | blur 時に `setNodes` が呼ばれ、textarea が消える |
| Escape でキャンセルし setNodes を呼ばない | `setNodes` が呼ばれず、textarea が消える |
| Enter キーは改行のみで確定しない | textarea の自然な動作として Enter は確定せず編集継続 |

### ghost (削除予定表示)

| テストケース | 検証内容 |
|---|---|
| ハンドルをすべて接続不可にする | ghost の全 `Handle` が `isConnectable={false}` を受け取る |
| ハンドル自体は消さない | 4 つのハンドル (top/bottom/left/right) が残る — ghost エッジの端点として座標が要る |
| 通常のノードのハンドルは接続可能なまま | 通常分岐の `Handle` に `isConnectable` を渡していない (ghost 対策が漏れていない) |
| ダブルクリックしても編集モードにならない | ghost 分岐は編集 UI を持たない (既存の振る舞いの回帰) |
