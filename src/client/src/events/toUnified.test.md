# toUnified.test.ts — GraphEvent エンコーダのテスト仕様

## 何を

`toUnified.ts` の `graphEventToOps` / `graphEventToBatch` を検証する。

## なぜ

現行 client 語彙 `GraphEvent` (19 種) が統一語彙の **部分集合**であることを保証する。特にバッチモデル (deep-interview で確定) の要である「複合イベントの基本 op への分解」が正しいことを固定する。これが崩れると undo/redo と同期の両立が破綻する。

## どのように

- **複合イベントの分解**:
  - `NODES_GROUPED` → group ノードの node.add + layout + 子ごとの setParent/setLayout に分解され、子を先に追加した状態で畳み込むと親子関係が復元されることを確認する。
  - `NODE_REPARENTED` → setParent (structure) + setLayout (layout) の 2 op に分かれることを確認する (親変更と位置変更は別カテゴリ)。
- **19 型の網羅**: 全 19 イベント型の最小インスタンスを用意し、(a) 型集合が 19 であること、(b) 各イベントが 1 つ以上の op に分解されることを確認する。新しいイベント型を追加してエンコーダ対応を忘れると気づける「番人」。
- **メタの写像**: `graphEventToBatch` が event.id → BatchId、userId → actor、指定 clock を Batch に写すことを確認する。
- **file 構造イベント (W3c1)**: シート/ファイル構造イベント (`SHEET_CREATED`/`SHEET_REMOVED`/`SHEET_RENAMED`/`SHEET_DESCRIBED`/`FILE_RENAMED`/`FILE_DESCRIBED`) が対応する file op (`sheet.create`/`sheet.remove`/`sheet.setName`/`sheet.setDescription`/`file.setName`/`file.setDescription`) に変換されることを確認する。description 未指定 (クリア) は description フィールドを持たない op になること、および構造イベントの batch は `sheetId` を持たない (file 構造 batch は sheet scope 無し, §3.1) ことを固定する。
- **content の sheet-aware 化 (W3c2)**: `graphEventToBatch(event, clock, sheetId?)` の第 3 引数に `sheetId` を渡すと content batch に `sheetId` が載ること、省略すると batch が `sheetId` を持たないことを固定する。content 経路 (GraphEditor) は発生元シートを渡し、structure 経路は渡さないという非対称を write 時点で保証する。

- **layout 値の整数化 (W3d5-7)**: `node.setLayout` の `x`/`y`/`width`/`height` が整数へ丸められることを固定する。**ATProto のデータモデル (DAG-CBOR) には float 型が無く**、小数を含む op を載せた batch は PDS の `putRecord` が 400 (`Expected one of null, boolean, integer, … got 661.99…`) で弾く。React Flow はドラッグ結果をサブピクセルの小数で返すため、丸めが無いと **layout op を含む batch が remote へ一切載らない** — W3d5-7 の実機検証で実際にこれが起きた。丸めは op 生成時 (= ローカル正典に載る値) に掛ける: remote 側だけで丸めると local と remote で値が食い違い `recordToBatch` の往復が非可逆になるため。`width`/`height` は `number | string` の union なので、CSS 値 (`'100%'`) はそのまま通ることも合わせて固定する。

## 既知の制約 (テスト対象外・Phase 2 で解消)

- `NODE_PROPERTIES_CHANGED.to` は差分だが統一 op は置換意味論。忠実変換には capture 時の full properties が必要。
- `NODE_STYLE_CHANGED` は width/height 変更の実体を持つため layout に正規化している。

## graphEventToBatch の actor (Phase 4d-2)

シグネチャが `graphEventToBatch(event, { clock, actor, sheetId? })` になった。
以前は `event.userId` を actor にしていたが、actor は同期層 (`EventSyncTap`) が与える
識別子に変わったため、呼び出し側から明示的に渡す (理由は `eventSyncTap.test.md` の
actor 節と `step1-phase4d-receive.md` §3.1)。

- 渡した actor がそのまま batch に載ること (以前の「userId を actor にする」を置き換え)。
