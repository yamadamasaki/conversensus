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

## fileId (Phase 4d-1)

`BatchRecord.fileId` を**必須**にした。ATProto の batch コレクションは repo 全体で 1 つなので、
レコード自身が適用先ファイルを持たないと受信側が復元できない。特に file 構造 batch は
`sheetId` すら持たないため手掛かりが皆無になる (設計 `step1-phase4d-receive.md` §3.1)。

**`fileId` は `Batch` には持たせず、`batchToRecord(batch, fileId)` のように外から与える。**
ローカルでは op-log がファイル単位に仕切られていて (`batches.file_id` 列) 文脈から復元できるので、
`Batch` に埋め込むと列と二重持ちになって食い違う余地が生まれる。「ローカルでは文脈、remote では
埋め込み」という非対称を `RemoteBatch` エンベロープで表現する。
(対比: `sheetId` は 1 ファイルに複数シートがあり文脈から復元できないので `Batch` に載る)

- `batchToRecord` が外から渡した fileId を record に載せ、`Batch` 自身は fileId を持たないこと。
- **`fileId` 無しレコード (W3d5 以前に書かれたもの) を `isBatchRecordValue` が弾くこと**。
  受信側は適用先を復元できないので取り込まない。`fileId` が string 以外も弾く。
  **弾いた件数は呼び出し側 (`pull`) が数えて警告に出す** — silent skip にしない。W3d5-7 で
  「PDS が float を拒否して全 push が 400、しかしコンソールは無言」という事故があったため、
  静かに捨てる経路を新たに作らない。
- `recordToRemoteBatch` が適用先 fileId と Batch の対を復元すること (受信経路 4d-5 で使う)。
