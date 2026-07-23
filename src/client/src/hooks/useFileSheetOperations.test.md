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

### 読み取り経路の cutover — W3d dual-read (`READ_FROM_OPLOG`)

`openFile` (trunk 読取) は W3d で snapshot から **op-log 正典** (`fetchBatches`→`projectFile`)
へ切替わる。`GET /files/:id/batches` はサーバ側で lazy migration (snapshot→genesis, W3d-1)
を起動するため、既存ファイルも op-log projection で開ける。安全弁として `READ_FROM_OPLOG`
フラグ (テストは hook 引数 `readFromOplog` で明示) と snapshot フォールバックを持つ。

- **flag ON**: op-log (`fetchBatches`) から読み、snapshot (`fetchFile`) には触れないこと。
  in-memory deps は snapshot から genesis を合成 (`graphFileToBatches`) して op-log を模す。
- **flag ON + op-log 読取失敗**: `fetchBatches` が throw したら snapshot にフォールバックし、
  正常に開けること (dual-read 安全弁)。
- **flag ON + op-log が空 (0 シート)**: 有効な `GraphFile` は 1 枚以上シートを持つため、
  0 シート projection は「読取失敗」扱いで snapshot に退避すること。真の欠損は snapshot 側で
  404 → alert に至る (既存の「見つからない場合はエラー通知」ケースが空 op-log→フォールバックを兼ねる)。
- **flag OFF**: 従来通り snapshot (`fetchFile`) から読み、op-log (`fetchBatches`) には
  一切触れないこと (即時退行の担保)。

`handleCreate` も作成直後に同じ `loadFile` (op-log 経路) で読み直し、genesis を起動して
projection を表示する (open との一貫性)。作成レスポンス由来の snapshot がフォールバック先。

### dual-write の設計意図
構造操作は W3d の読み取り cutover まで snapshot が正典。op-log への emit は
「op-log を書き込み経路の正典にする (D4)」ための前進で、変化項目のみ emit することで
空 ops batch (`appendBatch` が拒否) を避け、無変化保存でログを汚さない。

### remote 未知ファイルの発見 (Phase 4e-2b)

remote (repo 全体) にあってローカル正典に無いファイルを materialize する配線
(`discoverRemoteFiles`) の検証。調整ロジック自体は `discoverRemoteFiles.test.ts` が固定する
ので、ここでは hook の配線 (契機・依存の受け渡し・一覧再読込) のみを見る。

- **mount 時の発見**: remoteQueue があるとき、未知ファイルの batch が
  `pushReceivedBatches` (marker 経路) で書かれ、`fetchFiles` の再読込により Sidebar 一覧
  (`files`) に現れること。in-memory deps は書き込み時に `_fileList` へ足すことで
  GET /files の和集合 (4e-2a) を模す。
- **既知ファイルのみ**: 書き込みが起きないこと (受信 (a) との責務境界)。
- **remoteQueue 無し (未ログイン)**: 発見自体が起きないこと。

`online` イベントでの再発火は送信 catch-up (useEventSyncTap.test) と同じ方式のため、
配線テストでは mount 契機のみ固定する。実 PDS からの発見経路は 4e-4 実機 e2e で検証する。
