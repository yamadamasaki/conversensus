# step1 Phase 5: branch subsystem の op-log 化 — 設計 (初版ドラフト)

> ステータス: **初版起案** / 起案日: 2026-07-24 / 起案: architect (read-only, 実コード裏取り込み) / 再分類: 2026-07-27 (旧「step2」→ step1 Phase 5)
> 位置づけ: step1 (操作ログ正典化・ローカルファースト) Phase 4 完了・main マージ済の次段。**本 Phase は元 Phase 2 (ブランチ載せ替え) の実配線が Phase 2/3/4 を通じて滑った残タスクを step1 内で回収するもの**であり、当初「step2」として別 step に切り出していたものを step1 Phase 5 に戻した (経緯は `step1-implementation.md` §2 の注記参照)。本来の step2 は拡張エンジン (`../architecture/step1.md` §8) で、step1 リリース後に着手する。
> branch/commit/merge subsystem を現行 snapshot/PDS 直叩きモデルから op-log 分岐モデルへ載せ替える。W3e (snapshot 完全退役) の前提条件を作る。
> 本書の事実主張は `【コード裏取り済】` と `【要判断】`/`【推測】` を明示的に区別する。**設計判断は選択肢を列挙し推奨を付すが、最終決定はユーザーが行う。**

---

## 1. 背景と現状把握

### 1.1 なぜ step1 Phase 5 か 【コード裏取り済】

W3e (snapshot 退役 = `PUT /files`・`storage.ts`・snapshot 読込の撤去) の前提は「branch の op-log 化」。現行 branch は snapshot 複製に依存しているため、先にここを op-log 化しないと snapshot を撤去できない。

- 現行 trunk の読取は既に op-log 正典 (`READ_FROM_OPLOG` 既定 true)。だが **branch は op-log 経路に一切乗っていない** — `branchState.ts` は PDS レコード複製 (`trunk_`/`{branchId}_` prefix の node/edge レコード) のまま。
- `branchState.ts` 冒頭に `@deprecated step1 Phase 2 で置換予定` と明記され、置換先 (`events/branchLog.ts` / `events/merge.ts`) も指定済 (`branchState.ts:1-11`)。

### 1.2 現行モデル (置換対象) の実態 【コード裏取り済】

| 現行シンボル | 何をしているか | 出典 |
|---|---|---|
| `computeOperations(base, current)` | 2 つの `Sheet` snapshot の差分を `CommitOperation[]` として計算。**layout は含めない** | `branchState.ts:116-202` |
| `createBranch` | trunk の node/edge/layout レコードを `{branchId}_` prefix で **全複製** (2-phase, parentId 解決付き) | `branchState.ts:417-528` |
| `createCommit` | `CommitRecord` を PDS に書く (operations + parentCommit チェーン) | `branchState.ts:947-981` |
| `fetchBranchSheetFromPds` | branch prefix レコードを PDS から読んで `Sheet` を組む | `branchState.ts:543-602` |
| `syncBranchSheetToAtproto` | `Sheet` を branch prefix レコードとして PDS に書く (auto-save)。削除レコードの cleanup 付き | `branchState.ts:605-701` |
| `mergeBranchToTrunk` | branch prefix レコードを trunk prefix に書き替え、削除も伝播 | `branchState.ts:743-892` |
| `createMergeRecord` / `updateBranchStatus` / `deleteBranchWithRecords` / `fetchBranchesForSheet` / `fetchCommitsForBranch` | branch/commit/merge メタの PDS I/O | `branchState.ts:221-290, 894-944` |

UI 配線 (`useBranchOperations.ts`) の state は **snapshot ベース**:
- `branchOriginalBase` / `lastCommitBase` = `Sheet` snapshot を保持 (`useBranchOperations.ts:105-110`)。
- pending ops = `computeOperations(lastCommitBase, activeSheet)` の diff (`useBranchOperations.ts:183-193`)。
- diff 表示用の `addedNodeIds` 等も `computeOperations(branchOriginalBase, activeSheet)` (`useBranchOperations.ts:133-181`)。
- branch は **per-sheet** (`Branch.sheetId`, `branchState.ts:88-98`)。branch 選択時に `fetchBranchSheetFromPds` → `activeFile.sheets` の該当 sheet を差し替え (`useBranchOperations.ts:245-290`)。

### 1.3 目標モデル (定義済・未配線) の実態 【コード裏取り済】

- `shared/events/branchLog.ts` (純ドメイン):
  - `Commit = {id, message, at: Lamport, authorActor}` — **ログ上のラベル付きオフセット**。`makeCommit` が `tipClock(batches)` で現在先端を捕える (`branchLog.ts:26-56`)。
  - `Branch = {id, name, base: Commit, status}` — **sheetId を持たない** (現行 `Branch` との差異)。`branchLog.ts:36-41`。
  - `branchSheet(branch, trunkBatches, branchBatches, meta)` = `batchesUpTo(trunkBatches, base)` に `branchBatches` を重ねて `projectBatches` → `toSheet` (`branchLog.ts:67-75`)。
  - `batchesUpTo` = `batches.filter(b => b.clock <= commit.at)` (`branchLog.ts:59-61`)。
- `shared/events/merge.ts` (純ドメイン):
  - `mergeBranches(trunkAfterBase, branchBatches)` = 両者を素朴連結し projection の clock 順畳み込みに解決を委ね、**content の並行変更だけを `MergeConflict` として検出** (`merge.ts:68-91`)。
  - layout/structure は追記のみ (projection に委ねる)。content は LWW + 対立検出。`merge.ts:1-14`。
- `EventStore` は **commit オフセットの永続化先を既に持つ** — `commits` テーブル + `saveCommit`/`getCommits` (file_id 単位, `eventStore.ts:69-76, 219-233, 327-338`)。**branch メタの永続化先は無い** (未定義)。
- `spikes/o3/branchAsLog.ts` は投棄前提 PoC。merge の CRDT 意味論 (structure=OR-Set add-wins / content=LWW+conflict / layout=静かな LWW) と複合イベント分解 (`decomposeGroup`/`decomposePaste`) の**意味論の参照**に使う (`branchAsLog.ts:1-14, 139-265`)。

