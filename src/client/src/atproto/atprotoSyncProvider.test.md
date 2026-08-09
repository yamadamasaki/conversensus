# atprotoSyncProvider テスト仕様

## 何を

`AtprotoSyncProvider` (step1 Phase 4c、ATProto を裏に隠す `SyncProvider` 実装) を
テストする。`pushRemote` / `pullRemoteForFile` / `listRemoteFiles` / `createRemote` /
`pullAllRemoteForMigration` が op-log コレクションへの読み書きに正しく翻訳されることを、
PDS 非依存 (依存注入) で検証する。

## なぜ

この provider は D3 / §6 の「ATProto を単一インターフェースの裏に隠す」中核。外の層は
`SyncProvider` だけに依存するため、その契約が回帰すると同期が静かに壊れる:

1. **push のべき等性**: batch は不変。同一 batchId の再 push は上書きで重複しない。
   再送 (outbox flush) で二重にならない保証。
2. **pull の cursor 単調前進**: clock > cursor のみ返し、cursor は取得済み最大 clock まで
   前進する (新規ゼロでも前進)。これがないと毎回全件再取得・無限ループになる。
3. **外部境界の頑健性**: 壊れた/他種レコードを掴んでも pull 全体を落とさず飛ばす。
4. **範囲取得が repo 全体に比例しない**: 走査件数そのものを固定する (Phase 7 p7-2)。
   結果だけを見ると「全件読んで JS で捨てる」実装と区別できない。

## どのように

- 依存を注入する: `inMemoryBatches` (collections.batches と同形の in-memory 実装、
  `_seed` で他ユーザーの追記を模擬、`_scanned()` で走査件数を公開)。
- **push**: batch を `v1~<fileId>~<clock>~<batchId>` の rkey で書く (Phase 7 p7-1) /
  同一 batch の再 push は上書き (件数不変)。
- **pull**: cursor より後を clock 昇順で返し cursor=最大 clock / 空 cursor は全件 /
  新規ゼロでも cursor が tip まで前進 / 壊れたレコードを飛ばす。

## pushRemote と counted skip (Phase 4d-1)

`push(batches)` は `pushRemote(entries)` になった。運搬単位が `Batch` ではなく `RemoteBatch`
(Batch + fileId) なのは、ATProto の batch コレクションが repo 全体で 1 つで、レコード自身が
適用先ファイルを持たないと受信側が復元できないため。あわせてこのクラスは `SyncProvider` ではなく
`RemoteBatchTarget` を実装する — `SyncProvider` はファイル単位の境界であり、remote の
repo 全体という粒度と噛み合わないため。

`pull` は `isBatchRecordValue` を通らないレコード (壊れた / 他種 / **fileId 無しの旧形式**) を
飛ばすが、**飛ばした件数を数えて `console.warn` に出す**。既存の「壊れた / 他種レコードは飛ばす」
テストがこの警告経路も通る。silent skip にしない理由は `batchMapper.test.md` の fileId 節と同じ。

## pullAllRemoteForMigration — 既読位置を持たない取得 (Phase 4d-4)

`pull(since)` を全件取得へ置き換えた。**cursor を取らず、常に全件返す。**
(p7-5 で `pullRemote` から `pullAllRemoteForMigration` へ改名し、移行専用に閉じ込めた。)

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
O(全履歴) の list だが、起動契機は起動時 + `online` + 手動に限られる (§3.4 で常時購読を
不採用としたため) ので受容できる。**rkey の構造化は Phase 7 p7-1 で実施され**、
通常経路はファイル単位の範囲取得へ移った (下の p7-2 節)。この全件取得に残る消費者は
移行 (`migrateRemoteRkey`) だけである — 旧 rkey のレコードは新経路の走査範囲に
現れないので、探せるのが全件走査しかないため (p7-5)。

- **常に全件を返す**: 2 回続けて呼んでも同じ全件が返ること。前進する既読位置が無い
  = 取りこぼしようがない、を直接の証拠にする。
- **整列規則**: `clock → actor → id` (`orderBatches` と同じ, 4d-3)。同一 clock で actor
  違い・timestamp 逆順のレコードを与え、timestamp ではなく actor で決まることを確認する。
- **fileId をエンベロープで返す**: 返すのが `Batch` ではなく `RemoteBatch` であること。
  remote の batch コレクションは repo 全体で 1 つなので、レコード自身の fileId でしか
  受信側は適用先を復元できない (§3.1)。
- **counted skip**: 壊れた / 他種 / fileId 無しレコードを飛ばすこと (件数の warn は §3.1)。

## subscribe の撤去 (Phase 7 p7-5)

4d-4 で入れた subscribe (定期 poll + 観測済み id 集合による既読管理) と、その 4 件の
テストを **p7-5 で削除した**。

