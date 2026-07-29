# step1 Phase 6: W3e snapshot 完全退役 — 設計 (初版ドラフト)

> 位置づけ: step1 実装計画 ([step1-implementation.md](./step1-implementation.md) §2) の **Phase 6**。
> R2「移行中の二重モデル併存期間」([architecture/step1.md](../architecture/step1.md) §232) を閉じる。
> 前提: Phase 5 (branch op-log 化) merged (main = `f1226cf`)。
>
> **状態**: 2026-07-28 ユーザー承認済。【要判断】3 件は §3.4 / §3.8 / §6.1 で決着済 (いずれも推奨案を採用)。実装中。

---

## 1. 背景と現状把握

### 1.1 なぜ Phase 6 か

W3d (trunk 読取) / W3d5 (送信) / Phase 4d・4e (受信) / Phase 5 (branch) を経て、
**読取・書込・同期のすべてが op-log を正典として成立している**。しかし旧モデル
(snapshot JSON + PDS の file/sheet/node/edge レコード) は撤去されず並存したままで、
これが R2 が指す「期限を切るべき二重モデル」そのものである。

二重モデルが残ることの実害は Phase 5 で 3 度実証された (設計 §10.2-1 / §10.4 H1 / H2):
**branch の内容が snapshot 経由で trunk へ漏れる穴が、塞いでも別の呼び出し口から再発した**。
根本原因は「同じ状態に対する書込口が 2 つある」ことなので、片方を消すまで再発し続ける。

### 1.2 撤去対象の実態 【コード裏取り済】

#### server

| 箇所 | snapshot 依存 |
|---|---|
| `storage.ts` | `readFile`/`writeFile`/`listFiles`/`deleteFile` = `DATA_DIR/*.json` 本体 |
| `index.ts:101` `POST /files` | 新規ファイルを **snapshot だけ**作る (op-log は初回 GET の lazy migration 任せ) |
| `index.ts:107` `GET /files/:id` | `readFile` |
| `index.ts:113-125` `PUT /files/:id` | `readFile` + `writeFile` (client `persistFile` の宛先) |
| `index.ts:206` `POST /files/import` | `writeFile` |
| `index.ts:67-77` `GET /files` | `listFiles` ∪ `listOplogFiles` (4e-2a の和集合) |
| `index.ts:341` `DELETE /files/:id` | `deleteFile` **のみ** — 🔴 op-log を消していない (§1.3) |
| `migrateFileToOplog.ts:37` | 🔴 **genesis の入力が `readFile` (snapshot)** |

#### client

| 箇所 | snapshot 依存 |
|---|---|
| `useFileSheetOperations.ts:318-347` `persistFile` | `syncFileToAtproto` (PDS legacy) + `saveFile` (`PUT /files`) |
| 同 `:213-226` `loadSnapshot` | `fetchFileFromAtproto` → fallback `fetchFile` (`GET /files/:id`) |
| 同 `:228-` `loadFile` | op-log 優先 + 上記フォールバック (dual-read) |
| 同 `:502` `handleExportFile` | `deps.fetchFile` (未オープン時の書き出し元が snapshot) |
| 同 `:511-525` `loadAtprotoFiles` | `fetchFilesFromAtproto` (PDS legacy の一覧) |
| `useBranchOperations.ts:524` | `syncFileToAtproto` (旧 branch 経路) |
| `config.ts` | `READ_FROM_OPLOG` / `BRANCH_FROM_OPLOG` = 旧経路への退行安全弁 |

#### PDS legacy レコード経路