### 1.4 step1 の Phase 1〜4 で確立し Phase 5 が再利用できる基盤 【コード裏取り済】

- op-log は **file_id 単位**で仕切られる (`EventStore` の全メソッドが `fileId` 引数, `eventStore.ts:122-338`)。batch = `{id, actor, clock, timestamp, sheetId?, ops[]}` (`unified.ts:232-242`)。
- projection: `projectBatches` / `projectFile` / `orderBatches` (全順序 tiebreak = `clock → actor → id`, `project.ts:53-72, 295-328`)。
- remote batch レコード `BatchRecord = {fileId, actor, clock, timestamp, ops, sheetId?, createdAt}` — **fileId をレコードに埋め込む** (remote の batch コレクションは repo 全体で 1 つ, `batchMapper.ts:8-31`)。**branchId 等のフィールドは無い**。
- server API は **file_id をパスパラメータで受ける** — `POST /files/:id/batches`, `/batches/received`, `GET /files/:id/batches` (`index.ts:212-276`)。batches テーブルに FK は無い (`eventStore.ts:55-65`)。
- 受信・発見: `receiveRemoteBatches` (開いている 1 file, `receiveRemoteBatches.ts:52-78`)、`discoverRemoteFiles` (未知 file_id を materialize, `discoverRemoteFiles.ts:52-82`)、`GET /files` は snapshot storage と op-log の和集合 (`index.ts:63-74`, `EventStore.listOplogFiles` は **0 シートの file_id を除外**, `eventStore.ts:197-217`)。
- genesis は content-addressed で remote へ push (Phase 4e, `remoteFilter.ts:11-16, 32-43`)。

---

## 2. スコープと非目標

### 2.1 目標 — 「branch/commit/merge が op-log 上で成立し、snapshot 複製依存が切れる」まで

- branch = base offset + branch batches、commit = ラベル付きオフセット、merge = branch batches の trunk 追記、という branchLog/merge のドメインを **実際に配線する**。
- `createBranch` のレコード全複製、`fetchBranchSheetFromPds`/`syncBranchSheetToAtproto` の PDS 直叩き、`mergeBranchToTrunk` のレコード書き替えを **op-log 経路へ退役させる**。
- branch/commit/merge が remote (複数端末) 経由で伝播する。
- 非破壊・dual-write・フラグ付き段階移行 (`READ_FROM_OPLOG` と同型の branch フラグ)。

### 2.2 非目標 (後続 / W3e へ) 【要判断: 境界はユーザー確認】

- **trunk snapshot の完全退役 (W3e)** — `PUT /files`・`storage.ts`・snapshot genesis fallback の撤去は W3e に残す。step1 Phase 5 は **branch 固有の snapshot 依存** (branch prefix レコード複製) のみ切る。
- **content 対立の可視化 UX** — `merge.ts` は `MergeConflict` を**検出・返却**するところまでを step1 Phase 5 とし、グラフ上の対立提示 UX は後続 (Phase 4e §2 の非目標線を踏襲)。
- **structure の add-wins OR-Set 厳密化** — 現 projection は structure も clock-LWW (`project.ts:74-125`、node.remove はカスケード削除)。o3 Phase1 課題 #2 は未解決のまま持ち越す。step1 Phase 5 は「決定論的に収束する」ことのみ要求。
- **並行 branch の vector clock 判定** — Phase 4d/4e の方針 (scalar Lamport + 決定論収束) を踏襲。
- **既存 PDS branch データの移行** — o3 は破棄前提 (§7)。step1 Phase 5 でも破棄を既定とする (§6 で扱う)。

---

## 3. 設計判断

### 3.1 【最大の判断】branch batches の格納先

trunk と同じ op-log に無条件で混ぜると `projectFile`/`projectBatches` が branch 編集も畳んでしまい **trunk projection が汚れる** (`project.ts:295-328` は file_id の全 batch を畳む)。分離方式を選ぶ。

| 選択肢 | 仕組み | 要変更 | Pros | Cons |
|---|---|---|---|---|
| **A: 同一 file_id + `branchId` 列** | batches テーブルに `branch_id` 列を足し、trunk = `branch_id IS NULL`。projection は「trunk のみ」「branch のみ (base まで trunk + branch)」で getter を分ける | batches スキーマ ALTER (sheet_id 追加と同型, `eventStore.ts:108-115`)、`getBatches` に branch フィルタ variant、`BatchRecord` に `branchId?` 追加 (`batchMapper.ts`)、projection 呼出側の routing | 1 file_id = 1 論理ファイル(trunk+branch群) の心的モデルを保つ。remote は 1 コレクション・`discoverRemoteFiles` は file_id keyed で無影響。branch↔trunk の紐付けが file_id 共有で自明 | **直近リリースの hot path (batches テーブル・`getBatches`・remote record) に触る**。trunk projection に「branch を混ぜない」フィルタ責務が新規に生じ、抜けると退行 |
| **B: branch 専用 file_id** | branch batches を独立 file_id の op-log に置く。branchSheet = trunk file_id の base まで + branch file_id の全 batch を連結して `projectBatches` | ほぼゼロ (server endpoint・remote `BatchRecord.fileId`・`EventStore` file_id 仕切り・`appendReceivedBatches` を素通しで再利用)。branch↔trunk 紐付けの**メタ**(§3.2) と、branch file_id を Sidebar/discover に出さない**除外**が要る | **trunk projection・読取経路に一切触らない** (Phase 4 の成果物を無傷に保つ)。branch batch の remote 同期は既存 batch 同期で自動的に成立 | file_id が増える。`discoverRemoteFiles`/`listOplogFiles` が branch file_id を通常ファイルとして materialize・一覧化してしまう (`discoverRemoteFiles.ts:64-72`, `eventStore.ts:197-217`) → **branch 判別マーカーによる除外が必須** |
| C: remote 専用 branch batch コレクション | branch batch を別 NSID コレクションに分離 | lexicon 追加・mapper 追加・受信経路の二重化・GC | remote 上で構造的に分離 | 実装コスト最大。step1 の「batch コレクションは 1 つ」設計 (`batchMapper.ts:8-11`) を崩す |

