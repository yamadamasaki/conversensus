# ConfirmDialog のテスト

## 何をテストするか

`ConfirmDialog` はブラウザの `window.confirm` の代替となるモーダルコンポーネント。
メッセージ表示、確認/キャンセルのコールバック、キーボード操作、アクセシビリティ属性を検証する。

## なぜテストするか

ユーザー確認が必要な破壊的操作（merge, close, delete）のフローをテスト可能にするため。
`window.confirm` は jsdom では戻り値を制御できず、UI としても一貫性がない。

## テストケース

### 表示
- メッセージが正しく表示されること
- 改行を含むメッセージが正しく表示されること
- confirmLabel / cancelLabel のカスタマイズが効くこと

### 操作
- OK ボタンクリックで onConfirm が呼ばれること
- キャンセルボタンクリックで onCancel が呼ばれること
- Escape キーで onCancel が呼ばれること
- 背景クリックで onCancel が呼ばれること
- ダイアログ内部クリックでは onCancel が呼ばれないこと

### アクセシビリティ
- role="dialog" が設定されていること
- aria-modal="true" が設定されていること