| モジュール | 状態 |
|---|---|
| `atproto/sync.ts` `syncFileToAtproto` / `syncSheetToAtproto` | **生存** (`persistFile` と `useBranchOperations:524` から呼ばれる) |
| 同 `fetchFilesFromAtproto` / `fetchFileFromAtproto` / `fetchSheetsFromAtproto` | **生存** (`loadAtprotoFiles` / `loadSnapshot`) |
| `atproto/poller.ts` (`startPolling` / `RemoteChange`) | 🔵 **死コード** — production 消費者 0 件 |
| `atproto/cidCache.ts` (`getCid`/`setCid`/`initCidCacheFromPds`) | 🔵 **死コード** — 消費者は `poller.ts` だけ ⚠️ **誤り** (p6-4 で判明): `sync.ts` の書込側も `cacheResult`/`getCreatedAt` を使う (§4.4) |
| `atproto/branchState.ts` | `BRANCH_FROM_OPLOG=false` のときだけ生きる (Phase 5 の安全弁) |

> 🔵 **発見**: ポーリングによるリモート変更検出とコンフリクト通知は、op-log 受信
> (Phase 4d/4e) に置き換わった時点で消費者を失っていた。`RemoteChange` を受け取る
> production コードは存在しない。**Phase 6 の PDS legacy 撤去は、その大半が死コード削除**である。

### 1.3 🔴 併せて塞ぐ既存の穴

`DELETE /files/:id` は snapshot しか消していない (`index.ts:341-345`)。
Phase 4e で **snapshot を持たない op-log-only ファイル** (受信 materialize) が
生まれるようになった時点から、

- op-log-only ファイルは削除できない (`deleteFile` が false → 404)
- snapshot を持つファイルを消しても batches / branches / commits / `file_migrations` が残る

という状態だった。Phase 6 は「snapshot が唯一の削除対象だった」前提を崩すので、
ここで op-log 側の削除に作り替える。

---

## 2. スコープと非目標

### 2.1 目標 — 「op-log が唯一のモデルになる」まで

1. 既存 snapshot を **一括移行**して op-log へ寄せ、lazy migration を役目終了で撤去する
2. 新規作成・インポートを **genesis 直書き**にする (snapshot を経由しない)
3. server から `storage.ts` と snapshot endpoint を撤去する
4. client から snapshot 書込 (`persistFile`) と読取フォールバックを撤去する
5. PDS legacy レコード経路 (死コード + 生存経路) を撤去する
6. 退行安全弁 (`READ_FROM_OPLOG` / `BRANCH_FROM_OPLOG`) を撤去し、`branchState.ts` を退役させる

**完了時の不変条件: アプリケーション状態の永続化先は op-log ただ一つ。**

### 2.2 非目標

- **範囲取得 (R3)** — remote の全件 list を rkey 範囲取得へ。Phase 7。
- **projection cache** — W3d-3 の実測 (典型 ~0.2ms / N=50000 で 5.9ms) で不要と判定済、再検討しない。
- **PDS 上に既に書かれた legacy レコードの削除** — §3.8 で【要判断】として扱う。
- **`.conversensus` ファイル形式 (v1〜v4 マイグレーション)** — これは外部ファイル形式であって
  内部の永続モデルではない。import 経路の入口として残る。

---

## 3. 設計判断

### 3.1 【最大の判断】一括移行の実行主体と契機

snapshot を撤去すると `migrateFileToOplog` は入力を失う。よって
**「未 migration の snapshot を全部 op-log にしてから storage.ts を消す」**順序が要る。

| 案 | 内容 | 評価 |
|---|---|---|
| A | daemon 起動時に自動で全件移行 | ✅ **採用** |
| B | 明示コマンド / endpoint | ユーザーが手順を覚える必要。Phase 8 の Tauri 単一バイナリでは CLI を叩けない |
| C | 初回 `GET /files` で一括 | 読取 hot path に副作用を足す。起動時と実質同じで契機だけ遅い |

**A を採る根拠**: `file_migrations` marker (W3d-1) が既にべき等性の土台であり、
`migrateFileToOplog` をファイルごとに呼ぶだけで済む。移行コードは Phase 6 限りの
存在で、**次リリースで削除できる** (移行済み環境では no-op になる)。

- 起動を止めない: 移行の失敗は 1 ファイル単位で握り、`console.warn` して次へ進む
  (無言にしない — W3d5-7 の「400 が無言」の反省)