**推奨: B (branch 専用 file_id)。根拠:**
1. **非破壊原則との整合が最も高い** — Phase 4 で安定化したばかりの trunk 読取経路 (`projectFile`/`getBatches`/remote record) に一切変更を入れない。A は batches テーブルと `getBatches` という最もクリティカルな箇所を変える。
2. **remote 同期がタダで付く** — `BatchRecord.fileId` が既に運搬子。branch batch は「別 file_id の batch」として既存の push/pull/dedup/marker 経路にそのまま乗る。
3. branchLog の `branchSheet(branch, trunkBatches, branchBatches, ...)` が **既に trunk と branch を別リストで受ける** 設計 (`branchLog.ts:67-75`)。B はこの境界に自然に一致する。

**B を採る場合に必ず設計すべき対策 (Cons への手当て):**
- **branch file_id の除外**: `discoverRemoteFiles` と `listOplogFiles`/`GET /files` が branch file_id を通常ファイルとして扱わないよう、**branch メタ (§3.2) を引いて除外**する。除外キーは「branch メタに登録された file_id か」。**この除外を入れ忘れると Sidebar に branch が裸で並ぶ** — 受入基準で明示的に検査する (§5)。
- **命名規約の是非** 【要判断】: branch file_id を `trunkFileId` から導出可能な決定論 id (例: `deterministicUuid(trunkFileId + branchId)`) にするか、無関係な UUID にしてメタで紐付けるか。前者は端末間で branch file_id が一致し dedup に有利、後者はメタ必須だが疎結合。**推奨は前者** (genesis と同じ content-addressed 思想、`genesis.ts:47-75`)。

> **【要判断】A vs B は projection の「汚れ」をどこで防ぐかの選択**。A は「1 テーブルに混在させ getter で分離」、B は「file_id で物理分離」。B を推奨するが、将来 branch 間の cross-branch クエリ (例: 全 branch の一覧を 1 クエリで) が要件化すると A が有利になる。現要件にその兆候は無い。

### 3.2 branch / commit メタの永続化先

- **commit オフセット**: `commits` テーブルの**型は再利用できる** (`eventStore.ts:219-233`)。`Commit = {id, message, at, authorActor}` は `branchLog.Commit` と同型。**ただし `saveCommit`/`getCommits` は定義のみで caller 0 件・HTTP endpoint も無い** (critic M1)。→ **p5-0 で `GET/POST /files/:id/commits` の endpoint と caller を新規に配線する必要がある**。加えて commit は現状 remote 同期経路も無い → remote へ載せる経路も新規 (§3.5)。
- **branch メタ** (`{id, name, base: Commit, status}` + 紐付ける trunkFileId / branchFileId / sheetId): **永続化先が無い**。選択肢:

| 選択肢 | Pros | Cons |
|---|---|---|
| B-1: `EventStore` に `branches` テーブル新設 (commits と同型) | commit と対称。server API `GET/POST /files/:id/branches` を素直に足せる | 新テーブル・新 API |
| B-2: branch メタ自体を **op-log の file 構造 op** として表現 (`branch.create`/`branch.setStatus` 等の新 Op 種別) | 同期・dedup・順序付けが既存 batch 経路に乗る。「メタも操作ログ」の D4 思想に忠実 | `unified.ts` の Op 語彙拡張 (`OpSchema`/`OP_CATEGORY`, `unified.ts:55-214`)。projection に branch 構造 fold を追加 |

> **【要判断】推奨は B-1 (専用テーブル) を初期、B-2 (op 化) を将来**。理由: branch lifecycle (create/open/merged/closed) は低頻度メタで、batch のような高頻度追記ではない。まず B-1 で最小に配線し、remote 同期の要件が固まってから B-2 の op 化を検討する段階移行が安全。B-2 を最初に選ぶと Op 語彙という基盤スキーマを branch 都合で拡張することになり、Phase 4d/4e の教訓 (基盤変更は既存テスト・仕様と衝突しやすい) に触れる。

### 3.3 merge の意味論 — 統一 Op 語彙へのマッピング

**merge.ts が既にマッピングを実装済** — `opCategory(op)` (`unified.ts:191-218`) で各 op の category を引き、o3 の D7 ルールへ振る (`merge.ts:36-91`):

| o3 CRDT ルール | 統一 Op category | 現実装の扱い |
|---|---|---|
| structure = OR-Set add-wins | `structure` (`node.add/remove/setParent`, `edge.add/remove/reconnect`) | 追記して projection の clock 順に委ねる。**add-wins 厳密化は未** (clock-LWW, project.ts) → 非目標 (§2.2) |
| content = LWW + 対立検出 | `content` (`node.setContent/setProperties`, `edge.setLabel/setProperties`) | `mergeBranches` が `MergeConflict` を検出・返却 (`merge.ts:76-88`) |
| layout = 静かな LWW | `layout` (`node.setLayout`, `edge.setLayout`) | 追記のみ、対立にしない |
| (複合 group/paste) | 基本 op 列へ分解済 | 統一語彙は既に atomic op の Batch。分解は不要 (`unified.ts:5-15`) |
| presentation | `presentation` | remote 非同期・ローカル限定 (`remoteFilter.ts`) |

**merge の trunk 追記で決めるべき点 (merge.ts が答えていない) 【要判断・重要】:**
- **merge した branch batches の clock 再付与**。`mergeBranches` は batches を**素朴連結**し、clock はそのまま (`merge.ts:73`)。だが trunk が base 以降に進んでいる場合、branch batch の clock は base 近傍 (低位) のままなので、`orderBatches` で **trunk の後発編集より前に並ぶ** (`project.ts:53-59`)。→ content LWW で **trunk の後発編集が branch を上書きする**方向になり、「branch を trunk の上に適用する」という merge の直感と食い違い得る。
  - 選択肢 (i): merge 時に branch batches を **trunk の現先端 clock の後へ再スタンプ** (`LamportClock.tick`, `unified.ts:282`)。branch が上に乗る。だが batch id を変えると端末間 dedup が壊れる → **id は保持し clock だけ更新**する新経路が要る。
  - 選択肢 (ii): clock を保持し「収束はするが LWW は clock 準拠」と割り切る (merge.ts の現挙動)。実装は最小だが merge 意味論がユーザー直感とずれる可能性。
  - **推奨は (i) の思想 (branch を上に乗せる) だが、id 保持・clock 再付与が dedup/受信と両立するかを純ドメインで先に固める** (§4 の p5-3 で単体検証)。
