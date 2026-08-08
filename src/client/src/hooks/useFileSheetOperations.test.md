# useFileSheetOperations のテスト

## 何をテストするか

`useFileSheetOperations` はファイル管理とシート管理の全 state/callback/effect を束ねるカスタムフック。
API と ATProto モジュールをモックし、状態遷移とコールバックの動作を検証する。

## なぜテストするか

App.tsx から抽出された最大のビジネスロジックの塊であり、
ファイル作成・削除・インポート・永続化の正確性を保証する必要がある。
さらに W3c1 で構造操作 (シート/ファイルの追加・削除・改名・説明) が op-log へ流れるように
なったため、tap への emit も検証する。**Phase 6 p6-3 で snapshot 側の読み書きが撤去され、
dual-write / dual-read は終わった** — 状態の永続先は op-log ただ一つになった (設計 §3.6)。
tap は `syncRecord` として注入し、実ネットワーク (LocalServerSyncProvider) を避けつつ
発行イベントを観測する。

## テストケース

### 初期状態
- files が空配列であること
- activeFile / activeSheetId / activeSheet が null であること
- expandedFileIds が空、newFileName が空文字列であること

### ファイル操作
- handleCreate: 新規ファイルを作成し activeFile / activeSheetId が設定されること
- updateFileState: activeFile と files 一覧を更新すること。**永続化は伴わない** (op-log へも emit しない — それは呼び出し側の責務で、ここで emit すると二重記録になる)
- handleSaveFileSettings: ファイル名と説明を更新し、**変化した項目のみ** op-log へ emit すること (`FILE_RENAMED` / `FILE_DESCRIBED`)
- handleDeleteFile: 確認後ファイルを削除し activeFile をクリアすること。
  **削除は op-log の tombstone であって物理削除ではない** (ANA-127) ので、次の 2 点を
  併せて固定する:
  - 一覧 (`fetchFiles`) からは消えるが、**discovery の既知集合 (`fetchLocalFileIds`) には
    残る**。ここが崩れると削除したファイルが「未知」と判定され、PDS から materialize されて
    次回起動で復活する — ANA-127 そのものの再発である。
  - **削除に失敗したら UI からも消さない**。消すと「画面には無いが次の起動で戻る」という
    最も分かりにくい状態を作る。
- handleImportFile: インポートしたファイルを active にすること
- handleExportFile: 開いていないファイルは **op-log の projection** を書き出すこと (p6-3, 設計 §3.4)。server に projection の第 2 実装を作らない判断の帰結で、読取経路が `loadFile` 1 本に揃ったことの固定でもある

### シート操作
- handleDeleteSheet: 最後のシートは削除できず alert が表示されること (この場合は op-log へ emit しない)
- handleDeleteSheet: 2 シート以上ならシートを削除し op-log へ `SHEET_REMOVED` を emit すること (dual-write)
- handleSaveSheetSettings: シート名と説明を更新し、変化した項目のみ op-log へ emit すること (`SHEET_RENAMED` / `SHEET_DESCRIBED`)
- handleSaveSheetSettings: 変化が無ければ何も emit しないこと (空 batch 回避)

### 読み取り経路 — op-log 単独 (Phase 6 p6-3)

`openFile` (trunk 読取) は W3d で op-log 正典 (`fetchBatches`→`projectFile`) へ切替わりつつ、
snapshot への dual-read フォールバックと安全弁 `READ_FROM_OPLOG` を残していた。
**p6-3 で snapshot への書込を止めたため、退避先として成立しなくなった** — 古い内容を
見せる方が失敗するより悪い。よってフォールバックとフラグを撤去した (設計 §3.6 / §4.2)。

旧テストは削除せず **意味を反転**させて残す。「退避する」が「退避しない」に変わることで、
フォールバックを戻したら赤くなる:

- **op-log から開ける**: `fetchBatches` を読み、projection が activeFile になること。
  in-memory deps は作成済みファイルから genesis を合成 (`graphFileToBatches`) して op-log を模す
  (`POST /files` の genesis 直書き = p6-1 と同じ状態)。
- **🔴 op-log 読取が失敗したら開けない**: `fetchBatches` が throw したとき、かつては
  snapshot (`fetchFile`) が肩代わりして開けていた。今は activeFile が null のままで alert に至る。
- **🔴 projection が 0 シートなら開けない**: 有効な `GraphFile` は 1 枚以上シートを持つ
  (W3d-2 の読取失敗判定)。0 シートは欠損 / 孤児 batch のみで、退避先はもう無い。

`handleCreate` も作成直後に同じ `loadFile` で読み直す (open との一貫性)。`POST /files` が
genesis を書いた後なので必ず読める。

### 構造操作の emit 方針
変化項目のみ emit することで空 ops batch (`appendBatch` が拒否) を避け、無変化保存で
ログを汚さない。W3c1 当時は snapshot との dual-write だったが、p6-3 で snapshot 側が
消えたので **これが唯一の永続経路**になった。

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

