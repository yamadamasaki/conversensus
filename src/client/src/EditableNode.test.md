# EditableNode テスト仕様

## 何をテストするか

`EditableNode` カスタムノードコンポーネントのインタラクション動作。

## なぜテストするか

- ダブルクリック→インライン編集→確定/キャンセルの状態遷移は UI の核心機能
- textarea による複数行入力に変更したため、Enter キーの確定動作が排除された
- `setNodes` の呼び出し有無でビジネスロジック（永続化フロー）の正確性を担保する

## どのようにテストするか

`@testing-library/react` + `happy-dom` で DOM 環境を構築。
`@xyflow/react` を `mock.module()` でスタブ化し、`useReactFlow().setNodes` の呼び出しを検証。
`react-markdown` と `remark-gfm` もスタブ化して DOM テストを簡略化。

| テストケース | 検証内容 |
|---|---|
| ラベルを表示する | `label` が描画される |
| 空ラベルでは編集促進テキストを表示する | 空ラベル時に「ダブルクリックで編集」が表示される |
| ダブルクリックで編集モードに切り替わる | dblclick 後に textarea が出現し value が現在のラベル |
| onBlur で確定し setNodes を呼び出す | blur 時に `setNodes` が呼ばれ、textarea が消える |
| Escape でキャンセルし setNodes を呼ばない | `setNodes` が呼ばれず、textarea が消える |
| Enter キーは改行のみで確定しない | textarea の自然な動作として Enter は確定せず編集継続 |