- **content 対立の扱い**: `MergeConflict` を検出しても step1 Phase 5 は**収束を優先し LWW 確定**、対立は**保持のみ** (可視化は後続, §2.2)。保持先 (op-log 上のマーカー op か、別メタか) は 【要判断】。

### 3.4 現行 snapshot 依存の切り離し

| 現行 (snapshot 依存) | op-log 置換 | 備考 |
|---|---|---|
| `computeOperations(base, current)` で pending ops を diff (`useBranchOperations.ts:183-193`) | **branch op-log の base 以降 batch を直接読む** (`branchSheet` の branchBatches 部分がそのまま pending)。commit で `makeCommit(tipClock)` により offset を進める | `computeOperations` 自体は **UI diff ハイライト用に残す** (o3 の分類、`o3-report.md:27`)。layout 対応拡張は任意 |
| `fetchBranchSheetFromPds` (`branchState.ts:543`) | `branchSheet(branch, trunkBatches, branchBatches, meta)` の projection (`branchLog.ts:67`) | PDS レコード読み → op-log projection |
| `syncBranchSheetToAtproto` (`branchState.ts:605`) | branch 編集を通常の tap → `graphEventToBatch` → branch file_id (or branchId) へ push | branch prefix レコード書き込みを撤去 |
| `createBranch` の全複製 (`branchState.ts:417`) | **base offset の記録のみ** (`makeCommit(tipClock)` を branch.base に) + branch メタ登録。複製しない | o3 の「base offset の記録のみに」(`o3-report.md:37`) |
| `mergeBranchToTrunk` レコード書替 (`branchState.ts:743`) | `mergeBranches` → trunk op-log へ `appendBatch` (§3.3) | レコード複製マージ → ログマージ |
| `createMergeRecord`/`updateBranchStatus`/`fetchBranchesForSheet`/`fetchCommitsForBranch` | branch/commit メタ CRUD を §3.2 の永続化先 + §3.5 の remote 経路へ退避 | o3 の「退避」分類 |

**W3e との境界 (明確化):**
- **step1 Phase 5 がやる**: 上表すべて (branch 固有の snapshot 複製・PDS 直叩きの退役)。
- **W3e に残す**: `PUT /files` / `storage.ts` の snapshot storage、trunk の snapshot genesis fallback (`migrateFileToOplog`, `index.ts:268`)、`GET /files` の snapshot 側 (`index.ts:65`)。step1 Phase 5 完了時点でも trunk snapshot は残り、branch だけが op-log 専業になる。

### 3.5 remote (複数端末) での branch/commit/merge 伝播

- **branch batches**: §3.1-B なら別 file_id の batch として既存 push/pull で自動同期。§3.1-A なら `BatchRecord.branchId` 追加で同期。
- **commit オフセット**: 現状 remote 経路が無い。新規に **commit を remote レコードとして push/pull** する経路が要る (branch メタと同様)。commit の `at` は **端末ローカル clock 値**なので、受信端末では `observe` 後の clock 空間と食い違う → **§6 のリスク (a) と直結** (要判断)。
- **branch メタ / merge マーカー**: §3.2 の永続化先を remote へ載せる。
- **discover との整合**: branch file_id (§3.1-B) が `discoverRemoteFiles` で通常ファイルとして materialize されないよう除外 (§3.1)。

---

## 4. 実装スライス分割

Phase 4 と同様、**PDS 非依存で単体に閉じるスライスを先に積み、実機 e2e を最後に 1 つ**。各スライスは dual-write / フラグ付きで既存経路を壊さない。

| スライス | 内容 | PDS 依存 | 依存 |
|---|---|---|---|
| **p5-0** | branch/commit メタの永続化先 (§3.2-B-1): `EventStore` に `branches` テーブル + `saveBranch`/`getBranches`。commit は既存 `commits` を再利用。server API `GET/POST /files/:id/branches`。**server 単体** | なし | — |
| **p5-1** | branch batches 格納先 (§3.1-B): branch file_id の採番規約 + branch↔trunk 紐付けメタ。`EventStore`/server は file_id 素通しなので**新規コード最小**。branch file_id を `listOplogFiles`/`GET /files` から除外。**server 単体** | なし | p5-0 |
| **p5-2** | branch projection 配線: `branchSheet` を op-log から供給する調整層 (`receiveRemoteBatches` と同型の純関数)。commit = `makeCommit(tipClock)` で offset 記録。**純ドメイン/単体** | なし | p5-1 |
| **p5-3** | merge 配線 (§3.3): `mergeBranches` → trunk op-log 追記。**clock 再付与 (i) vs 保持 (ii) を単体で確定**。content 対立の保持先を確定。**純ドメイン/単体** | なし | p5-2 |
| **p5-4** | client hook 載せ替え: `useBranchOperations` の snapshot state (`branchOriginalBase`/`lastCommitBase`) を op-log 派生へ。`computeOperations` は UI diff 用に残す。**dual-write フラグ** (`BRANCH_FROM_OPLOG` 相当) で旧 branchState と併存。client 単体 (PDS 経路はモック) | なし〜一部 | p5-3 |
| **p5-5** | branch/commit/merge メタ + branch batches の remote 同期 (§3.5)。branch file_id の discover 除外を実機想定で。**PDS 依存** | あり | p5-1, p5-4 |
| **p5-6** | 実機 e2e (device A/B)。branch 作成→編集→commit→merge の cross-device 収束。legacy branch snapshot を消した状態で op-log から branch が復元することを検査 | あり | 全て |

**p5-0 が最初** — メタの器が無いと後続が置き場を持たない。**p5-3 (merge の clock 意味論) と §6(a) (commit offset の端末間解釈) が最難関**。

---

## 5. 受入基準

Phase 4 の教訓を継承: **「op-log に行が増えた」「画面に見える」を証拠にしない。** projection の決定論的一致と、legacy snapshot を除去した状態での成立で判定する。

