# atprotoSyncProvider テスト仕様

## 何を

`AtprotoSyncProvider` (step1 Phase 4c、ATProto を裏に隠す `SyncProvider` 実装) を
テストする。`push` / `pull` / `subscribe` が op-log コレクションへの読み書きに正しく
翻訳されることを、PDS・タイマー非依存 (依存注入) で検証する。

## なぜ

この provider は D3 / §6 の「ATProto を単一インターフェースの裏に隠す」中核。外の層は
`SyncProvider` だけに依存するため、その契約が回帰すると同期が静かに壊れる:

1. **push のべき等性**: batch は不変。同一 batchId の再 push は上書きで重複しない。
   再送 (outbox flush) で二重にならない保証。
2. **pull の cursor 単調前進**: clock > cursor のみ返し、cursor は取得済み最大 clock まで
   前進する (新規ゼロでも前進)。これがないと毎回全件再取得・無限ループになる。
3. **外部境界の頑健性**: 壊れた/他種レコードを掴んでも pull 全体を落とさず飛ばす。
4. **subscribe の baseline**: 購読開始時に既存分を再配信しない (初回は基準確立のみ)。
   これがないと購読するたびに既知の batch が洪水のように再配信される。

## どのように

- 依存を注入する: `inMemoryBatches` (collections.batches と同形の in-memory 実装、
  `_seed` で他ユーザーの追記を模擬) と `manualScheduler` (手動 tick 可能なスケジューラ)。
  非同期の解決は `flush` (setTimeout 0) で待つ。
- **push**: batch を rkey=batchId で書く / 同一 id の再 push は上書き (件数不変)。
- **pull**: cursor より後を clock 昇順で返し cursor=最大 clock / 空 cursor は全件 /
  新規ゼロでも cursor が tip まで前進 / 壊れたレコードを飛ばす。
- **subscribe**: 初回 tick は非配信 (baseline) / baseline 後に seed した新規のみ配信 /
  unsubscribe でスケジューラが停止する。
