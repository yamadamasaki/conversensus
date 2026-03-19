# EditableLabelEdge テスト仕様

## 何をテストするか

`EditableLabelEdge` カスタム edge コンポーネントのインタラクション動作。

## なぜテストするか

- ダブルクリック→インライン編集→確定/キャンセルの状態遷移は UI の核心機能
- IME (日本語入力) の Enter 誤確定バグは発生しやすく, 回帰しやすい
- `setEdges` の呼び出し有無でビジネスロジック（永続化フロー）の正確性を担保する

## どのようにテストするか

`@testing-library/react` + `happy-dom` で DOM 環境を構築。
`@xyflow/react` を `mock.module()` でスタブ化し, `useReactFlow().setEdges` の呼び出しを検証。
`EdgeLabelRenderer` はポータルをバイパスして children を直接レンダリングするスタブに差し替える。

| テストケース | 検証内容 |
|---|---|
| ラベルを表示する | `label` が span として描画される |
| ラベルが空/未定義の場合は span を表示しない | 空の button が描画されるが textbox は現れない |
| ラベルをダブルクリックで編集モードに切り替わる | dblclick 後に textbox が出現し value が現在のラベル |
| ラベルなしでもボタンのダブルクリックで編集モードに切り替わる | 空ラベルでも button をクリックすれば編集できる |
| Enter で確定し setEdges を呼び出す | `setEdges` が 1 回呼ばれ, input が消える |
| Escape でキャンセルし setEdges を呼ばない | `setEdges` が呼ばれず, input が消える |
| onBlur で確定し setEdges を呼び出す | blur 時に `setEdges` が呼ばれ, input が消える |
| IME 変換中は Enter で確定しない | `compositionStart` 後の Enter は無視される |
| compositionEnd 後は Enter で確定できる | `compositionEnd` 後の Enter で `setEdges` が呼ばれる |