各スライス:
- **p5-0/p5-1**: branch/commit メタと branch batches が op-log に永続化・取得できる (server 単体テスト)。branch file_id が `GET /files`/`listOplogFiles` に**出ない**ことを明示検査 (§3.1-B の除外)。
- **p5-2**: `branchSheet(op-log 由来)` の projection が、旧 `fetchBranchSheetFromPds` の結果と **同一 fingerprint** になる (golden 比較)。branch を開いても trunk projection が不変。
- **p5-3**: merge 後の trunk projection が期待どおり。**clock 再付与方針の下で** branch 編集と trunk 後発編集の LWW 勝敗が仕様どおり (単体で明示テスト)。`MergeConflict` が並行 content 変更で検出される。
- **p5-4**: branch state が op-log から導出されても pending ops / diff ハイライトが旧挙動と一致。フラグ off で旧経路が無傷。
- **p5-6 (Phase 全体)**:
  1. **branch 成立が op-log 由来**: legacy branch prefix レコードを**消した状態**で branch 作成・編集・commit・merge が成立する (snapshot 肩代わりによる偽陽性を排除)。
  2. **cross-device 収束**: device A が作った branch を B が op-log 経由で取得し、両端末の `branchSheet` projection fingerprint が一致。
  3. **merge 収束**: merge 後の trunk projection が A/B で一致。
  4. **適用不能 op 0 件**: branch/merge 経由の受信 batch が全 op projection へ効く (`applicability.ts` の drops=0, Phase 4d 計測器を再利用)。
  5. **非破壊回帰**: 2 回受信で不変、trunk projection 不変、undo スタック非破壊 (§6c)。

> **偽陽性の担保** (Phase 4 教訓): 基準 1 は「legacy snapshot / branch prefix レコードを構成的に持たない状態」で検査する。Phase 4e-4 が空の device B で「legacy snapshot なし」を構成的に満たした手法 (`step1-phase4e-bootstrap.md:435-438`) を踏襲する。

---

## 6. リスクと未解決点

### 6.1 【High・要判断】commit offset の端末間解釈 (§3.5)

`Commit.at: Lamport` は **スカラーのローカル clock 値** (`branchLog.ts:26-33`)。`batchesUpTo` は `clock <= at` で切る (`branchLog.ts:59-61`)。だが:
- clock は端末ごとに `observe` で進む (`unified.ts:287-291`)。actor が複数だと clock 空間が**密でも単調でもない** (`orderBatches` の tiebreak が actor/id, `project.ts:53-59`)。
- device A の commit `at=5` を device B が受け取ったとき、B の clock 空間で「clock<=5」が A の意図した batch 集合と一致する保証が無い。
- **選択肢**: (i) commit を「含む batch id の集合 / content-addressed ハッシュ」で表現 (offset をやめる)、(ii) offset のまま単一端末では正しいと割り切り cross-device commit を非目標化、(iii) per-actor の vector で offset を表現。
- **推奨**: p5-6 前に **単一端末では offset で十分・cross-device commit の意味論は p5-3 の merge clock 方針と一緒に決める**。ここは branchLog の現設計 (`at: Lamport`) が multi-device で綻ぶ可能性がある**最重要の未解決点**。

### 6.2 【Medium・要判断】既存 PDS branch データの移行 or 破棄

o3 は破棄前提 (`o3-report.md:41`, `branchState.ts:9`)。だが branch/commit は**ユーザーが作った版管理データ**。
- **選択肢**: (i) 破棄 (step1 genesis の破棄前例に倣う)、(ii) 一度きりの migration (branch prefix レコード → branch op-log の genesis 相当)。
- **推奨**: (i) 破棄を既定。ただし「試験リリース済で実データがある」なら (ii) の要否をユーザー確認。migration するなら `graphFileToBatches` と同型の「branch snapshot → branch batches」変換を p5-1 で用意。

### 6.3 【Medium・要判断】undo/redo と branch の相互作用

- undo/redo の単位は Batch (`unified.ts:5-9`)。branch 切替時に undo スタックをどう扱うか (branch ごとにスタックを分けるか、共有か) が未定義。現行 `useBranchOperations` は branch 切替で snapshot を差し替えるだけで undo との関係は暗黙 (`useBranchOperations.ts:211-304`)。
- 受信 batch は undo 対象外 (Phase 4d 方針)。merge で trunk に入った branch batches も undo 対象外にすべきか (merge の取り消しは undo でなく revert か)。
- o3 Phase1 課題 #5 (複合イベントの undo 粒度) も未決 (`o3-report.md:49`)。
- **推奨**: branch 切替で undo スタックを **branch ごとに分離** (混線防止)、merge は undo 非対象 (別途 revert 操作) を初期方針とし p5-4 で確定。

### 6.4 【Medium】branch file_id の discover 漏れ (§3.1-B 固有)

除外を入れ忘れると branch が Sidebar に裸で並ぶ / 他端末が branch を通常ファイルとして materialize する。受入基準 (§5 p5-0/p5-1) で明示検査。§3.1-A を選べば発生しない (A vs B のトレードオフの一部)。

### 6.5 【Low】ATProto の型制約

float 不可 (整数丸め必須, Phase 4e で発覚) は branch batches にも適用 — 既存の layout 整数丸め対策 (`toUnified.ts` の `nodeSetLayoutOp`) が branch 経路でも効くことを p5-5 で確認。genesis の float 直列化差 dedup 外れ (`step1-phase4e-bootstrap.md:60-67`) と同型の注意。

---

## 7. 前フェーズ教訓との突き合わせ (実装着手前チェック)

