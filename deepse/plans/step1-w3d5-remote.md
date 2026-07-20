# step1 W3d5 remote (ATProto op-log 配線) — 設計

> 位置づけ: Phase 4 実配線 W3 の **W3d5**。W3d (ローカル読取 cutover) 完了後の remote 統合。
> tap をローカル正典 (daemon op-log) に加えて ATProto へも push する (**送信**)。`isSyncable` で
> presentation をローカル限定に留め、`sheetId` を remote 往復させる。
>
> **スコープ = 送信のみ (critic レビュー REVISE, 2026-07-19)**。batch op-log 経由の**受信**
> (remote → ローカル正典への import) と常時同期は **Phase 4d / 後続**。理由: `.subscribe(` の
> 消費箇所が存在せず依拠すべき既存受信が無い (A1)、現状の跨端末伝播は legacy snapshot 経路が
> 肩代わりしており batch op-log とは別系統 (A2)、受信が無い状態で genesis を remote に載せると
> 2 台目の独立 genesis と clock 衝突する (C1)。→ **`GENESIS_ACTOR` の batch は remote へ
> push しない**不変条件を置く (§3.5)。詳細は §2 / §8。
>
> 上位設計: `deepse/architecture/step1.md` (D3/D7) / `deepse/plans/step1-w3-read-path.md` (§5 W3d5 行, レビュー H3)
> / `deepse/plans/step1-w3d-read-cutover.md` §7 (申し送り)。
>
> **リスク: 高**。送信の実機検証には PDS が要る (2 台目は pull 受領の確認までで、双方向常用は非目標)。
> 設計 (critic M-4) は「W3d5 は step1 read-path から分離可能・Phase 4d 統合や step2 送りも可」と明記。
> 本書は分離した独立スライスとして設計し、**ローカル正典の前進を remote 同期がブロックしないこと**を
> 最優先の不変条件に置く。remote は純 fire-and-forget ではなく、未送信を保持する再送キュー +
> 可視ステータスとする (§3.1 / §8)。

## 1. 現状把握 (コード実態)

W3d5 の判断はすべて以下の実態に立脚する。

- **tap は `LocalServerSyncProvider` のみに配線** (`useEventSyncTap.ts:24`)。ATProto は tap に未接続で、編集は daemon op-log にしか流れない。ATProto は現状 branch 機能 (`branchState.ts`) 専用。
- **tap の生成点は `useFileSheetOperations.ts:111`** (`useEventSyncTap(activeFile?.id ?? null)`)。ここへ session 由来の remote provider を注入する必要がある。
- **`isSyncable` は定義済みだが完全に未使用** (`unified.ts:218`)。presentation = `node.setStyle` / `edge.setStyle` / `edge.setLabelOffset` の 3 種のみ (`OP_CATEGORY`, `unified.ts:188`)。tap は空 ops のみスキップするため presentation もローカル op-log へ流入している (これは W3e の snapshot 退役で必要な保全なので**ローカルには残す**のが正しい)。
- **`BatchRecord` と mapper が `sheetId` を落とす** (`batchMapper.ts` / `types.ts:135`)。daemon 側は W3c2 で `sheet_id` 列を持つのに、ATProto 往復では `Batch.sheetId` が失われる。
- **`batch.json` レキシコンが存在しない** (`lexicons/app/conversensus/graph/` に batch だけ無い)。op-log batch レコードは PDS 上でスキーマレス。`putRecord` は任意 JSON を通す (`collections.ts:317` `batches.put`)。→ sheetId 追加は TS 型 + mapper のみで足り、レキシコン更新は必須ではない (但し §3.3 で batch.json 新設を検討)。
- **`SyncProvider` は単一 provider モデル** (`syncProvider.ts`)。tap は `Outbox` を 1 つの provider に flush し、Lamport 復元の `pull` も同じ provider から取る (`eventSyncTap.ts:82`)。
- **`AtprotoSyncProvider` は実装済** (Phase 4c, `atprotoSyncProvider.ts`)。`push`=putRecord(rkey=batchId)、`pull`=clock>cursor、`subscribe`=定期 poll。`BatchCollection` (=`collections.batches`) と scheduler を注入可能。**tap へ配線されていないだけ**。
- **session は `useAtprotoSession`** (`{session, resuming, login, logout}`) から得る。App レベルで保持され、未ログイン時は `session=null`。