**Phase 6 p6-4 でこれがリモート一覧を得る唯一の経路になった** — 並走していた
`loadAtprotoFiles` (PDS legacy の file レコード一覧を取得して `files` にマージ) を
撤去したため (設計 §3.8)。テストは増やしていない: 上記 3 件が「ログイン中のみ発見が
起きる」ことを既に固定しており、`loadAtprotoFiles` の撤去で変わるのは
**同じ契機で走るもう 1 本が消えた**ことだけだからである。撤去した側の一覧マージには
専用テストが無かった (deps stub が空配列を返すだけだった) ので、失われた検証も無い。

### 受信着地後の画面反映 (Phase 4e-3 / 4e-4)

受信 (a) が開いているファイルへ着地した後の swap 配線
(`handleReceived` → `reprojectAfterReceive` → `setActiveFile` + `receiveEpoch`) の検証。
可否判定ロジック自体は `reprojectAfterReceive.test.ts` が固定するので、ここでは hook の
配線 — 受信契機から activeFile 差し替えと **`receiveEpoch` の増加**まで — を見る。

`receiveEpoch` は 4e-4 実機 e2e で発見した欠陥の対策: GraphEditor は React Flow の内部
state を `file.id` / `activeSheetId` の変化でしかリセットしないため、同一 file.id のまま
activeFile を差し替えても画面に反映されなかった。swap のたびに増える世代番号を
GraphEditor の reset effect の依存に加えることで再 seed を発火させる。

- **開いているファイルへの受信 (appended > 0)**: activeFile が受信ノードを含む projection
  に差し替わり、`receiveEpoch` が 1 増えること (React Flow 再 seed の回帰試験)。
  受信の書き込み口は `deps.pushReceivedBatches` を注入 (discovery 4e-2b と同じ deps 抽象)。
  in-memory deps はストアのファイルへノードを足すことでデーモンへの着地を模す。
- **既知分のみの再受信 (appended = 0)**: onReceived 自体が呼ばれず、swap も epoch 増加も
  起きないこと (べき等再受信で画面を無駄に触らない)。

## rkey 移行の配線 (Phase 7 p7-4)

発見 (`discoverRemoteFiles`) の**前に** rkey 移行を 1 回だけ通す配線を検証する。

**なぜ発見の前か**: p7-1 より前に書かれた旧 rkey のレコードは `v1~` より小さく、
新経路 (列挙・prefix 取得) の走査に現れない。移行を経ずに発見だけを回すと、
「PDS にしか無い古い batch」を持つファイルが見えないままになる。テストの fake は
**`listRemoteFileIds` が空を返す**ことでこの状況を再現している — 発見だけでは
到達できず、移行の全件受信 (`pullAllRemoteForMigration`) だけが拾える形にしてある。

**なぜ marker を deps にしたか**: 移行は「起動時に 1 回」なので、差し替えられないと
他のテスト (発見・受信) の観測に移行の副作用が混ざり、何を検証しているのか分からなくなる。
in-memory deps は `hasRkeyMigrated: () => true` (移行済) を既定にして移行経路を止め、
この節のテストだけが `false` にして配線を見る。

- **marker が無ければ移行が走り、新経路から見えないファイルを取り込む**: 全件 list が
  ちょうど 1 回呼ばれ、受信が marker 経路へ書かれ、`createRemote` (まとめ書き) で
  新 rkey に載せ直され、marker が立ち、materialize されたファイルが一覧に現れること。
- **marker があれば全件 list を実行しない**: 移行済端末で毎回 repo 全件を落とさないこと。
  これが効かないと p7-2/p7-3 の成果 (全件 list をやめる) が起動経路で帳消しになる。
- **移行が失敗しても発見は走る**: 発見は非破壊で、移行と独立に価値がある。あわせて
  marker が立たない (次回起動で再試行される) ことを固定する。

## 【退役】persistFile の branch ガード (step1 Phase 5 p5-4)

op-log branch を表示している間、`activeFile` の該当シートは **branch の内容** に
差し替わっている。この状態で `persistFile` が snapshot を書くと **trunk の snapshot を
branch の内容で上書きする** (Phase 5 設計 §9.2)。`persistFile` は autosave だけでなく
シート追加・ファイル設定保存・シート名変更・シート削除からも呼ばれるため、呼び出し側ごとに
ガードを置くと必ず漏れる (実際 critic に 4 箇所中 3 箇所の漏れを指摘された)。そこで
ガードを `persistFile` 自身に置いていた。

**Phase 6 p6-3 でこのガードは構造ごと消えた** — 書込先 (`saveFile` / `syncFileToAtproto`)
が `FileSheetOpsDeps` から無くなり、漏れようがなくなったため (設計 §3.6)。
ガードのテストも一緒に退役させた。Phase 5 critic の「呼び出し側ごとのガードは必ず漏れる」に
対する最終的な答えは「書込先を消す」だった、というのがこの節の記録である。
