# batchMapper テスト仕様

## 何を

`batchMapper` (step1 Phase 4c) をテストする。統一語彙 `Batch` と PDS の op-log
レコード `BatchRecord` の相互変換 (`batchToRecord` / `recordToBatch`) と、受信レコードの
構造ガード (`isBatchRecordValue`) を検証する。

## なぜ

4c の橋渡し方針は「batch をそのまま PDS の op-log レコードにする (非可逆なし)」。
この非可逆性のなさが崩れると、同期往復で clock や ops が欠落し projection が壊れる。
特に **id は rkey として持ちボディに含めない**設計のため、`recordToBatch` が rkey から
id を正しく復元できることが往復の要。

**W3d5-1: sheetId の remote 往復**。daemon 側は W3c2 で `sheet_id` 列を持つが、ATProto
往復では従来 `Batch.sheetId` が落ちていた。content batch の発生元シートを PDS 側にも保持
しないと、2 台目が pull した batch を正しいシートへ projection できない。よって sheetId を
`BatchRecord` に載せ往復させる。ただし file 構造 batch (sheet.*/file.*) と旧データは
sheetId を持たないため **optional** とし、無 → 無を保つ後方互換が要件になる。

`isBatchRecordValue` は PDS という外部境界から来る値のガード。他種レコードや壊れた値を
pull で掴んでも同期全体を落とさず飛ばすための判定であり、その正確さを固定する。sheetId は
optional なので、無いレコードは通し (後方互換)、有るなら string 型を要求する
(型不一致は壊れたレコードとして弾く)。

## どのように

- **batchToRecord**: id を除き actor/clock/timestamp/ops を載せ、createdAt を timestamp
  から導出すること、ボディに `id` を含めないことを確認。sheetId 無しの batch は record に
  `sheetId` フィールドを付けない / content batch の sheetId は record に載る、の 2 ケース。
- **recordToBatch**: rkey を id として復元し、`batchToRecord` → `recordToBatch` の往復が
  元の `Batch` に一致すること (非可逆でない) を確認。content batch の往復で sheetId が保たれる /
  旧データ (sheetId 無しレコード) は sheetId undefined で復元する、の後方互換ケースも固定。
- **isBatchRecordValue**: 正しい BatchRecord を受理 / null・非オブジェクト・型不一致
  (actor 非文字列 / clock=NaN / ops 非配列) を拒否。sheetId 無しレコードを通す (後方互換) /
  sheetId が string のレコードを通す / sheetId が string 以外は弾く、の 3 ケース。