## 2. 目標と非目標

**目標**:
- trunk の編集 batch を、ローカル正典 (daemon) に加えて **ATProto op-log コレクションへも push** する。
- **presentation をローカル限定にする**: remote へ push する際に `isSyncable` で presentation op を除外する。ローカル op-log には presentation を残す (ローカル正典・W3e 保全)。
- **`sheetId` を remote 往復させる**: content batch の発生元シートを `BatchRecord` に載せ、`recordToBatch` で復元する (daemon の `sheet_id` 列と対等)。
- **ローカル正典を壊さない**: remote 同期はローカル正典の前進をブロックしない。remote push が失敗しても編集は途切れず、ローカル op-log は前進する (§3.1 の不変条件)。
- **同期失敗にユーザが気づき、回復できる**: remote 未送信を**破棄せず専用キューに保持**し、「クラウド未同期: N 件」を UI に出す。再接続時の自動再送 + 手動再送で回復する (§3.1 / §3.6 / §3.7)。純 fire-and-forget (サイレント・catch-up 頼み) は採らない。
- **genesis batch は remote へ push しない** (§3.5・C1)。受信経路が無い現状で各端末が独立生成する genesis を remote に載せると clock 衝突するため、remote leg で `GENESIS_ACTOR` を除外する。genesis 由来構造の跨端末授受は受信を実装する Phase 4d へ。

**非目標 (W3d5 では触らない)**:
- **batch op-log 経由の受信 (remote → ローカル正典への import)** → **Phase 4d / 後続**。**重要 (critic A1/A2)**: 「pull/subscribe 経由の受信は既存実装のまま」は**誤り**だった。`.subscribe(` の消費箇所は存在せず (grep 0 件)、`localServer`/`nullSyncProvider` の subscribe は no-op。**batch op-log 経由の受信機構は未実装で、依拠すべき既存受信は無い**。現在の跨端末伝播は legacy snapshot 経路 (`App.tsx` persistFile / `useFileSheetOperations` fetchFileFromAtproto) が肩代わりしており、batch op-log とは別系統である。本スライスは **送信 (片方向 push が remote に確実に載る)** のみを主眼にし、ローカル正典への import と常時同期は非目標とする。
- **双方向マージ・コンフリクト解決の作り込み** → 2 台目の実機検証を伴う難所。Phase 4d / step2 へ。
- snapshot 書込 (`persistFile` / PUT /files) の退役 → W3e。
- branch の op-log 化 → step2。branch は従来の PDS 複製経路 (`branchState.ts`) のまま不変。
- Jetstream 購読化 (subscribe の poll 卒業) → Phase 4d。

> **非目標の線が genesis 衝突までカバーする理由 (critic C1)**: 受信 (import) が無い状態で 2 台目 (device B) を稼働させると、B の daemon は自前 genesis (別 id・同一 clock) を独立生成し、catch-up が「remote に無い」と判定して二重投入する → remote に **clock 衝突する 2 系統の genesis** が生じデータ汚染する。片方向 push だけでもこの汚染は起きるため、**受信を実装するまで 2 台目を「両方が同じファイルへ書き込む」構成で常用してはならない**。W3d5-7 の検証は §3.5 / §3.6 の genesis 非 push 不変条件でこの汚染を回避した上で、**送信の確認に限定**する (§4 の受入基準)。

## 3. 設計判断

### 3.1 fanout 合成 provider — ローカル正典 (ブロッキング) + remote 再送キュー

tap の単一 provider モデルを崩さず、**`FanoutSyncProvider` (合成 `SyncProvider`)** を新設し、ローカル正典と **remote 再送キュー**を束ねる。

