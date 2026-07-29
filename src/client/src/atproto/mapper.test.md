# mapper.test.ts — テスト仕様

## 何をテストするか

`mapper.ts` のドメイン型 ↔ ATProto レコード型の双方向変換関数。

## なぜテストするか

- 変換ロジックに誤りがあると PDS への書き込みデータが壊れる
- `rkeyFromUri` を使った AT-URI → UUID 変換は境界値が多い
- `toInt` (number | string → integer) の変換は型境界をまたぐ
- ネットワーク不要の純粋関数なのでユニットテストが書きやすい

## どのようにテストするか

- ドメイン型のサンプルを用意し、`→ record → ドメイン型` の往復変換が元データと一致することを確認
- `width/height` の `string` 型 ("120") が `integer` に変換されることを確認
- `parentId` ↔ `parent.uri` の変換が正しく動くことを確認
- `properties` が省略された場合に undefined になることを確認

## 対象範囲の変遷

- **step1 Phase 6 p6-4**: `recordToSheetMeta` / `recordToFileMeta` のテストを削除した。
  この 2 関数は PDS legacy レコードの**読取**専用で、唯一の消費者だった
  `sync.ts` の `fetchSheetsFromAtproto` / `fetchFilesFromAtproto` /
  `fetchFileFromAtproto` を撤去した時点で消費者 0 になったため、関数ごと削除した
  (設計 `step1-phase6-w3e-snapshot-retire.md` §3.8)。
  file/sheet の**書込側** (`fileToRecord` / `sheetToRecord`) は旧 branch 経路
  (`BRANCH_FROM_OPLOG=false`) が使っているのでテストごと残る — p6-5 で退役する。
