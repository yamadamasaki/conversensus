# atprotoSyncProvider テスト仕様

## 何を

`AtprotoSyncProvider` (step1 Phase 4c、ATProto を裏に隠す `SyncProvider` 実装) を
テストする。`pushRemote` / `pullRemoteForFile` / `listRemoteFiles` が op-log コレクション
(v2: `app.conversensus.v2.batch`) への読み書きに正しく翻訳されることを、
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
5. **読む repo を選べる** (step2 Phase 2 S2): `pullRemoteForFile(fileId, repo)` の `repo` が
   コレクションまで届くこと。**書き込み側に `repo` が無いのと対になっている** — ATProto の
   credential は自分の repo のものしか無いので、「他者の repo は読めるが書けない」という
   非対称をそのまま型の形に出している。省略時が自分の repo になること (step1 の挙動) も
   同時に固定する。

## どのように

- 依存を注入する: `inMemoryBatches` (collections.batches と同形の in-memory 実装、
  `_seed` で他ユーザーの追記を模擬、`_scanned()` で走査件数を公開)。
- **push**: batch を `<fileId>~<actor>~<seq>` の rkey で書く (step3 Phase 1 D9) /
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

## 既読位置を持たない取得 (Phase 4d-4)

`pull(since)` を cursor の無い取得へ置き換えた。**cursor を取らず、常に全件返す。**
(全件取得の口 `pullAllRemoteForMigration` は step1 の rkey 移行専用として残っていたが、
step3 Phase 1 で移行ごと撤去した。今の取得はファイル単位の `pullRemoteForFile` だけである。
既読位置を持たない契約はそちらに引き継がれている。)

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
取得はファイル単位の範囲取得へ移った (下の p7-2 節)。S0-3 の実測で、この「毎回全件」が
参加者数 × 履歴に比例する同期費用の源であることが分かっている。actor ごとの cursor は
vector clock の上でしか正しく持てないので、step3 Phase 1 で rkey の形だけ先に整えた。

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

## rkey スキーム (v2, step3 Phase 1 D9)

書込の rkey は `<fileId>~<actor>~<seq>` である (組み立て・分解は `batchRkey.ts`、性質のテストは
`batchRkey.test.md`)。**ファイル単位の範囲取得は rkey の辞書順だけで成立する**ので、この層では
「書いた rkey そのもの」を `_rkeys()` で直接 assert する — 件数だけを見ると「rkey は違うが
件数は同じ」を見逃し、範囲取得が静かに壊れる。

v1 (`v1~<fileId>~<clock>~<batchId>`) では `batch.id` が rkey にしか無く、rkey からの復元が
べき等 dedup の要だった。v2 では **id をレコードの本文に持つ**ので、rkey から何かを復元する
経路は無くなった (復元の検査は `batchMapper.test.md` が本文の側で見る)。

- `_seed` — v2 の rkey で仕込む。既定の経路
- `_seedRkey` — 任意の rkey (prefix 境界の検証用)

## pullRemoteForFile — ファイル単位の範囲取得 (Phase 7 p7-2)

全件取得の隣に `pullRemoteForFile(fileId)` が入った。取得量が
**repo 全体ではなくそのファイルの履歴に比例する**ことがこのスライスの目的である。

**なぜ結果だけでは足りないか**: 全件読んでから JS で捨てても結果は同じになるので、
結果を見るテストは目的の達成を判定できない。そのため `inMemoryBatches` は
`listByFile` を**実 PDS と同じ手順**で実装し (rkey 昇順に並べ、合成 cursor `<fileId>`
より大きいところから読み、prefix を外れた 1 件で停止)、**走査したレコード件数**を
`_scanned()` で公開する。走査の論理そのものは `rangeFetch.test.md` が別に固定する。

- **隣接 fileId を含めない** — `FILE` より小さい / 大きい fileId のレコードを両側に置き、
  返るのが対象ファイルの分だけであること。fileId は UUID 固定長なので、ある fileId が
  別の fileId の prefix になることはない (設計 §3.2)。
- **走査が repo 全体に比例しない** — 他ファイル 10 件 + 自分 1 件で `_scanned()` が **2**
  (自分 1 件 + 境界の 1 件)。読み過ぎ 1 件は境界検出のための正常動作 (§3.2)。
- **既読位置を持たない** — 2 回呼んで同じ全履歴が返ること。絞ったのは
  「repo 全体 → 1 ファイル」の軸だけで、「全履歴 → 差分」の軸は絞っていない (§2.2)。
- **整列は clock → actor → id** — 範囲取得は rkey 昇順で返るが、rkey の clock は発番端末の
  ものなので順序の権威にできない。全件版と同じ規則で並べ替えること。
- **fileId をエンベロープで返す** — 返すのが `Batch` ではなく `RemoteBatch` であること。
  collection は repo 全体で 1 つなので、レコード自身の fileId でしか受信側は適用先を
  復元できない (§3.1)。
- **counted skip** — 壊れた / 他種 / fileId 無しレコードを飛ばすこと (件数の warn は §3.1)。
- **合成 cursor が prefix の直前を指す** — `batchRkeyFileCursor(f) < batchRkeyPrefix(f)` と
  前方一致関係を直接 assert する。この関係が崩れると**そのファイルの最初の 1 件だけ**が
  静かに落ちる (最も見つけにくい壊れ方) ので、性質として固定する。