- **`push(batches)`**:
  - **local.push を await し、成功をローカル outbox クリアの条件にする** (失敗は throw → 既存 outbox が保留し再送)。ローカル正典の前進はここで確定する。
  - **remote は専用の再送キュー (`RemoteSyncQueue`, §3.6) へ enqueue するだけ**で、`push` 自体は remote 完了を待たない (非ブロッキング)。enqueue する batch は presentation を除いた複製 (§3.2)。
  - **不変条件**: **ローカル正典の前進は remote の成否に依存しない**。remote が落ちていても `push` は local 成功で resolve し、編集も undo/redo も途切れない (§2)。
- **`pull(since)`**: **local へ委譲**する。Lamport 復元 (`eventSyncTap.ensureRestored`) の clock seed はローカル正典の max clock を正とする。remote の clock を seed に混ぜない (端末間で clock 空間は Lamport で単調、ローカルが自端末の権威)。
- **`subscribe(onRemote)`**: 本スライスでは local (no-op) を委譲。remote 受信の常時購読は Phase 4d へ。

> **なぜ local outbox と remote キューを分けるか**: 既存 `Outbox` はローカル正典向けの「落ちても保留・復帰で flush」を担い、`push` の成否が編集フローに直結する。remote を同じ outbox に相乗りさせると、remote オフライン時に batch が永久保留になりローカル正典まで詰まる。→ **local を編集フロー同期の唯一の成功条件**にし、remote は**独立した `RemoteSyncQueue`** に置く。remote は失敗しても破棄せずキューに残し (§3.6)、UI に未同期件数として出す (§3.7)。純 fire-and-forget と違い「気づける・再送で直せる」。

### 3.2 remote leg のフィルタ — genesis actor 除外 + presentation 除外

remote へ渡す直前に、専用の filtering ラッパで 2 段のフィルタを掛ける (`FanoutSyncProvider` 内、または純関数として §W3d5-2)。

1. **genesis actor 除外 (§3.5・C1 対策)**: `actor === GENESIS_ACTOR` の batch は**丸ごと除外**する。受信経路が無い現状で genesis を remote に載せると 2 台目の genesis と clock 衝突するため (§3.5)。
2. **presentation 除外 (`isSyncable`)**: 残った batch の `ops` を `isSyncable` で絞る。

- **genesis batch または全 op が presentation の batch** → 除外/フィルタ後 ops 空 → **remote push を skip** (空 batch は送らない)。
- **mixed batch** (content + presentation。group/paste 等の複合 event 由来) → presentation を除いた**複製 batch** を push。`id` / `clock` / `timestamp` / `actor` / `sheetId` は保存し、ローカル batch と remote batch を `id`・`clock` で対応づけられるようにする。
- ローカル op-log (daemon) には presentation を含む元 batch がそのまま入る (フィルタしない)。

### 3.3 `sheetId` の remote 往復

- `BatchRecord` に `sheetId?: string` を追加 (`types.ts`)。
- `batchToRecord`: `batch.sheetId` があれば載せる (undefined なら省略)。
- `recordToBatch`: `value.sheetId` を `Batch['sheetId']` として復元。`isBatchRecordValue` は sheetId 無しレコード (旧データ) も通す (optional)。
- **batch.json レキシコン**: 現状不在。本スライスで `lexicons/app/conversensus/graph/batch.json` を新設し、`actor`/`clock`/`timestamp`/`ops`/`sheetId?`/`createdAt` を定義するか判断する (§8)。putRecord は任意 JSON を通すため機能上は必須でないが、他レコードとの一貫性・将来のバリデーションのため新設が望ましい。

### 3.4 remote provider の構築と注入

