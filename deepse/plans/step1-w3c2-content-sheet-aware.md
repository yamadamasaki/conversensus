# step1 W3c2 — content を sheet-aware に (batch へ sheetId 付与) — 設計

> 位置づけ: W3 (読み取り経路移行) のスライス W3c2。上位設計 `deepse/plans/step1-w3-read-path.md` §4 の
> 「content を sheet-aware に: tap が `activeSheetId` を batch に付与」。W3c1 (構造書込経路 op-log 化, #157 merged) の続き。

## 1. 問題 — content batch がどのシートのものか分からない

W3c1 までで、node/edge 編集 (content) と sheet/file 構造 (structure) はどちらもファイル単位の単一 tap を通り op-log へ流れる。
しかし content batch は **どのシートに属すか (`sheetId`) を持たない**:

- `graphEventToBatch(event, clock)` (`toUnified.ts:321`) は `sheetId` を付与しない。
- server `EventStore` の `batches` テーブルに `sheet_id` 列が無い (`eventStore.ts:46`)。

`BatchSchema.sheetId` は W3b で optional 追加済み (`unified.ts:236`)、wire (`POST /files/:id/batches` の `BatchSchema.safeParse`) も透過する。
残るは **(a) 書き込み時に content batch へ `activeSheetId` を載せる**ことと **(b) server が `sheet_id` を永続化する**ことの 2 点。

これが揃うと W3d の `projectFile` が batch を `sheetId` でシートへ振り分けられる (構造/内容は op カテゴリで判別, §3.1)。

## 2. 方針

### 2.1 sheetId は content 経路でのみ付与する (structure は付与しない)

content と structure は同じ tap (`record`) を通るため、**呼び出し側が sheetId を渡すか否か**で区別する。

- `record(event, sheetId?)` / `graphEventToBatch(event, clock, sheetId?)` を optional 引数で拡張。sheetId が渡されたときだけ batch に載せる。
- **content 経路**: `GraphEditor` は自身の `activeSheetId` (Props, 非 null `SheetId`) を注入するラッパを `useEventStore` に渡す。GraphEditor は `${sheetId}/${branchId}` で key され (`App.tsx:196`)、常に単一シートの content を発する。
- **structure 経路**: `useFileSheetOperations` の構造ハンドラ / `App.handleAddSheet` は sheetId を渡さない → file-level batch は `sheetId` 無しのまま (§3.1 と整合)。

file-level batch が sheetId を持たないのは「呼び出し側が渡さない」から自然に成立する。読み取り側 (`projectFile`, W3d) は sheetId の有無ではなく **op カテゴリ**で content/structure を判別するため、この非対称は安全。

### 2.2 tap 内の保留は (event, sheetId) 対で持つ

`EventSyncTap` は clock を drain 時に割り当てるため event を保留する (`pendingEvents`)。sheetId も **event と対で保留**し、drain の `graphEventToBatch(event, tick, sheetId)` で載せる。これにより sheetId が clock 採番のタイミングに依存せず event に正しく紐づく。

### 2.3 server の sheet_id 永続化 (後方互換マイグレーション)

`batches` テーブルに `sheet_id TEXT` (nullable) を追加する:

- 新規 DB: `CREATE TABLE` に `sheet_id TEXT` を含める。
- 既存 DB: `CREATE TABLE IF NOT EXISTS` は列を足さないため、`PRAGMA table_info` で列の有無を検査し無ければ `ALTER TABLE ... ADD COLUMN sheet_id TEXT` を一度実行する (べき等)。
- `appendBatch` の INSERT に `sheet_id` を追加 (`batch.sheetId ?? null`)。
- `getBatches` / `rowToBatch` で `sheet_id` を読み戻し、非 null のとき `sheetId` を復元する。

pre-W3 の既存 batch は `sheet_id = NULL` になるが、これらは W3d cutover で破棄・再生成される (W3 設計 §3.5) ため実害はない。

## 3. スコープ

**含む**: content batch への `activeSheetId` 付与 (client)、`sheet_id` の server 永続化と読み戻し。

**含まない (後続へ)**:
- 読み取り (`projectFile` による sheetId 振り分け) は W3d。W3c2 は書き込み経路のみ。
- structure batch の sheetId (定義上持たない)。
- ATProto (remote) 側の sheetId 永続化は W3d5。

## 4. 変更ファイル

- `src/client/src/events/toUnified.ts`: `graphEventToBatch(event, clock, sheetId?)` に拡張。
- `src/client/src/sync/eventSyncTap.ts`: `record(event, sheetId?)`、保留を `{event, sheetId}` 対に、drain で sheetId を載せる。
- `src/client/src/hooks/useEventSyncTap.ts`: 返す関数を `(event, sheetId?) => void` に。
- `src/client/src/hooks/useFileSheetOperations.ts`: `syncRecord` の型を `(event, sheetId?) => void` に (構造ハンドラは sheetId 未指定のまま)。
- `src/client/src/GraphEditor.tsx`: `syncRecord` prop 型を拡張、`activeSheetId` を注入するラッパを `useEventStore` に渡す。
- `src/server/src/eventStore.ts`: `sheet_id` 列の追加・マイグレーション・INSERT/SELECT 反映。

## 5. テスト

- **toUnified**: `graphEventToBatch` が sheetId 引数を batch に載せる / 未指定なら載せないことを固定。
- **eventSyncTap**: `record(event, sheetId)` の sheetId が push された batch に反映されること、sheetId 無しなら batch に無いことを固定。
- **eventStore**: sheetId 付き batch の round-trip (append→getBatches で sheetId 復元)、sheetId 無し batch は sheetId 無しで返ること。既存 (sheet_id 無し) DB への ALTER マイグレーションのべき等性。
- 各テストに `.test.md` を付す。既存テスト全パス + typecheck + lint。

## 6. 検証 (非破壊性)

- content 編集後、op-log batch に `sheetId` が載る (server SQLite の `sheet_id` 列)。
- structure batch は従来通り sheetId 無し。
- 読み取りは W3d まで snapshot が正典 → UI 表示は不変 (dual-write 継続)。

## 7. 持ち越し

- `projectFile` による sheetId ベースのシート振り分け (W3d)。
- ATProto の sheetId 永続化 (W3d5)。
