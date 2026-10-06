# batchMapper テスト仕様

## 何を

`batchMapper` (step1 Phase 4c) をテストする。統一語彙 `Batch` と PDS の op-log
レコード `BatchRecord` の相互変換 (`batchToRecord` / `recordToBatch`) と、受信レコードの
構造ガード (`isBatchRecordValue`) を検証する。

## なぜ

4c の橋渡し方針は「batch をそのまま PDS の op-log レコードにする (非可逆なし)」。
この非可逆性のなさが崩れると、同期往復で clock や ops が欠落し projection が壊れる。
特に **id は rkey として持ちボディに含めない**設計のため、`recordToBatch` が渡された `batchId` から
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
- **recordToBatch**: 渡された `batchId` を id として復元し、`batchToRecord` → `recordToBatch` の往復が
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

## merge の写しの印 (step3 Phase 1 D2)

`Batch.copyOf` (写した元の点) と `mergedIn` (どの merge コミットの写しか) が PDS を往復して
**欠けない**ことを固定する。`copyOf` が欠けると、受信した写しが「普通の batch」になり、並行 merge の
重複を畳み込みが除けなくなる (同じ編集が二重に当たり、間の編集を巻き戻しうる)。

- **印を往復させる**: record に載り、`recordToBatch` で元の Batch に一致する
- **写しでない batch には印を付けない**: `sheetId` と同じく、無 → 無を保つ
- **印の形が違うレコードは弾く**: `copyOf` は `{ actor, seq }` (seq は正の整数)


## PDS から入る blob (step3 FPR の確認で発覚)

### 何を・なぜ

`@atproto/api` は読んだレコードの中の blob を `BlobRef` のインスタンスに変える (`$type` を持たず、`ref` は CID の
オブジェクト)。元の JSON の形に戻るのは `toJSON` を通ったときだけである。step3 Phase 2 から受信した batch は
Worker へ `postMessage` (structured clone) で渡り、`toJSON` が呼ばれないので、**他の人が貼った画像の参照が壊れて
「画像 URL を入力」になった** (実機で発覚。App 結合は Worker を通さないので出なかった)。`recordToBatch` で
素の JSON に戻す (`plainJson`)。

### どのように

PDS の JSON の形のレコードを `jsonToLex` (agent が読むときと同じ変換) に通し、`recordToBatch` の結果を
`structuredClone` (Worker へ渡すのと同じ) した後で、`readImageBlobLocation` が cid と mimeType を読めることを見る。
`plainJson` を外すと落ちる。

## isAcceptableRemoteBatch (security review M1・M2)

### 何を・なぜ

- **M1**: 保存の Worker は受信した batch の配列を一括で検証するので、壊れた batch (既知の op の項目が欠けている) が
  1 件混ざると配列ごと例外になり、その File の受信が全員分止まり続けた。PDS から入る所で 1 件ずつ見て落とす
- **M2**: Lamport の受信規則は受け取った最大の clock まで自分の clock を引き上げる。上限が無いと、他人が巨大な clock を
  書いたときに全員の clock がそこへ飛び、`+1` が正確でなくなる。上限は 2^48

### どのように

- 正しい batch・知らない種類の op (案 A) は受け取る
- 既知の op の項目が欠けた batch は受け取らない
- clock が上限ちょうどなら受け取り、超えたら・`MAX_SAFE_INTEGER` なら受け取らない
