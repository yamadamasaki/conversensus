# SettingsPopup.test.tsx — テスト仕様

## 何をテストするか

`SettingsPopup.tsx` コンポーネント。
ファイル/シートの名前・概要編集、削除、閉じる操作を提供するポップアップ UI。

## なぜテストするか

- ファイル/シート管理の基本 UI であり、名前の空入力防止・IME 対応など細かい UX 要件がある
- onSave/onDelete/onClose のコールバック呼び出し条件が複数ある
- キーボード操作（Enter/Escape）の挙動が仕様通りであることを保証する必要がある

## どのようにテストするか

| カテゴリ | テスト内容 |
|---------|-----------|
| 初期表示 | name/description の props が input に反映される |
| 保存操作 | 保存ボタンで onSave + onClose 呼ばれる。名前変更反映。空文字フォールバック |
| キーボード | Enter で保存。IME 変換中は抑制。IME 確定後は保存。Escape で保存せずに onClose |
| 削除 | 削除ボタンで onDelete |
| 外部クリック | ポップアップ外クリックで onSave + onClose |