- 起動コストはファイル数に比例する。**実測して受入基準に載せる** (W3d-3 の bench と同型)

### 3.2 新規作成・インポートは genesis 直書き

`POST /files` / `POST /files/import` は snapshot を書く代わりに
`graphFileToBatches` (W3b) で genesis batch を作り `appendReceivedBatches` 相当で書く。

- **marker を立てる経路であること** — plain append だと次の `GET /files/:id/batches` が
  lazy migration を起動しうる (4e-2b と同型の事故)。移行撤去後は lazy migration 自体が
  無くなるので実害は消えるが、**撤去前のスライスで先に genesis 直書きを入れると踏む**。
  → スライス順序で回避する (§4: p6-0 一括移行 → p6-1 genesis 直書き + lazy migration 撤去 を同一スライスに)
- これで **lazy migration は「作られた時点で op-log になっている」ため不要**になり、
  `migrateFileToOplog.ts` ごと消える

### 3.3 `GET /files` を op-log 単独へ

`listFiles ∪ listOplogFiles` → `listOplogFiles` のみ。一括移行後は snapshot 由来の
ファイルも op-log に居るので和集合は不要になる。

🔴 **注意 (Phase 5 との結合)**: `listOplogFiles` の「0 シート projection を除外」は
**branch 専用 file_id を一覧から隠す仕組みそのもの** (Phase 5 p5-1)。ここを触るときは
`listOplogFiles.test` の除外テストが依存条件ごと固定されていることを確認する。

### 3.4 `GET /files/:id` と export の扱い 【2026-07-28 ユーザー決定: B (endpoint を消す)】

`GET /files/:id` (snapshot 読取) の生存消費者は client の `handleExportFile:502`
(未オープンのファイルを書き出すとき) と `loadSnapshot:222` (dual-read の最終フォールバック)。
撤去スライスは §4.2 で p6-3 へ移した。選択肢:

| 案 | 内容 |
|---|---|
| A | endpoint を **projection 実装に差し替える** (`projectFile(getBatches(id), id)`) | 
| B | endpoint を消し、export は client が `fetchBatches` → `projectFile` する |

**B を採用** — server に「GraphFile を組み立てて返す」責務を残すと、projection の実装が
client (`projectFile`) と server の 2 箇所に生まれる。server は既に `projectSheet` を持つが
これは EventStore 内部用途で、HTTP 応答の正典を server 側に作ると R2 を別の形で再生産する。
export だけのために client へ projection を足す手間は受容する。

### 3.5 `DELETE /files/:id` を op-log 削除へ (§1.3 の穴を塞ぐ)

`EventStore.deleteFile(fileId)` を新設し、**1 tx** で batches / branches / commits /
`file_migrations` を消す (Phase 5 の `deleteBranch` が同型の先例)。
snapshot 削除は storage.ts 撤去まで併存させ、撤去時に落とす。

### 3.6 client `persistFile` の消滅

`persistFile` は「画面 state 更新 (`setActiveFile` + `setFiles`)」と「snapshot 書込」の二役。
後者を消すと **前者だけが残る** ので、呼び出し側 (`handleAddSheet` /
`handleSaveFileSettings` / `handleSaveSheetSettings` / `handleDeleteSheet` / App の autosave)
は state 更新を直接行う形になる。

✅ **Phase 5 の H2 ガード (`isBranchActive`) はこの撤去で構造ごと消える** — 「branch 表示中に
snapshot へ書かない」というガードは、書込先が消えれば不要になる。Phase 5 の critic 指摘
「呼び出し側ごとのガードは必ず漏れる」に対する最終的な答えがこれである。

### 3.7 安全弁フラグの撤去と `branchState.ts` の退役

`READ_FROM_OPLOG` / `BRANCH_FROM_OPLOG` を削除する
(前者の撤去時期は §4.3 で p6-3 に前倒し)。`BRANCH_FROM_OPLOG` の削除で
`branchState.ts` (PDS レコード複製方式) は消費者を失い退役する
= **Phase 5 の Exit 条件「`branchState.ts` 退役」を完遂する**。