Phase 4d/4e で「設計の対策・受入基準を既存仕様・外部 API 型・非目標節と実装前に突き合わせる」教訓 (memory `feedback_design_vs_existing_spec`)。step1 Phase 5 の要突き合わせ項目:
- **既存テストが旧 branch 挙動を固定していないか** (Phase 4e-0 の M1 再発防止)。**critic H3 で所在が判明**: `branchState.test.ts` の 27 テストは**大半が `computeOperations`** (§3.4 で UI diff 用に残すもの = 書換対象外)。実際に置換対象の snapshot 挙動を固定しているのは **`useBranchOperations.test.ts` (29 テスト)** の `handleCreateBranch`(97)/`handleMergeBranch`(132)/`handleSelectBranch`(272,434)/`pendingOps`(315) の 5 describe。これらは `fetchBranchSheetFromPds` 呼出と `computeOperations` 由来 pending を検証しており **p5-4 でほぼ全滅する** → 旧経路はフラグ off で温存しつつ op-log 版へ書き換える。
- **branchLog の `Branch` に sheetId が無い** (`branchLog.ts:36-41`) vs 現行 branch は per-sheet (`branchState.ts:88`)。step1 Phase 5 で branch を per-sheet のまま保つなら、branchLog の Branch に sheetId 相当をどう持たせるか (メタ側か、branch batches の sheetId scope で足りるか) を p5-0 で確定。
- **`merge.ts` の clock 保持挙動** (§3.3) が既にテスト固定されているか (`merge.test.ts`) を p5-3 着手前に確認。clock 再付与 (i) を採るなら既存テストと衝突する可能性。

---

## References (実コード裏取り)

- `src/client/src/atproto/branchState.ts:1-11` — `@deprecated` と op-log 置換先の明示
- `src/client/src/atproto/branchState.ts:88-111` — 現行 `Branch`(per-sheet, sheetId 保持)/`Commit` 型
- `src/client/src/atproto/branchState.ts:116-202` — `computeOperations` (snapshot diff, layout 除外)
- `src/client/src/atproto/branchState.ts:417-528, 605-701, 743-892` — `createBranch`/`syncBranchSheetToAtproto`/`mergeBranchToTrunk` のレコード複製実装
- `src/client/src/hooks/useBranchOperations.ts:105-193` — snapshot ベース state と pending ops の diff 算出
- `src/shared/src/events/branchLog.ts:26-75` — `Commit`(at: Lamport)/`Branch`(base, no sheetId)/`branchSheet`/`batchesUpTo`
- `src/shared/src/events/merge.ts:36-91` — `mergeBranches` の素朴連結 + content 対立検出
- `src/shared/src/events/unified.ts:191-242, 282-291` — `OP_CATEGORY`/`opCategory`、`Batch` schema、`LamportClock`
- `src/shared/src/events/project.ts:53-72, 295-328` — `orderBatches` tiebreak、`projectBatches`/`projectFile` が file_id 全 batch を畳む
- `src/shared/src/events/genesis.ts:47-75, 197-234` — content-addressed batch id / snapshot→batches 変換 (branch migration 参考)
- `src/server/src/eventStore.ts:55-76, 197-217, 219-233, 327-338` — batches/commits スキーマ(FK 無し)、`listOplogFiles`(0 シート除外)、`saveCommit`/`getCommits`(commit の器は既存)
- `src/server/src/index.ts:63-74, 212-276` — `GET /files` 和集合、batches エンドポイント群 (file_id パスパラメータ)
- `src/client/src/atproto/batchMapper.ts:8-31` — `BatchRecord`(fileId 埋め込み, branchId 無し), remote batch コレクションは 1 つ
- `src/client/src/sync/receiveRemoteBatches.ts:52-78`, `discoverRemoteFiles.ts:52-82` — 受信/発見経路 (branch file_id 除外の要否)
- `src/client/src/atproto/remoteFilter.ts:11-43` — genesis remote push (Phase 4e), presentation 除外
- `deepse/spikes/o3-report.md:21-49` — branchState 解体マップ (7 廃棄/4 退避/computeOperations 残す)、Phase1 未決課題 (OR-Set 厳密化・undo 粒度)
- `deepse/architecture/step1.md:18, 124-143` — D4(操作ログ正典)/D7(同期範囲)/マージ方針
- `deepse/plans/step1-phase4e-bootstrap.md:300-333, 435-438` — スライス分割の型 (単体先行・実機最後)、偽陽性排除の検査手法

---

補足: 本書は初版ドラフト。§3.1 (branch batches 格納先 A/B)、§3.2 (branch メタ B-1/B-2)、§3.3 (merge clock 再付与 i/ii)、§6.1 (commit offset の端末間解釈)、§6.2 (既存データ破棄/移行) は **ユーザー決定待ちの判断点**。

---

## 8. critic レビュー結果 (2026-07-24, Opus, 実コード裏取り込み) — 判定: REVISE

初版は裏取り精度・判断点の自己申告とも高水準だが、**最大推奨 §3.1-B (branch 専用 file_id) と merge (§3.3/§3.4) の組合せが remote の `rkey=batchId` 単一名前空間と衝突する Critical** が発見された。これは §3.1 の A/B 選択そのものを再評価させる材料。以下を反映する。

### 8.1 【Critical C1】§3.1-B + merge が remote の `rkey=batchId` 単一名前空間と衝突する

- **根拠**: remote の batch コレクションは repo 全体で 1 つ・`rkey=batchId` (`batchMapper.ts:8-11,63-64`)。`mergeBranches` は branch batch を **id そのまま** `[...trunkAfterBase, ...branchBatches]` で運ぶ (`merge.ts:73`)。§3.1-B では branch batch は既に **branch file_id** の記録として remote へ push 済 (§3.5)。merge で同一 batchId X が **trunk file_id の記録としても**載ると、PDS の put は rkey 単位で上書きなので **merged-X (fileId=trunk) が branch-X (fileId=branch) を上書きし、branch 側が X を失う** → 他端末で branch/merge projection が発散。
- **§3.3 (i)「id 保持・clock だけ更新」はこの衝突を悪化させる** (同一 rkey に別 clock 2 版。local は `UNIQUE(file_id, batch_id)` で両立するが remote rkey 単一では表現不能, `eventStore.ts:64`)。初版は「id を変えると dedup が壊れる」ことだけ懸念し、**id 保持が remote 名前空間で別種の破綻を招く**点を見落としていた。
- **影響**: 受入基準 p5-6.2/6.3 (cross-device fingerprint 一致) が**構造的に達成不能**になる。
- **Fix (要判断)**:
  - **(a) §3.1-B を維持するなら**: merge で trunk へ追記する batch は **新規 id を採番** (branch-X → trunk-Y)。ただし A/B 端末が独立に merge すると別 id の二重適用が起きるため、**merged batch id を `deterministicUuid(branchId + X)` で端末間一致させる** + merge の伝播モデル (一度実行し伝播 or 各端末で決定論再計算) を §3.3/§3.5 に明記。
  - **(b) §3.1-A (batches に `branch_id` 列) を採るなら**: merge は `branch_id: X→NULL` の**更新** = 同一 rkey・同一 file_id で表現でき、**この衝突が原理的に発生しない**。C1 は「trunk hot path に触らない (B)」と「merge が remote 名前空間と自然に整合 (A)」のトレードオフを示す。**初版は A/B を「projection の汚れをどこで防ぐか」だけで比較していたが、critic は「merge の remote 表現」という第 2 軸を追加すべきと指摘 (最大の盲点)。**