- session (`useAtprotoSession`) が非 null のとき、`AtprotoSyncProvider({ batches: collections.batches })` を構築する。
- `useEventSyncTap` / `useFileSheetOperations` に session (または構築済み remote provider) を渡し、tap の provider を `FanoutSyncProvider(local, remote)` にする。
- **未ログイン時**: remote 無し → tap は従来どおり local-only (`LocalServerSyncProvider` 単体)。W3d の挙動と完全一致 (退行なし)。**確定** (2026-07-19 ユーザー合意)。
- **フラグ**: W3d の `READ_FROM_OPLOG` と対に、remote push を明示 on/off できる `SYNC_TO_REMOTE` (仮) を設けるか検討 (§7)。既定は「ログイン時のみ remote」。

### 3.5 genesis と remote

- genesis batch (予約 actor `GENESIS_ACTOR` = `genesis`, 一意連番 clock) は daemon の lazy migration で**各端末が独立に生成**する。跨端末 content-hash は取らないため、端末ごとに **別 id・同一 clock 空間**の genesis ができる。
- **不変条件 (critic C1 対策・確定)**: **`GENESIS_ACTOR` の batch は remote (RemoteSyncQueue) へ push しない**。受信 (import) 経路が無い現状で genesis を remote へ載せると、2 台目が独立生成した genesis と **clock が衝突する 2 系統の genesis** が remote に並び、データ汚染する。→ remote leg では genesis batch を **actor で除外** (§3.2 の presentation フィルタと同じ層で `actor === GENESIS_ACTOR` を落とす)。genesis 由来の構造 (最初のシート・ノード等) は、受信を実装する Phase 4d で remote から正しく授受する。
- **独立 genesis しない**方針自体は保つが、受信が無い W3d5 では genesis を remote に載せないことで衝突を根絶する (載せない方が安全側)。
- genesis batch も presentation op (edge.setStyle 等) を含みうるが、上記のとおり **actor 除外で remote には一切載らない**ため presentation フィルタ以前に落ちる。

### 3.6 `RemoteSyncQueue` — 未送信の保持・再送・catch-up

remote 送信を**破棄しない**独立キュー。既存 `Outbox` を内包し、remote 専用の retry を担う。

- **enqueue**: `FanoutSyncProvider.push` から §3.2 のフィルタ済み batch (genesis actor 除外・presentation 除外後) を積む。id で重複排除 (べき等)。**genesis actor の batch は enqueue しない** (§3.5・C1 不変条件)。
- **flush (best-effort)**: `AtprotoSyncProvider.push` へ送る。**成功→キューから除去、失敗→キューに残す** (破棄しない)。失敗は編集フローに波及しない (§3.1)。
- **再送トリガ**: (a) 新規 push 時、(b) 手動「今すぐ同期」(§3.7)、(c) **起動時/再接続時の catch-up**。
- **catch-up (取りこぼし回収)**: 起動時/再接続時に `remote.pull` の max clock とローカル正典を突き合わせ、remote に無いローカル batch (genesis actor を除く) をキューへ積み直して flush する。best-effort push がオフライン中に取りこぼした分をここで回収する。
  - **コスト (critic D2)**: 現 `AtprotoSyncProvider.pull` は clock>cursor の**全件 list** (`collections.ts`)。**catch-up 1 回 = remote レコードの全件 pull 1 回**であり、履歴とともに線形にコストが増える。本スライスは catch-up を**起動時 + 再接続時 + 手動に限定**することでこの全件 pull の発生頻度を抑える。定期実行 (常時同期) は Phase 4d の subscribe/cursor 化で償却する。
- **キュー上限 (critic D1・確定)**: `RemoteSyncQueue` はセッション内で**無制限に成長させない**。remote が長時間落ちて未送信が積み上がる場合に備え、**保持件数の上限 (直近 N 件)** を設ける。上限超過時は**最古の未送信からキューを溢れさせる (FIFO eviction、直近 N 件を保持)**。溢れた分はキューからは消えるが**データは失われない** — ローカル正典 (daemon) に完全保存されており、remote に無い分は catch-up の全件 pull で再構成できる。→ キューはあくまで「push 待ちの近況バッファ」で、真の source of truth はローカル正典。上限値 (実装初期値 `REMOTE_QUEUE_MAX`) と超過時の UI 表現 (「未同期 N 件以上」等) は W3d5-3/-6 で確定。**overflow が起きたかどうかのフラグ**を UI (§3.7) が読めるよう公開する。
- **pending 公開**: キュー内の未送信件数を購読可能にし、UI (§3.7) と tap の `pending` に合流させる。
- 本スライスの catch-up は**起動時 + 手動**に留め、常時同期 (定期 subscribe 化) は Phase 4d へ委ねる (§7 で線引き)。

