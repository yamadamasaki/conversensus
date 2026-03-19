# EditableNode テスト仕様

## 何をテストするか

`EditableNode` カスタム node コンポーネントのインタラクション動作。

## なぜテストするか

- ダブルクリック→インライン編集→確定/キャンセルの状態遷移は UI の核心機能
- IME (日本語入力) の Enter 誤確定バグは発生しやすく, 回帰しやすい
- `setNodes` の呼び出し有無でビジネスロジック（永続化フロー）の正確性を担保する

## どのようにテストするか

`@testing-library/react` + `happy-dom` で DOM 環境を構築。
`@xyflow/react` を `mock.module()` でスタブ化し, `useReactFlow().setNodes` の呼び出しを検証。

| テストケース | 検証内容 |
|---|---|
| ラベルを表示する | `data.label` が span として描画される |
| 空ラベルでもレンダリングできる | 空文字でも input が現れない (editing=false) |
| ダブルクリックで編集モードに切り替わる | dblclick 後に textbox が出現し value が現在のラベル |
| Enter で確定し setNodes を呼び出す | `setNodes` が 1 回呼ばれ, input が消える |
| Escape でキャンセルし setNodes を呼ばない | `setNodes` が呼ばれず, input が消える |
| IME 変換中は Enter で確定しない | `compositionStart` 後の Enter は無視される |
| compositionEnd 後は Enter で確定できる | `compositionEnd` 後の Enter で `setNodes` が呼ばれる |