### 8.2 【High H1】§6.1 は branch **base** の端末間決定性も破り、受入基準 p5-6.2 と非両立になり得る

- **根拠**: `branchSheet` は `batchesUpTo(trunkBatches, branch.base)` を分岐点に使う (`branchLog.ts:73`)。`batchesUpTo = filter(b.clock <= base.at)` (scalar, `branchLog.ts:59-61`)。clock は端末間で密でも単調でもない (`orderBatches` tiebreak=actor/id, `LamportClock.observe=max+1`, `project.ts:53-59`, `unified.ts:288-289`)。→ 端末 B が低 clock の trunk batch を後から観測すると `batchesUpTo` の結果が変わり、**同じ branch でも端末ごとに base が変わって branchSheet fingerprint が発散**。
- 初版は §6.1 を「commit=checkpoint の解釈」問題として書いたが、実際は **branch の分岐点 (base) 自体**が綻ぶ。受入基準 p5-6.2 (cross-device branchSheet 一致) と非両立になり得る点まで接続できていなかった。
- **Fix**: §6.1 の選択肢 (i)「content-addressed な位置表現」を **branch.base にも適用**。**p5-2 の golden 比較を単一端末に限定するか cross-device まで要求するかを先に確定** — 後者なら scalar offset は不可という結論を §3/§4 に前倒しする。この一点で §6.1 の緊急度が決まる。

### 8.3 【High H2】branch file_id の discover 除外に bootstrap 循環がある

- **根拠**: 初版の除外キーは「branch メタに登録された file_id か」だが、branch メタ自体が §3.5 で remote 同期される。`discoverRemoteFiles` は未知 file_id を**無条件 materialize** (`discoverRemoteFiles.ts:64-77`、branch 判定フック無し)。新規端末が branch batch を**メタ着地前**に pull すると branch file_id を通常ファイル化する race。決定論 id (`deterministicUuid`) はハッシュが非可逆なので **file_id 単独から branch 判定できず除外に効かない** (初版は「dedup に有利」と混同)。
- **Fix**: discover の除外を「メタ照合」でなく **file_id 命名規約による自己記述** (メタ未着でも discover 単独で除外判定可能) へ寄せる、または branch batch を discover の pull 対象から構造的に外す。受入基準に **「branch メタ未着で branch batch を受信しても materialize されない」順序不変検査**を追加。

### 8.4 【Medium M2】listOplogFiles の除外は既存「0 シート除外」で概ね賄える — 本質的に要るのは discover 側

- **根拠**: `branchSheet` は sheet メタを引数から与え `projectBatches` で畳む (`branchLog.ts:67-74`) ので branch file_id の op-log は `sheet.create` を持たず、`projectFile(branchBatches)` は 0 シート → `listOplogFiles` の `if (sheets.length===0) continue` で**自動除外** (`eventStore.ts:207`)。→ §3.1-B が「必須」とした listOplogFiles 側明示除外は概ね不要。**本質的に除外が要るのは sheet 数を見ない `discoverRemoteFiles`** (H2)。§5 p5-1 の主対象を discover 除外へ。

### 8.5 【Medium M3】p5-3 (merge) と p5-4 (hook) の間に「merge 結果の受信・べき等・再 projection」中間層が欠落

- Phase 4d の `appendReceivedBatches`/`reprojectAfterReceive` に相当する層が p5-3〜p5-5 に明示されていない。**p5-3.5 (or p5-5 の一部) として「merge 追記 batch の採番規約 + 受信べき等 + 再 projection」を独立スライス化**する。

### 8.6 critic の各「要判断」推奨 (最終決定はユーザー)

- **§3.1 A/B**: C1 を踏まえ**再評価を推奨**。単純な非破壊性なら B だが、merge が remote `rkey=batchId` 単一名前空間と両立するかを第 2 軸に入れると **A が有利になり得る**。B 維持なら「merge 追記 batch は新規決定論 id」を必須対策として同時確定。
- **§3.2 B-1/B-2**: **B-1 (専用テーブル) 支持**。commit と対称にするなら commit endpoint も同時新設 (M1)。B-2 の Op 語彙拡張は後回しが妥当。
- **§3.3 (i)/(ii)**: **(i) の思想 (branch を上に乗せる) は支持。ただし「id 保持 + clock 再付与」は C1 で remote 非互換 → 「merged batch は新規 (決定論) id + trunk 先端後の clock」へ修正した (i)** を推奨。
- **§6.1**: **scalar offset を branch.base/commit の両方で放棄し content-addressed な位置表現へ**。cross-device を受入基準に含めるなら必須。「単一端末では offset で十分」は p5-2 を単一端末に限定する場合のみ有効。
- **§6.2 破棄/移行**: 破棄既定に同意。ただし試験リリース済で branch/commit の実データがあるかをユーザーに確認する姿勢は妥当。

### 8.7 Open Questions (critic 未採点・ユーザー確認事項)

1. **merge の実行・伝播モデル**: 「一度だけ実行し伝播」か「各端末が独立に決定論再計算」か。C1 Fix 選択に直結。
2. **branch の per-sheet 維持**を続けるか (現行 `branchState.Branch.sheetId`)。branchLog の Branch に sheetId が無いので、メタに持たせるか branch batch の sheetId scope で足りるかを p5-0 で確定。
3. **p5-2 の golden 比較を単一端末に限定するか cross-device まで求めるか** (H1/§6.1 の緊急度を決める最重要スコープ判断)。