**順序**: 撤去は Phase 6 の最終スライス。実機 e2e で退行が無いことを確認してから落とす
(安全弁を先に外すと、退行が出たときの切り分け手段を失う)。

### 3.8 PDS legacy レコード経路の撤去

| 対象 | 方針 |
|---|---|
| `poller.ts` / `RemoteChange` | 死コード。**削除するだけ** (§1.2 で消費者 0 を確認済) |
| `cidCache.ts` | ⚠️ 消費者は poller だけではなかった (§4.4)。p6-4 では poller 専用の口 (`getCid` / `clearCache` / `setCid` の export) のみ削除し、ファイルは p6-5 まで残る |
| `syncFileToAtproto` / `syncSheetToAtproto` | 呼び出し元 (`persistFile` §3.6 / `useBranchOperations:524`) ごと消える。ただし後者は `BRANCH_FROM_OPLOG=false` の旧 branch 経路にあるため **消えるのは p6-5** (§4.4) |
| `fetchFilesFromAtproto` → `loadAtprotoFiles` | **`discoverRemoteFiles` (4e-2b) と機能重複**。op-log 側へ一本化して削除 |
| `fetchFileFromAtproto` → `loadSnapshot` | dual-read フォールバックごと消える (§3.6, §3.7) |
| `collections.ts` の file/sheet/node/edge/layout | 上記が消えると batch コレクション以外は参照されなくなる |
| lexicon json (file/sheet/node/edge/layout) | 書かなくなる。**ファイル自体を消すかは【要判断】** |
| **PDS 上に既存の legacy レコード** | **放置** 【2026-07-28 ユーザー決定】 |

**放置**: step1 は「既存 PDS データは破棄前提」で進めてきた
(architecture/step1.md の確定事項)。読まなくなったレコードは害を成さず、削除ツールは
Phase 6 限りの使い捨てコードになる。lexicon json も**ファイルは残す** (レコードを書かなく
なるだけで、PDS 上の既存レコードの解釈には引き続き必要)。

---

## 4. 実装スライス分割

| # | 内容 | PDS 依存 |
|---|---|---|
| **p6-0** | 一括移行 (§3.1) — 起動時に未 migration snapshot を全件 genesis 化。失敗は 1 件単位で warn。移行時間を実測 | 無 |
| **p6-1** | genesis 直書き (§3.2) — `POST /files` / `POST /files/import` を op-log へ。**`migrateFileToOplog.ts` と lazy migration 撤去を同一スライスで**行う (§3.2 の順序制約) | 無 |
| **p6-2** | server の一覧・削除 (§3.3, §3.5) — `GET /files` を op-log 単独へ / `EventStore.deleteFile` 1 tx | 無 |
| **p6-3** | client の snapshot 撤去 (§3.6) — `persistFile` 解体・`loadSnapshot` / dual-read 撤去・export の読取元差し替え + `GET`/`PUT /files/:id` と `READ_FROM_OPLOG` の撤去 (§4.2, §4.3) | 無 |
| **p6-4** | PDS legacy の**読取**撤去 (§3.8) — 死コード削除 + `loadAtprotoFiles` の一本化 + `sync.ts` の読取関数削除。書込側は旧 branch 経路が使うので p6-5 へ (§4.4) | 無 |
| **p6-5** | 退役の仕上げ (§3.7) — `storage.ts` 削除・安全弁フラグ削除・`branchState.ts` 削除 + それで消費者を失う `sync.ts` / `cidCache.ts` の削除 (§4.4) | 無 |
| **p6-6** | 実機 e2e — 単一端末 + PDS ありの 2 端末 (op-log 経路のみで cross-device が成立することの確認) | **有** |

p6-0〜p6-5 は PDS 非依存 (Phase 5 と同じ型)。p6-6 だけ PDS docker を起動する。

### 4.1 【実装中に判明】snapshot 書込は「消費者を消してから」落とす