理由は「消費箇所が一度も 1 件にならなかった」こと。受信は 4d 設計 §3.4 で
「起動時 + `online` + 手動」に決まっており、常時購読はそもそも採らない方針だった。
実装だけが残ると**倒す先の無い拡張点**になり、Phase 6 が実害を出した
「書くが読まない二重モデル」と同型になる。加えて中身が全件 poll なので、
Phase 7 が消したかった経路そのものでもあった。

Jetstream 購読は WebSocket でレコード形式も異なるため、Phase 8 で作り直す —
この実装を温存しても再利用できる部分が無い。

なお **§1.5 の欠陥修正 (baseline 確立の失敗で恒久取りこぼし) の知見は失われていない**:
既読位置を持たない契約 (上節) が同じ問題を構造的に消しており、それは
「2 回続けて呼んでも同じ全件が返る」テストで固定されている。

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
- `_seedLegacy` — 旧形式 rkey (= batchId 単体)。**移行 (p7-4) が読むのは旧形式なので、
  p7-5 のあともこの寛容さは残る** — 全件取得は移行専用として生き残り、そこで旧 rkey から
  batch.id を復元できることが移行の前提そのものになっている。
- `_seedRkey` — 任意の rkey。`v1~` で始まるのに形式を満たさない rkey を仕込み、
  **id を推測して正典へ入れない**こと (飛ばして数える) を固定する。

`push` 側は `_rkeys()` で書き込まれた rkey を直接 assert する — 件数だけを見ると
「rkey は違うが件数は同じ」を見逃し、範囲取得が静かに壊れる。

## pullRemoteForFile — ファイル単位の範囲取得 (Phase 7 p7-2)

全件取得の隣に `pullRemoteForFile(fileId)` が入った。取得量が
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

## createRemote — 移行専用のまとめ書き (Phase 7 p7-4)

移行 (`migrateRemoteRkey`) はローカル正典の全 batch を新 rkey で書き直す。`pushRemote`
(1 件 = 1 `putRecord` = **repo commit 1 回**) ではその規模で commit 費用が支配的になるため、
`applyWrites` (1 リクエスト = 1 commit に最大 200 件) の口を別に用意した。実測は
200 件で **4084ms (20.4ms/件) → 209ms (1.0ms/件)** (設計 §5.4)。局所 PDS で RTT が
ほぼ 0 の条件なので、差は往復回数ではなく commit 回数である。

- **`pushRemote` と同じ rkey で書く** — 書込経路が 2 本になった以上、rkey が食い違うと
  移行したレコードが範囲取得から漏れる。両者の rkey 列を同じ形で固定する。
- **既存 rkey が混ざると失敗し、レコードは増えない** — `applyWrites#create` は
  `putRecord` と違い**べき等ではない**。実 PDS では 500 が返り、チャンクは原子的に
  巻き戻る (§5.4 の観測③④)。この非対称が `migrateRemoteRkey` に差分計算を強いている
  根拠なので、契約としてテストに残す。`inMemoryBatches.createMany` も同じ性質にしてある。

## listRemoteFiles — ファイル列挙と削除の検出 (Phase 7 p7-3 / ANA-127 S3)

未知ファイルの発見はまず **fileId の集合**を要求する。本体は未知の分だけ取ればよく、
既知ファイルの履歴を落とさないのが p7-3 の要点である (設計 §3.3)。

ANA-127 でここに **`deleted` (remote 側で削除済みか) を足した**。削除は op-log の
`file.remove` を**最大 clock**で置く tombstone として表現され (`sync/fileDeletion.ts`)、
列挙が着地するのは各ファイルの最大 rkey = 最大 clock のレコードである。したがって
**本体を 1 件も引かずに**削除が分かる — 列挙のリクエスト数は 1 件も増えない。

- **remote に存在する fileId を返す (batch 本体は伴わない)** — 削除が無ければ
  `deleted` はすべて false。
- **着地レコードが tombstone のファイルを `deleted` で返す** — 判定は正典と同じ
  `isFileDeleted` に通す。remote 側だけ別の規則にすると、ローカルで消えているのに
  remote から復活する / その逆が起きる。
- **tombstone より大きい clock の batch が後続すると `deleted` にならない** — 着地点が
  tombstone から外れるため。**これは取りこぼしではなく設計**であり、remove-wins の保証は
  pull 後の検査 (`discoverRemoteFiles` の 2 段目) が担う。ここで false になることを
  明示的に固定しておかないと、後から「1 段目で完全に判定できる」と誤読される。
- **旧 rkey のレコードしか無いファイルは現れない** — 旧 rkey は fileId を持たないので
  列挙できない。移行 (p7-4) が新 rkey で再 push するまで発見経路の外にある。