### 3.7 同期ステータス UI — 気づき + 手動回復

- **表示**: ログイン時のみ、`RemoteSyncQueue.pending` を購読して「クラウド未同期: N 件」を出す。0 件かつ最後の flush 成功なら「同期済み」表示 (または非表示)。エラー継続中は控えめな警告色。**キュー上限 (§3.6・D1) に達した場合は「未同期 N 件以上」等の頭打ち表現**とし、超過分は catch-up 回収に委ねる旨を含意する。
- **手動回復**: 「今すぐ同期」操作で `RemoteSyncQueue` の flush を即時トリガ。オフライン→復帰の検知を待たずユーザが能動的に回復できる。
- **配置**: 左サイドバー下部 (ATProto ログイン表示の近傍) に小さなインジケータ。既存の目立たない UI に合わせ、編集の邪魔をしない。
- **未ログイン時は非表示** (remote 経路が無いので同期概念が無い)。
- 実装は `RemoteSyncQueue` の pending 購読を React state に橋渡しする薄いコンポーネント。ロジックはキュー側に置き、UI は表示と手動トリガのみ。

## 4. 実装スライス分割

小さく・単体テスト可能な順に積む。2 台目実機検証は最後に隔離する。

| スライス | 内容 | 検証 | リスク |
|---------|------|------|--------|
| **W3d5-1** | `sheetId` remote 往復: `BatchRecord.sheetId?` + `batchToRecord`/`recordToBatch`/`isBatchRecordValue` 対応。batch.json レキシコン新設の判断 | mapper 単体テスト (sheetId 有/無の往復・旧データ後方互換) | 低 |
| **W3d5-2** | presentation フィルタ: batch の ops を `isSyncable` で絞る純関数 + 全 presentation batch の skip 判定 | 純関数の単体テスト (content/mixed/全 presentation) | 低 |
| **W3d5-3** | `RemoteSyncQueue` (§3.6): 未送信の保持・再送・pending 公開。既存 Outbox 内包 + presentation フィルタ適用。catch-up はインターフェースのみ (呼び出しは W3d5-5) | 単体テスト (失敗で破棄しない・再送で除去・重複排除・pending 数) | 中 |
| **W3d5-4** | `FanoutSyncProvider`: local await (ブロッキング) + remote は `RemoteSyncQueue` へ enqueue (非ブロッキング)、pull/subscribe は local 委譲 | in-memory provider で単体テスト (local 失敗→throw で編集保留, remote 失敗→編集は前進, フィルタ確認) | 中 |
| **W3d5-5** | tap 配線: session→remote provider 構築、`useEventSyncTap`/`useFileSheetOperations` へ注入、未ログイン時 local-only | フック/結合テスト (ログイン有無で provider 構成が変わる) | 中 |
| **W3d5-6** | 同期ステータス UI (§3.7): pending 購読インジケータ + 手動「今すぐ同期」 | コンポーネントテスト (件数表示・手動トリガ) | 低 |
| **W3d5-7** | catch-up (§3.6) の起動時/再接続時呼び出し + **送信の実機検証** (PDS 起動、編集が PDS batch コレクションに載る・未同期表示・手動再送・device B が手動 pull で取得できる) | 手動 e2e + **PDS レコード直接検査** (operation-manual / user-test-environment に手順追記) | 高 |

W3d5-1〜4 は PDS 非依存で単体テストのみ。W3d5-5 でフックへ、-6 で UI、-7 で初めて実機・PDS。

### 4.1 W3d5-7 受入基準 (critic A1/A2/A3 反映・確定)

