# useFileSheetOperations のテスト

## 何をテストするか

`useFileSheetOperations` はファイル管理とシート管理の全 state/callback/effect を束ねるカスタムフック。
API と ATProto モジュールをモックし、状態遷移とコールバックの動作を検証する。

## なぜテストするか

App.tsx から抽出された最大のビジネスロジックの塊であり、
ファイル作成・削除・インポート・永続化の正確性を保証する必要がある。

## テストケース

### 初期状態
- files が空配列であること
- activeFile / activeSheetId / activeSheet が null であること
- expandedFileIds が空、newFileName が空文字列であること

### ファイル操作
- handleCreate: 新規ファイルを作成し activeFile / activeSheetId が設定されること
- persistFile: activeFile と files を更新し ATProto / ローカルに保存すること
- handleSaveFileSettings: ファイル名と説明を更新すること
- handleDeleteFile: 確認後ファイルを削除し activeFile をクリアすること
- handleImportFile: インポートしたファイルを active にすること

### シート操作
- handleDeleteSheet: 最後のシートは削除できず alert が表示されること
