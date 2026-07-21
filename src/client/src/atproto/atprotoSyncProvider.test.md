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

## pushRemote と counted skip (Phase 4d-1)

`push(batches)` は `pushRemote(entries)` になった。運搬単位が `Batch` ではなく `RemoteBatch`
(Batch + fileId) なのは、ATProto の batch コレクションが repo 全体で 1 つで、レコード自身が
適用先ファイルを持たないと受信側が復元できないため。あわせてこのクラスは `SyncProvider` ではなく
`RemoteBatchTarget` を実装する — `SyncProvider` はファイル単位の境界であり、remote の
repo 全体という粒度と噛み合わないため。

`pull` は `isBatchRecordValue` を通らないレコード (壊れた / 他種 / **fileId 無しの旧形式**) を
飛ばすが、**飛ばした件数を数えて `console.warn` に出す**。既存の「壊れた / 他種レコードは飛ばす」
テストがこの警告経路も通る。silent skip にしない理由は `batchMapper.test.md` の fileId 節と同じ。

## pullRemote — 既読位置を持たない取得 (Phase 4d-4)

`pull(since)` を `pullRemote()` へ置き換えた。**cursor を取らず、常に全件返す。**

### なぜ既読位置を捨てたか

4d-3 までの cursor は clock を符号化していたが、clock は端末をまたぐと単調でないため
取りこぼす (設計 §1.3)。ではレコード順に基づく cursor へ替えられるかを実コードで確認した
結果、**ATProto 側に既読位置として使える値が無い**ことが判明した:

- `listRecords` の cursor は **rkey 位置**。本実装の rkey は batchId (ランダム UUID) なので
  順序が時系列にならず、後から書いた batch の UUID が保存済み cursor より小さいと
  永久に取りこぼす。**clock cursor と同じバグの構造**。
- `indexedAt` は repo の `listRecords` 出力に存在しない (`@atproto/api` の型で確認済。
  出力は `{ uri, cid, value }` のみ)。appview 側の概念。
- `rev` はレコード単位では露出しない (`com.atproto.sync.*` が要る)。

→ **既読位置を持たない契約にした。** 取りこぼしゼロを構造的に保証し、二重取り込みは
受信側 (`EventStore.appendReceivedBatches`, 4d-0) のべき等性が無害化する。代償は毎回
O(全履歴) の list だが、起動契機は起動時 + `online` + 手動に限られる (§3.4 で subscribe を
不採用としたため) ので受容できる。rkey を時系列ソート可能なキーへ変える案は
Jetstream 化と同じ Phase で扱う (ユーザー決定)。

- **常に全件を返す**: 2 回続けて呼んでも同じ全件が返ること。前進する既読位置が無い
  = 取りこぼしようがない、を直接の証拠にする。
- **整列規則**: `clock → actor → id` (`orderBatches` と同じ, 4d-3)。同一 clock で actor
  違い・timestamp 逆順のレコードを与え、timestamp ではなく actor で決まることを確認する。
- **fileId をエンベロープで返す**: 返すのが `Batch` ではなく `RemoteBatch` であること。
  remote の batch コレクションは repo 全体で 1 つなので、レコード自身の fileId でしか
  受信側は適用先を復元できない (§3.1)。
- **counted skip**: 壊れた / 他種 / fileId 無しレコードを飛ばすこと (件数の warn は §3.1)。

## subscribe — 既読管理を id 集合へ (Phase 4d-4)

cursor が無くなったので、既読管理を **観測済み batch id の集合**へ変えた。

**これは §1.5 の欠陥修正でもある**: cursor 版は baseline 確立が失敗すると次の成功 poll が
baseline になり、**その間に現れた batch を恒久的に落としていた**。id 集合なら poll が失敗
しても集合は前進しないので、次の成功 poll で取りこぼし分がそのまま現れる。

消費箇所は現在 0 件 (§3.4 のとおり subscribe は不採用)。Jetstream 化と `list()` の
ページングを併せて別 Phase で作り直す。

- **初回 poll は baseline 確立のみ**で配信しないこと。
- **baseline 後の新規のみ配信**すること。
- **baseline の poll が失敗しても落とさない (4d-4 回帰)**: 初回 poll を失敗させ、その間に
  追記が起きても、以降に現れた batch が確実に配信されることを確認する。cursor 版の
  恒久取りこぼしが再発しないための固定。
- `unsubscribe` でティックが止まること。