**受信 (ローカル正典への import) は非目標** (§2) なので、「片方の編集が他方の画面に載る」は本スライスの受入基準に**しない** — それは legacy snapshot 経路が肩代わりしうるため **batch op-log の検証にならず、偽の確証になる** (critic A2)。代わりに送信を直接検査する:

1. **編集が remote (PDS の `app.conversensus.graph.batch` コレクション) に載る**: 1 台目で編集後、**PDS 上のレコードを直接検査**する (`listRecords` / repo エクスプローラ等)。以下を確認 (critic A3 必須化):
   - content batch の **`sheetId` が往復して載っている** (§3.3)。
   - **presentation op が載っていない** (`isSyncable` フィルタ・§3.2)。
   - **`GENESIS_ACTOR` の batch が載っていない** (§3.5・C1)。
   - `clock` が Lamport で単調・衝突なし。
2. **未同期表示・手動再送**: remote を落とした状態で編集 → 「クラウド未同期: N 件」が出る → 復帰後の自動 catch-up または手動「今すぐ同期」でキューが 0 件に戻る (§3.6/§3.7)。
3. **device B が手動 pull で取得できる**: device B のクライアントで `remote.pull` を叩き、1 台目が push した batch を**取得できること**を確認する (取得のみ。ローカル正典への import・画面反映は Phase 4d)。
4. **genesis 衝突を起こさない構成で行う**: §3.5 の不変条件により genesis は remote に載らないため、device B が独立 genesis を作っても remote は汚染されない。検証は「1 台目が送信・device B が pull で受領できる」までに留め、**両端末が同一ファイルへ双方向に書き込む常用検証は行わない** (受信未実装のため・§2)。

## 5. リスクと検証

- **ローカル正典を壊さない** (最重要): fanout の push は local 成功のみを編集フロー同期の成功条件にし、remote は `RemoteSyncQueue` へ非ブロッキング enqueue。remote 失敗が編集や undo/redo に波及しないことを結合テストで確認。
- **未送信を破棄しない**: remote push 失敗時に batch がキューに残り、再送で除去されることをテストで固定。サイレント消失を防ぐ (§3.6)。
- **presentation 漏洩**: remote batch に presentation op が載っていないことをテストで固定 (`isSyncable` フィルタの網羅)。
- **sheetId 欠落**: content batch の sheetId が remote 往復で保たれることを mapper テストで固定。旧 (sheetId 無し) レコードの後方互換も。
- **2 台目 genesis 衝突 (critic C1)**: 受信 (import) 経路が無いため、**genesis actor の batch を remote へ push しない** (§3.2/§3.5) ことで衝突を根絶する。片方向 push でも genesis を載せれば衝突するので、非目標の線 (§2) はこの genesis 衝突までカバーする。clock は Lamport でローカル権威。2 台目検証は W3d5-7 で**送信のみ** (§4.1) に隔離し、それ以前のスライスは単体で閉じる。
- **偽の確証を避ける (critic A2)**: cross-device の確認は画面反映ではなく **PDS レコードの直接検査** (§4.1) で行う。legacy snapshot 経路が肩代わりして「載ったように見える」ことを排除する。
- **checkpoint**: 各スライスにユニットテスト + `.test.md`。lint/typecheck/test 全パス。

## 6. W3e / step2 への申し送り

- **W3e (snapshot 退役)** の前提に「dual-read フラグ撤去可能なだけの実機実績」があるが、remote 同期が入ると 2 台目の実績も要件に含まれる。W3d5-7 の結果を W3e 着手判断に反映する。
- **step2 (branch op-log 化)**: branch も op-log 化されると remote 経路を branch batch も通る。本スライスの fanout / フィルタ / catch-up は branch へ横展開できる設計にしておく (branch 固有ロジックは持ち込まない)。

## 7. 未解決点 (実装中に確定)