---

## 9. スコープ確定と設計の簡素化 (2026-07-24 ユーザー決定)

### 9.1 master 判断: cross-device branch 同期は step1 Phase 5 スコープ外 (単一端末に絞る)

Phase 4 が「送信のみ → 受信」と段階を切ったのと同型で、**step1 Phase 5 は branch/commit/merge を op-log 化し単一端末で成立させるまで**とする。cross-device branch 同期 (2 端末で branch/merge が収束) は**後続 phase へ先送り**。

### 9.2 これで立つ不変条件と、C1/H1/H2 の解消

**不変条件 (step1 Phase 5 の核心): 「branch file_id の batch は local (daemon EventStore) 専用。remote へ push しない」。**

- **C1 (Critical) 解消**: branch batch を remote へ push しなければ `rkey=batchId` の単一名前空間衝突は起きない。merge は branch batch を trunk file_id へ追記し (trunk は従来どおり remote push される)、**branch file_id 側は一切 push されない**ので、同一 rkey が「branch 記録」と「trunk 記録」の 2 経路で載ることがない。→ merge 追記 batch の id は **保持しても新規採番でもよい** (remote 非互換の懸念が消える。local は `UNIQUE(file_id, batch_id)` で両立)。§3.3 の「id を変えると dedup が壊れる」も cross-device 前提だったので step1 Phase 5 では非問題。
- **H1/§6.1 解消**: 単一端末・単一 actor では `LamportClock.tick` が単調 (`unified.ts:282`) なので scalar offset (`Commit.at`, `batchesUpTo(clock <= at)`) がそのまま正しい。content-addressed な位置表現への変更は cross-device phase へ先送り。**§6.1 は step1 Phase 5 の未解決点ではなくなり、後続 phase の前提条件へ移動**。
- **H2 解消**: branch file_id を remote へ出さないので `discoverRemoteFiles` が branch を拾う race が起きない。local の `GET /files`/`listOplogFiles` は **M2 の 0 シート自動除外**で賄える (`branchSheet` が sheet メタを引数から与える設計上、branch op-log は `sheet.create` を持たず 0 シート projection になる, `branchLog.ts:67-74`, `eventStore.ts:207`)。→ **除外の明示実装すら原則不要**。要確認は「branch file_id が本当に 0 シート projection になり listOplogFiles から落ちるか」の 1 点のみ (p5-1 の受入基準)。

### 9.3 確定した設計判断 (critic 推奨 + 9.1 スコープ下)

- **§3.1 = B (branch 専用 file_id)**。C1 が解消したので推奨どおり B を採る。trunk 読取経路 (Phase 4 成果物) に一切触らない。
- **§3.2 = B-1 (専用 `branches` テーブル + endpoint)**。commit も型は既存 `commits` 再利用だが **endpoint と caller は新規** (M1)。branch/commit とも **local daemon 経路のみ** (remote 同期は先送り)。
- **§3.3 = (i) の思想 (merge した branch を trunk 先端の後へ)**。単一端末なので clock 再付与も id 保持も remote 制約から自由。**merged batch は trunk 先端 clock の後へ再スタンプし branch を上に乗せる**。id 採番規約は p5-3 で単体確定 (local dedup のみ考慮でよい)。
- **§6.2 = 破棄既定**。既存 PDS branch データは破棄。ただし試験リリース済の実データ有無は §9.5 でユーザー確認。

### 9.4 スライスの簡素化

- **p5-5 (remote 同期) は step1 Phase 5 から除外** → cross-device phase へ。
- **p5-6 (実機 e2e) は「単一端末・local」e2e に**。受入基準 p5-6.1 (legacy branch prefix レコードを消した状態で branch 作成→編集→commit→merge が op-log から成立) を主軸に。cross-device 収束 (旧 p5-6.2/6.3) は先送り。
- 改訂スライス: **p5-0** (branch/commit メタ table + endpoint, server 単体) → **p5-1** (branch file_id 採番 + 0 シート除外の確認, server 単体) → **p5-2** (branchSheet projection 配線, 純ドメイン/単体) → **p5-3** (merge = trunk 追記 + clock 再スタンプ + 受信べき等・再 projection 中間層 [M3], 純ドメイン/単体) → **p5-4** (client hook 載せ替え, dual-write フラグ, `useBranchOperations.test.ts` の 5 describe 書換 [H3]) → **p5-5'** (単一端末 local e2e)。

### 9.5 要確認の確定 (2026-07-24 ユーザー決定)

1. **branch は per-sheet を維持** (確定)。現行 `branchState.Branch.sheetId` を保つ。**branch メタ table に `sheetId` を持たせる** (branchLog の `Branch` に無いフィールドをメタ側で補う)。現状 UX を保ち `useBranchOperations` の書換を最小化する。
2. **既存 PDS branch/commit データは破棄** (確定)。移行コード不要。step1 の genesis 破棄前例に倣う。
3. **後続 cross-device phase への申し送り**: §6.1 (content-addressed offset)・C1 (merge の remote id 採番)・H2 (discover 除外) は **cross-device phase の前提条件**として本 §に記録済。その phase 着手時に再度設計する。

### 9.6 確定サマリ (実装の出発点)

- スコープ: branch/commit/merge を op-log 化し**単一端末で成立**させる。cross-device は先送り。
- branch batches: **branch 専用 file_id・local 専用 (remote へ push しない)** (§3.1-B + §9.2 不変条件)。
- branch/commit メタ: **専用 table (`branches` に sheetId 含む / `commits` 再利用) + 新規 local endpoint** (§3.2-B-1 + M1)。
- merge: **branch batch を trunk 先端 clock の後へ再スタンプして trunk file_id へ追記** + 受信べき等・再 projection 中間層 (§3.3-i + M3)。
- 既存データ: 破棄。branch は per-sheet 維持。
- スライス: p5-0 → p5-1 → p5-2 → p5-3 → p5-4 → p5-5' (単一端末 local e2e) (§9.4)。
