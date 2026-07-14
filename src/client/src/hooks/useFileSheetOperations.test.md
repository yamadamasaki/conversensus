# useFileSheetOperations のテスト

## 何をテストするか

`useFileSheetOperations` はファイル管理とシート管理の全 state/callback/effect を束ねるカスタムフック。
API と ATProto モジュールをモックし、状態遷移とコールバックの動作を検証する。

## なぜテストするか

App.tsx から抽出された最大のビジネスロジックの塊であり、
ファイル作成・削除・インポート・永続化の正確性を保証する必要がある。
さらに W3c1 で構造操作 (シート/ファイルの追加・削除・改名・説明) が
**snapshot と op-log の dual-write** になったため、op-log 側 (tap) への emit も検証する。
tap は `syncRecord` として注入し、実ネットワーク (LocalServerSyncProvider) を避けつつ
発行イベントを観測する。

## テストケース

### 初期状態
- files が空配列であること
- activeFile / activeSheetId / activeSheet が null であること
- expandedFileIds が空、newFileName が空文字列であること

### ファイル操作
- handleCreate: 新規ファイルを作成し activeFile / activeSheetId が設定されること
- persistFile: activeFile と files を更新し ATProto / ローカルに保存すること
- handleSaveFileSettings: ファイル名と説明を更新し、**変化した項目のみ** op-log へ emit すること (`FILE_RENAMED` / `FILE_DESCRIBED`)。dual-write なので snapshot 側も従来通り更新される。
- handleDeleteFile: 確認後ファイルを削除し activeFile をクリアすること
- handleImportFile: インポートしたファイルを active にすること

### シート操作
- handleDeleteSheet: 最後のシートは削除できず alert が表示されること (この場合は op-log へ emit しない)
- handleDeleteSheet: 2 シート以上ならシートを削除し op-log へ `SHEET_REMOVED` を emit すること (dual-write)
- handleSaveSheetSettings: シート名と説明を更新し、変化した項目のみ op-log へ emit すること (`SHEET_RENAMED` / `SHEET_DESCRIBED`)
- handleSaveSheetSettings: 変化が無ければ何も emit しないこと (空 batch 回避)

### dual-write の設計意図
構造操作は W3d の読み取り cutover まで snapshot が正典。op-log への emit は
「op-log を書き込み経路の正典にする (D4)」ための前進で、変化項目のみ emit することで
空 ops batch (`appendBatch` が拒否) を避け、無変化保存でログを汚さない。
