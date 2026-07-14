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

## 既知の制約 (テスト対象外・Phase 2 で解消)

- `NODE_PROPERTIES_CHANGED.to` は差分だが統一 op は置換意味論。忠実変換には capture 時の full properties が必要。
- `NODE_STYLE_CHANGED` は width/height 変更の実体を持つため layout に正規化している。