- **batch.json レキシコン新設の要否** (§3.3): 機能上不要だが一貫性のため。W3d5-1 で判断。
- **`SYNC_TO_REMOTE` フラグの要否** (§3.4): ログイン=remote で足りるか、明示 off を持つか。W3d5-5 で判断。
- **catch-up の範囲** (§3.6): 起動時/再接続時 + 手動に留める (確定)。定期の常時同期は Phase 4d の subscribe 化へ。**「再接続検知」は `window` の `online` イベントで `catchUpRemote()` を呼ぶ方式に確定 (2026-07-20 / W3d5-7)** — `useEventSyncTap` の起動時 catch-up と同じ effect でリスナを張り、provider の作り直しに合わせて解除する。理由: 起動時と同じ入口を再利用でき追加状態を持たない、最頻の断 (端末のネットワーク断) をゼロコストで拾える。**flush 失敗後の定期バックオフ再送は採らない** — catch-up 1 回 = 全件 pull (D2) のコストを常時払うことになるため。`online` が発火しない障害 (PDS だけ落ちている等) は手動「今すぐ同期」(§3.7) と次回起動時 catch-up で回収し、未同期件数 UI でユーザが気づける。恒久的な解は Phase 4d の subscribe/cursor 化。
- **remote push の粒度**: putRecord を batch ごとに逐次 (現 `AtprotoSyncProvider.push`) で足りるか、レート制限を考慮するか。実機検証で観察。
- **同期ステータスの粒度** (§3.7): 「未同期 N 件」だけで足りるか、最終同期時刻やエラー詳細まで出すか。W3d5-6 で最小から始め実機で調整。

## 8. 確定した決定 (レビュー・合意ログ)

- 2026-07-19: remote は **純 fire-and-forget を採らず**、未送信を保持する `RemoteSyncQueue` + 可視ステータス + 自動/手動再送とする (中間案)。理由: 純 best-effort は失敗にユーザが気づけず自力回復もできない。双方向マージ (常時 subscribe + コンフリクト UX) は実行時コスト (全件ポーリングが履歴とともに線形増) が大きく、Phase 4d / step2 へ分離。
- 2026-07-19: 未ログイン時は local-only 継続 (W3d と完全一致、退行なし) で確定。
- 2026-07-19 (critic レビュー REVISE 反映): **本スライスは送信 (片方向 push) のみに絞り、受信 (batch op-log → ローカル正典への import) と常時同期は Phase 4d / 後続へ**。理由: `.subscribe(` の消費箇所が存在せず (grep 0 件)、依拠すべき既存受信が無い (A1)。現状の跨端末伝播は legacy snapshot 経路が肩代わりしており batch op-log とは別系統 (A2)。
- 2026-07-19 (critic C1): **`GENESIS_ACTOR` の batch は remote へ push しない**不変条件を確定 (§3.2/§3.5)。受信経路が無い状態で各端末が独立生成する genesis を remote に載せると clock 衝突する 2 系統の genesis が生じデータ汚染するため。
- 2026-07-19 (critic A3): W3d5-7 の受入基準を「画面に載る」から「**PDS の batch コレクションを直接検査**して sheetId 往復・presentation 除外・genesis 非 push・clock 単調を確認 + device B が手動 pull で取得できる」へ書換 (§4.1)。画面反映は legacy snapshot が肩代わりし偽の確証になるため。
- 2026-07-20 (W3d5-7): **再接続検知は `online` イベント方式に確定** (§7)。`useEventSyncTap` の起動時 catch-up と同じ effect でリスナを張り、provider 作り直しに合わせて解除する。flush 失敗後の定期バックオフ再送は不採用 — catch-up 1 回 = 全件 pull (D2) のコストを常時払うため。`online` が発火しない障害 (PDS のみ停止等) は手動「今すぐ同期」+ 次回起動時 catch-up + 未同期件数 UI で回収・可視化する。
- 2026-07-19 (critic D1/D2): `RemoteSyncQueue` にセッション内保持上限を設ける (超過分は catch-up 全件 pull で回収、ローカル正典が source of truth なのでデータ喪失なし)。catch-up 1 回 = remote 全件 pull 1 回のコストを明記し、起動時/再接続時/手動に限定 (§3.6)。