p6-1 を「`POST /files` を genesis **専業**にする」と読んで実装したところ、`GET`/`PUT`/
`DELETE /files/:id` が snapshot を前提にしているため**新規作成ファイルが取得も更新も削除も
できなくなった** (すべて 404)。とくに `DELETE` が効かない = ユーザーがファイルを消せない、
`PUT` が 404 = client の autosave が黙って失敗する。

スライスは 1 本ごとに動く状態で積む方針なので、**snapshot の書込は p6-1 では残す**。
撤去の順序を「消費者 (読取・更新・削除) を先に消し、書込は最後」に改める:

| 順序 | やること |
|---|---|
| p6-1 | genesis 直書きを**追加** + lazy migration 撤去 (snapshot 書込は残す) |
| p6-2 | `GET /files` を op-log 単独へ / `DELETE` を op-log 削除へ (server 内で閉じる) |
| p6-3 | client の snapshot 読み書き撤去 → 消費者を失った `GET`/`PUT /files/:id` も撤去 |
| p6-5 | 消費者ゼロになった snapshot 書込と `storage.ts` を削除 |

### 4.2 【実装中に判明】`GET /files/:id` 撤去は p6-2 ではなく p6-3

§4.1 の表は `GET /files/:id` の撤去を p6-2 に置いていたが、この endpoint は
**§3.7 / §6.1 が前提にしている安全弁の最終到達点**である: `READ_FROM_OPLOG=false` の
とき client の読取は `loadSnapshot` → `fetchFileFromAtproto` → **`fetchFile` (`GET /files/:id`)**
と落ちる。p6-2 で消すと、ATProto 未ログイン環境では安全弁を倒しても何も開けなくなり、
「退行が出たときの切り分け手段」が p6-6 の実機 e2e より前に失われる。

そこで **p6-2 は server 内で閉じる変更に限り** (一覧の op-log 単独化 + 削除の op-log 化)、
`GET /files/:id` の撤去は**消費者 (`handleExportFile` / `loadSnapshot`) を消す p6-3 と
同一スライス**へ移す。§3.4 の決定 (B 案 = endpoint を消して export は client の projection へ)
は変えない。終状態は同じで、消す順序だけを「消費者と endpoint を同時に」へ揃える。

### 4.3 【実装中に判明】`READ_FROM_OPLOG` は p6-5 まで持たない

§3.7 は安全弁フラグの撤去を最終スライス (p6-5) に置いていたが、`READ_FROM_OPLOG` は
p6-3 で役目を終える。**退避先の snapshot を維持しているのは `persistFile` (client の
書込) であり、それを消した瞬間に snapshot は古くなる**ため。古い内容を見せる安全弁は
安全ではない — 「op-log が読めない」より「1 世代前の内容が正常に見える」方が悪い。

したがって p6-3 で `loadSnapshot` / dual-read フォールバックと同時に `READ_FROM_OPLOG` を
落とす。`BRANCH_FROM_OPLOG` は branch 側の独立した経路 (`branchState.ts` + PDS) の
スイッチなので §3.7 のとおり p6-5 まで残る。

**この間 snapshot は「書かれるが読まれる箇所が減っていく」状態**になるが、§6.1 で退けた
「1 リリース分の猶予」とは別物である — 猶予はリリースを跨いで二重モデルを残す話で、
こちらは Phase 6 内で閉じる撤去順序の問題。p6-5 の完了時点で二重モデルは消える。

### 4.4 【実装中に判明】p6-4 で消せるのは「読取側」まで — 書込側は p6-5

§3.8 は PDS legacy 撤去を「その大半が死コード削除」と見積もっていたが、実コードを
当たると 2 点ずれていた:

| §1.2 / §3.8 の記述 | 実際 |
|---|---|
| `cidCache.ts` の消費者は `poller.ts` だけ | `sync.ts` の**書込側**が `cacheResult` / `getCreatedAt` を使っている (同じデータを再 sync しても `createdAt` が動かない = CID が変わらないことの保証) |
| `syncFileToAtproto` は呼び出し元ごと消える | 最後の呼び出し元 `useBranchOperations:524` は `BRANCH_FROM_OPLOG=false` の旧 branch 経路にあり、このフラグの撤去は §3.7 で **p6-5 (実機 e2e 後)** と決めている |

**判断**: §3.7 の順序 (「安全弁は実機 e2e で退行が無いことを確認してから落とす」) を優先し、
p6-4 は**消費者が本当にゼロのものだけ**を落とす。`READ_FROM_OPLOG` を前倒しした §4.3 とは
逆の結論になるが、理由は一貫している — **安全弁が生きているかどうか**である。
`READ_FROM_OPLOG` は退避先 (snapshot) の更新が止まった時点で「1 世代前を正常に見せる」
危険物になったので前倒しで消した。`BRANCH_FROM_OPLOG` の旧 branch 経路は PDS レコードを
**自分で書いて自分で読む**閉じた経路 (`syncFileToAtproto(activeFile)` は server snapshot を
参照しない) なので、p6-3 の撤去による陳腐化を受けていない = 安全弁として今も成立している。

p6-4 の実際の範囲:

| 落としたもの | 残したもの (p6-5 送り) |
|---|---|
| `poller.ts` 全体 / `RemoteChange` 型 | `cidCache.ts` (`cacheResult` / `getCreatedAt` のみ) |
| `sync.ts` の読取半分 (`fetchSheetsFromAtproto` / `fetchFilesFromAtproto` / `fetchFileFromAtproto`) | `sync.ts` の書込半分 (`syncFileToAtproto` / `syncSheetToAtproto`) |
| `mapper.ts` の `recordToSheetMeta` / `recordToFileMeta` (読取専用で消費者 0 に) | `fileToRecord` / `sheetToRecord` など書込側 mapper |
| `loadAtprotoFiles` と App の呼び出し effect、`FileSheetOpsDeps.fetchFilesFromAtproto` | `atprotoFilesDelete` (legacy file レコードの後始末) |

**結果として「PDS legacy レコードを読む経路」は p6-4 で完全に消えた** — リモートからの
取り込みは op-log (batch コレクション) 単独になった。残る legacy は書込のみで、
その唯一の消費者は旧 branch 経路である。

---

## 5. 受入基準

1. **一括移行**: 未 migration の snapshot を持つ `DATA_DIR` で daemon を起動すると、
   全ファイルが op-log 化され、`GET /files` に全件が現れる。2 回目の起動は no-op
   (batch が増えない)。移行時間を実測し記録する
2. **snapshot が存在しない**: 新規作成・インポート・編集のいずれを行っても
   `DATA_DIR` に `*.json` が**生成されない**
3. **削除**: op-log-only ファイル (受信 materialize) を含め、削除するとファイル一覧から消え、
   batches / branches / commits が残らない
4. **export**: 開いていないファイルを書き出しても内容が正しい (projection 由来)
5. **PDS に legacy レコードが書かれない**: 編集・branch 操作の後、PDS に新しく作られるのは
   `app.conversensus.graph.batch` のみ (検査スクリプトで判定)
6. **cross-device (p6-6)**: op-log 経路だけで device A の編集が device B に届く。
   🔴 **legacy snapshot 経路が肩代わりしていないこと**を確認する
   (W3d5 critic A2「画面に見えるのは op-log が届いた証拠にならない」の再発防止)
7. lint / typecheck / test すべて green

---

## 6. リスクと未解決点

### 6.1 【High】移行の不可逆性

`storage.ts` を消した後に op-log 側の欠陥が見つかっても snapshot へは戻れない。
安全弁 (`READ_FROM_OPLOG`) も同時に消える。

**緩和**: p6-5 (削除) を最終スライスに置き、p6-6 の実機 e2e を **p6-5 の前に**通す。
つまり「snapshot が生成されない状態で全機能が動く」ことを確認してから物理削除する。

