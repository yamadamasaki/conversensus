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
- **push**: batch を `v1~<fileId>~<clock>~<batchId>` の rkey で書く (Phase 7 p7-1) /
  同一 batch の再 push は上書き (件数不変)。
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

- `listRecords` の cursor は **rkey 位置**。当時の rkey は batchId (ランダム UUID) だったので
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

## rkey スキームの切替 (Phase 7 p7-1)

**何が変わったか**: 書込の rkey が `batchId` 単体から `v1~<fileId>~<clock12>~<batchId>` になった
(組み立て・分解は `batchRkey.ts`、性質のテストは `batchRkey.test.md`)。**ファイル単位の範囲取得は
rkey の辞書順だけで成立する**ので、この層では「書いた rkey そのもの」と「rkey から id を
復元できること」を固定する。

**なぜここで固定するか**: `batch.id` はレコードボディに無く **rkey にしか存在しない**。
rkey の形式と復元が食い違えば、受信した batch が別 id として正典に入り、
`(file_id, batch_id)` のべき等 dedup が効かなくなる (= 同じ編集が二重に適用される)。

**どのように**: `inMemoryBatches` に 3 つの仕込み口を持たせ、rkey の形を作り分ける。

- `_seed` — 新形式 rkey。既定の経路。
- `_seedLegacy` — 旧形式 rkey (= batchId 単体)。**p7-1 時点は読取が repo 全件 list のままで
  新旧が混在する**ので、旧形式からも復元できることを固定する。この寛容さは全件 list を
  撤去する p7-5 で外す (そのときこのテストも落とす)。
- `_seedRkey` — 任意の rkey。`v1~` で始まるのに形式を満たさない rkey を仕込み、
  **id を推測して正典へ入れない**こと (飛ばして数える) を固定する。

`push` 側は `_rkeys()` で書き込まれた rkey を直接 assert する — 件数だけを見ると
「rkey は違うが件数は同じ」を見逃し、範囲取得が静かに壊れる。

## pullRemoteForFile — ファイル単位の範囲取得 (Phase 7 p7-2)

`pullRemote()` (repo 全件) の隣に `pullRemoteForFile(fileId)` が入った。取得量が
**repo 全体ではなくそのファイルの履歴に比例する**ことがこのスライスの目的である。

**なぜ結果だけでは足りないか**: 全件読んでから JS で捨てても結果は同じになるので、
結果を見るテストは目的の達成を判定できない。そのため `inMemoryBatches` は
`listByFile` を**実 PDS と同じ手順**で実装し (rkey 昇順に並べ、合成 cursor `v1~<fileId>`
より大きいところから読み、prefix を外れた 1 件で停止)、**走査したレコード件数**を
`_scanned()` で公開する。走査の論理そのものは `rangeFetch.test.md` が別に固定する。

- **隣接 fileId を含めない** — `FILE` より小さい / 大きい fileId のレコードを両側に置き、
  返るのが対象ファイルの分だけであること。fileId は UUID 固定長なので、ある fileId が
  別の fileId の prefix になることはない (設計 §3.2)。
- **走査が repo 全体に比例しない** — 他ファイル 10 件 + 自分 1 件で `_scanned()` が **2**
  (自分 1 件 + 境界の 1 件)。読み過ぎ 1 件は境界検出のための正常動作 (§3.2)。
- **旧 rkey を 1 件も走査しない** — 旧形式 4 件を混ぜても `_scanned()` が 1。
  `v1~` 前置による rkey 空間の分離 (§3.1) が効いていることの証拠。踏むようになると
  「全件 list を別の形でやり直す」形に退化する。
- **既読位置を持たない** — 2 回呼んで同じ全履歴が返ること。絞ったのは
  「repo 全体 → 1 ファイル」の軸だけで、「全履歴 → 差分」の軸は絞っていない (§2.2)。
- **整列は clock → actor → id** — 範囲取得は rkey 昇順で返るが、rkey の clock は発番端末の
  ものなので順序の権威にできない。全件版と同じ規則で並べ替えること。
- **壊れた新形式 rkey は飛ばす** — prefix には合致するが clock 桁数が違う rkey を混ぜ、
  id を推測して正典へ入れないこと。
- **合成 cursor が prefix の直前を指す** — `batchRkeyFileCursor(f) < batchRkeyPrefix(f)` と
  前方一致関係を直接 assert する。この関係が崩れると**そのファイルの最初の 1 件だけ**が
  静かに落ちる (最も見つけにくい壊れ方) ので、性質として固定する。