## listRemoteFiles — ファイル列挙と削除の検出 (Phase 7 p7-3 / ANA-127 S3)

未知ファイルの発見はまず **fileId の集合**を要求する。本体は未知の分だけ取ればよく、
既知ファイルの履歴を落とさないのが p7-3 の要点である (設計 §3.3)。

ANA-127 でここに **`deleted` (remote 側で削除済みか) を足した**。削除は op-log の
`file.remove` を置く tombstone として表現され (`sync/fileDeletion.ts`)、列挙が着地するのは
各ファイルの最大 rkey のレコードである。v1 では rkey が clock 順だったので着地点が
tombstone になり、**本体を 1 件も引かずに**削除が分かった。**v2 の rkey は actor → seq 順**
なので、着地点は「辞書順で最後の actor の最大 seq」であり、tombstone とは限らない。
この近道が効くのは、tombstone を書いた actor が最後の actor である場合だけになった。
正しさは pull 後の検査 (`discoverRemoteFiles` の 2 段目) が持つ。ここのテストは 1 人の
actor で書いているので、着地点は常にその actor の最大 seq = tombstone である。

- **remote に存在する fileId を返す (batch 本体は伴わない)** — 削除が無ければ
  `deleted` はすべて false。
- **着地レコードが tombstone のファイルを `deleted` で返す** — 判定は正典と同じ
  `isFileDeleted` に通す。remote 側だけ別の規則にすると、ローカルで消えているのに
  remote から復活する / その逆が起きる。
- **tombstone より大きい clock の batch が後続すると `deleted` にならない** — 着地点が
  tombstone から外れるため。**これは取りこぼしではなく設計**であり、remove-wins の保証は
  pull 後の検査 (`discoverRemoteFiles` の 2 段目) が担う。ここで false になることを
  明示的に固定しておかないと、後から「1 段目で完全に判定できる」と誤読される。

### blob の先出し (ANA-116 S5)

blob を上げる前に blob ref を含むレコードを書こうとすると, PDS は
`Could not find blob: <cid>` で**拒否する** (S1 で実測)。壊れたレコードができるより
安全だが, 順序を間違えるとその batch は再送し続けて outbox に詰まる。**順序が保証
そのもの**なので, 呼ばれた回数ではなく upload と書込を同じ列に記録して並びを見る。

- **`pushRemote` は各 batch のレコードを書く前にその batch の blob を上げる** —
  `upload:1 → put:1 → upload:1 → put:2` の並びで固定する。**batch ごとに交互**なのは
  失敗境界を batch 単位にしたため (レビュー D2)。同じ blob の往復が増えないのは
  `createPdsBlobUploader` が上げ済みの cid をセッション内で覚えているためである
- **upload が失敗したらレコードを 1 件も書かない** — 「blob が無いまま参照だけ載った
  レコード」を作らない。失敗した batch はキューに残り (`RemoteSyncQueue` の契約),
  再送で回復する

`uploadBlobs` を**必須の依存**にしてあるのは, 省略できると配線を忘れた瞬間に
「画像を含む batch だけが静かに詰まる」形で壊れるためである。blob を扱わない検証は
`makeProvider` が no-op を渡す。

### 失敗の境界 (ANA-116 レビュー D2)

以前は 1 件の失敗で `pushRemote` が throw し, `Outbox` が**保留を全件維持**していた。
解決できない画像を含む batch 1 つで, **無関係なファイルの batch まで一緒に再送され続ける**
状態になっていた。失敗を 2 種類に分けて境界を作る。

- **上げられない blob を参照する batch は飛ばし, 他の batch は送る** — `unavailable` を
  返す uploader で 2 件目だけを送れない状況を作り, `PartialPushError.sentIds` が
  `['1','3']` になり remote には 1 と 3 だけが書かれることを見る
- **飛ばした batch は PDS を叩かない** — 送れないと**事前に**分かるので, 無駄な
  リクエストを出さない。`put` の呼び出し回数 0 で固定する
- **レコード書込が失敗したら残りを試さず打ち切る** — オフライン中は編集ごとに flush が
  走るので, 全件試すと失敗リクエストが保留件数の二乗で増える。3 件渡して `put` の試行が
  1 回だけであることを見る
- **途中まで送れていればその分だけを送信済みとして返す** — 2 件目で落ちる `put` で
  `sentIds` が `['1']` になること。ここが崩れると送信済みの batch を再送し続ける

remote に隙間ができることは受け入れる。projection は対象を欠く op を落とす
(`project.ts` の `if (node)`) ので壊れず, catch-up が後で埋める。

## 部品の id は UUID にする (security review M1 の後)

受信は PDS から入る batch を 1 件ずつ本物と同じ形 (`ReceivedBatchSchema`) で検証し、合わないものを落とす
(`isAcceptableRemoteBatch`)。そのため部品の batch の id と node は UUID でなければならない。読める名前 (`a`, `mine` …) から
UUID を作り (`uuidOf`)、確かめるときに名前へ戻す (`labelOf`) ので、各件の読み方は変わらない。