**猶予期間は置かない** 【2026-07-28 ユーザー決定】 — 「書くが読まない」は R2 の二重モデル
そのもので、Phase 5 で実害が出た構造と同じ。p6-6 の実機 e2e を通してから p6-5 で一気に落とす。

### 6.2 【Medium】起動時一括移行のコスト

ファイル数 × snapshot サイズに比例する。実測前に受入基準を決めない (§5-1 で実測を要求)。
実測が許容外なら B 案 (明示コマンド) へ切り替える判断点を p6-0 に置く。

### 6.3 【Medium】`handleImportFile` の応答契約

`POST /files/import` は現在 `GraphFile` を返し client がそれを `setActiveFile` する。
genesis 直書きにしても**同じ `GraphFile` を返せる** (書いた元データがそれ) ので契約は変わらない。
ただし「返した GraphFile」と「op-log を projection した GraphFile」が一致する保証は
`graphFileToBatches` の往復性に依る — W3b で canonicalization 済だが、
**import 特有の ID 再生成 (`index.ts:167-205`) を通した後の往復**はテストが無い。p6-1 で固定する。

### 6.4 【Low】Phase 5 の branch は影響を受けない

branch は local op-log 専業 (Phase 5 §9.2 の不変条件) なので、PDS legacy 撤去の影響を受けない。
影響があるのは `useBranchOperations:524` の `syncFileToAtproto` (旧経路) だけで、
これは `branchState.ts` と一緒に退役する。

---

## 7. 前フェーズ教訓との突き合わせ

| 教訓 | 出典 | Phase 6 での適用 |
|---|---|---|
| 呼び出し側ごとのガードは必ず漏れる | Phase 5 §10.4 H2 | §3.6 — 書込先を消すことでガードごと不要にする |
| 無言の失敗を作らない | W3d5-7 / Phase 5 M3 | §3.1 — 移行失敗は warn、§5-5 は検査スクリプトで判定 |
| 画面は証拠にならない | W3d5 critic A2 | §5-6 — cross-device は PDS レコード検査で判定する |
| 設計の対策は既存仕様と突き合わせる | [[feedback_design_vs_existing_spec]] | §3.3 (0 シート除外が p5-1 の前提)、§6.3 (import の往復性) を先に洗い出した |
| 二重モデルは実害を出す | Phase 5 §10.2-1 / §10.4 | §6.1 — 猶予期間を置かない判断の根拠 |

---

## References (実コード裏取り, main = `f1226cf`)

- `src/server/src/storage.ts` — snapshot 本体 (`readFile`:33 / `writeFile`:39 / `listFiles`:19 / `deleteFile`:43)
- `src/server/src/index.ts` — `GET /files`:67 / `POST /files`:80 / `GET /files/:id`:106 / `PUT /files/:id`:113 / `POST /files/import`:128 / `DELETE /files/:id`:341
- `src/server/src/migrateFileToOplog.ts:37` — genesis 入力が `readFile`
- `src/server/src/eventStore.ts` — `listOplogFiles` (0 シート除外) / `appendReceivedBatches` / `deleteBranch` (1 tx の先例)
- `src/client/src/hooks/useFileSheetOperations.ts` — `loadSnapshot`:213 / `persistFile`:318 / `handleExportFile`:498 / `loadAtprotoFiles`:511 / discovery effect:537
- `src/client/src/atproto/sync.ts` — legacy: `syncSheetToAtproto`:59 / `syncFileToAtproto`:168 / `fetchSheetsFromAtproto`:188 / `fetchFilesFromAtproto`:270 / `fetchFileFromAtproto`:281
- `src/client/src/atproto/poller.ts` / `cidCache.ts` — 消費者 0 の死コード
- `src/client/src/config.ts` — `READ_FROM_OPLOG` / `SYNC_TO_REMOTE` / `BRANCH_FROM_OPLOG`
- `src/client/src/sync/discoverRemoteFiles.ts` — `loadAtprotoFiles` の後継
