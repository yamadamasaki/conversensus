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

`isBatchRecordValue` は PDS という外部境界から来る値のガード。他種レコードや壊れた値を
pull で掴んでも同期全体を落とさず飛ばすための判定であり、その正確さを固定する。

## どのように

- **batchToRecord**: id を除き actor/clock/timestamp/ops を載せ、createdAt を timestamp
  から導出すること、ボディに `id` を含めないことを確認。
- **recordToBatch**: rkey を id として復元し、`batchToRecord` → `recordToBatch` の往復が
  元の `Batch` に一致すること (非可逆でない) を確認。
- **isBatchRecordValue**: 正しい BatchRecord を受理 / null・非オブジェクト・型不一致
  (actor 非文字列 / clock=NaN / ops 非配列) を拒否。
