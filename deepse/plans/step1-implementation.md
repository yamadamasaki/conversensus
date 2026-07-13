# step1 実装計画

> ステータス: **実行中** / 作成日: 2026-07-12
> 位置づけ: [step1 アーキテクチャ](../architecture/step1.md) の確定を受けた実装計画。
> O3 (branch/commit/merge の統一イベントモデルへの載せ替え) の spike を起点に、§9 の移行順序を具体化する。

---

## 0. 前提と確定事項

- **既存 PDS 上のブランチ/コミットデータは破棄してよい** (試験リリース・個人利用段階のため)。
  移行コードは書かず、統一イベントモデルで新規から作り直す。→ Phase 2 の移行コストがほぼ消える。
- 配布形態は §7 の推奨に従い **B2 (軽量 B: ローカル Hono デーモン + ブラウザ)** から着手する。Tauri (B1) はクリティカルパスに置かない。
- バージョン管理は GitHub の PR ベース・ワークフロー (CLAUDE.md 準拠)。**Phase ごとに** branch → 実装 → commit → push → ユーザー確認 → merge。

## 1. コード読解で判明した、計画を規定する2つの事実

### 事実1: 現行ブランチは「操作ログの分岐」ではなく「レコードの複製」

`src/client/src/atproto/branchState.ts` (969 行) は、ブランチを Node/Edge レコードの **rkey プレフィックス付きコピー**として実体化している。

```
trunk:  "trunk_{uuid}"
branch: "{branchId}_{uuid}"
```

- Commit は `CommitOperation[]` を JSON で保持しつつ、`tree` (レコード snapshot への StrongRef 配列) も持つ。
- Merge (`mergeBranchToTrunk`) はブランチのレコードを trunk へコピーする。

→ **ストレージ中心のモデル**であり、O3 が問う「操作ログの分岐」とは根本的に異なる。ここが spike の核心。

### 事実2: `computeOperations` は layout を意図的に除外している

`branchState.ts:102`:

```
// layout 変更は含めない (滑らかな変更は commit 対象外)
```

→ 先に確定した **D7 (layout を同期対象に含める)** と直接衝突する。diff / commit / merge のモデルは layout を含むように作り替える必要がある。

### 統合対象の2語彙は非対称

| 語彙 | 場所 | 種類数 | 内容 |
|---|---|---|---|
| `GraphEvent` | `src/client/src/events/GraphEvent.ts` | 19 | undo/redo 用。grouping・paste・reparent・layout・presentation を含む複合イベントあり |
| `CommitOperation` | `src/shared/src/schemas.ts` | 6 | ATProto 同期用。node/edge の add/update/remove のみ。discriminated union で綺麗 |

統合の設計論点: **`GraphEvent` を基底語彙とし `CommitOperation` を導出**できるか。特に複合イベント (grouping/paste) を sync 語彙にどう乗せるか (分解して基本 ops 列にするか、複合のまま運ぶか) が最大の未知数。

---

## 2. Phase 一覧

| Phase | 内容 | Exit / 成果物 |
|---|---|---|
| **0. O3 Spike** | 仮説「ブランチ=操作ログの分岐点 / コミット=ラベル付きオフセット / マージ=ブランチ ops を trunk へ追記 (D7 の LWW・対立可視化ルールで解決)」の go/no-go 判定 | 判定レポート + 型スケッチ + ローカル PoC |
| **1. 統一語彙** (§9-1) | `GraphEvent` と `CommitOperation` を1語彙へ。projection 経路を新設。layout を diff/commit に含める (D7) | 統一イベント型 + projection + テスト |
| **2. ブランチ載せ替え** | ブランチ=base offset+イベント列、コミット=ラベル付きオフセット、マージ=追記+D7解決。rkey 複製方式を廃止 (既存データは破棄) | branchState.ts の全面書き換え |
| **3. ローカル永続層** (§9-2, O1) | 保存を「操作ログ+projection」へ。ストレージ実体を決定 | 永続層実装 |
| **4. sync-provider** (§9-3) | ATProto を provider 実装に整理。outbox+オフライン分岐。全件list/polling/cidCache 改修 | SyncProvider 境界 |
| **5. 実証 / VPS** (§9-4,5) | 軽量 B で end-to-end 検証。VPS 役割変更 | local-first 実証 |

**クリティカルパス**: Phase 0 → 1 → 2。破棄前提により Phase 2 の移行コストがほぼ消え、**最大リスクは Phase 0 の「複合イベントを sync 語彙にどう乗せるか」に絞られた**。

---

## 3. Phase 0: O3 Spike の詳細

**目的**: §9-1 のサイジング確定前に、branch/commit/merge がイベントログ上で表現できるかを go/no-go 判定する。

**time-box**: 2〜3日相当。コードは投棄前提の最小 PoC。

### 検証タスク

1. **語彙の統合設計 (型スケッチ)**: `GraphEvent` を基底に `CommitOperation` を導出/エンコードできるか型で確認。grouping・paste・reparent の sync 表現を決める。
2. **ブランチの再定義 PoC**: メモリ上の操作ログに対し「base offset + 追記イベント列」でブランチ sheet を projection できるか、PDS 非依存の最小 PoC を書く。
3. **マージ + layout**: 2ブランチの ops を trunk へ畳み込み、structure/content=OR-Set + content LWW (対立可視化) / **layout=LWW (静か)** が一貫して表現できるか確認。`computeOperations` の layout 除外を撤廃した版で diff が破綻しないか。
4. **branchState.ts 解体マップ**: 13 の公開関数を (a) 残すドメインロジック / (b) sync-provider へ退避する PDS I/O / (c) rkey 複製方式ゆえ廃棄、に仕分ける。

### Exit criteria

- ✅ **Go**: PoC でブランチ projection とマージが成立 → Phase 1 へ。branchState を「イベントログ分岐」へ全面移行。
- ⚠️ **Partial**: 基本 ops は乗るが複合イベントが難しい → 複合イベント正規化方針を決める小タスクを Phase 1 前に追加。
- ❌ **No-go**: 分岐がイベントログに乗らない → branchState を projection 層の外の別レイヤーとして温存し、統一を structure/content/layout イベントに限定 (step1 スコープ縮小)。

---

## 4. 持ち越しの未決事項

| ID | 未決 | 決定タイミング |
|---|---|---|
| ~~論理時刻の実体~~ | **確定: Lamport** (`LamportClock`, observe=max+1)。Phase 1 で実装 | ✅ Phase 1 |
| ~~O1 ストレージ実体~~ | **確定: SQLite (`bun:sqlite`)**。append-only な batches テーブルへ追記し、projection で導出。B2 (ローカル Hono デーモン) 常駐からの並行アクセス・トランザクション・耐久性で採択。組み込みのため依存追加なし | ✅ Phase 3 |
| ~~複合イベントの正規化~~ | **確定: バッチ** (1 操作 = 基本 op のバッチ, undo 単位 = バッチ, 解決単位 = op) | ✅ Phase 1 |

## 5. Phase 1 完了メモ (2026-07-12)

- **成果物** (`src/shared/src/events/`, `src/client/src/events/toUnified.ts`):
  - `unified.ts`: 統一語彙 (Op 15 種 / Batch / OP_CATEGORY / isSyncable / LamportClock)。
  - `project.ts`: `projectBatches` (fold) + `toSheet`。LWW・カスケード削除・layout 部分更新・presentation 分離。
  - `fromCommitOperation.ts`: `CommitOperation` (6 種) → Op[] 。同期語彙の部分集合性を証明。
  - `toUnified.ts`: `GraphEvent` (19 種) → Batch。client 語彙の部分集合性を証明。複合イベントをバッチ分解。
- **layout を語彙に内包** (D7): `node.setLayout` / `edge.setLayout` を同期対象 op として定義。
- **テスト**: 20 追加 (全 326 pass)。各 `.test.md` あり。
- **Phase 2 へ引き継ぐ既知の制約**:
  1. `NODE_PROPERTIES_CHANGED.to` は差分 → 統一 op は置換意味論。capture 時に full properties を持たせる配線が必要。
  2. `NODE_STYLE_CHANGED` を layout へ正規化した。旧イベント発行箇所の整理は Phase 2。
  3. 本 Phase は**追加のみ (非破壊)**。既存 `GraphEvent`/`CommitOperation` の呼び出し箇所の実置換は Phase 2 以降。
  4. add-wins OR-Set の厳密化 (concurrent add/remove) は未実装 (現 projection は clock-LWW)。

## 6. Phase 2 完了メモ (2026-07-12)

- **成果物** (`src/shared/src/events/`):
  - `merge.ts`: `mergeBranches` — ブランチ batches を trunk へ追記するログマージ。content 対立検出 + layout 静かな LWW + structure 保持。`mergeBranchToTrunk` (レコード複製) の置換。
  - `branchLog.ts`: `Branch`/`Commit` をログオフセットとして再定義。`tipClock`/`makeCommit`/`batchesUpTo`/`branchSheet`。rkey 複製方式のドメイン概念 (createBranch/createMainBranch/fetchBranchSheetFromPds) の置換。
- **テスト**: 9 追加 (全 335 pass)。各 `.test.md` あり。
- **非破壊**: 旧 `branchState.ts` は `@deprecated` バナーを付けて温存。App 配線・PDS I/O の実置換は Phase 3 (永続層) / Phase 4 (sync-provider) で行い、切り替わり次第削除する。
- **Phase 3/4 へ引き継ぐ作業**:
  1. `branchState.ts` の PDS I/O 4 関数 (fetchBranches/fetchCommits/updateBranchStatus/createMergeRecord) を sync-provider へ退避。
  2. App.tsx / useEventStore の branchState 依存を `branchLog`/`merge` へ切り替え。
  3. `computeOperations` (state diff) は UI diff 用途が残る場合のみ layout 対応で存続、不要なら廃棄。

## 7. Phase 3 完了メモ (2026-07-13)

- **O1 確定: SQLite (`bun:sqlite`)**。§4 の表を参照。append-only な batches テーブルへ追記し projection で導出する。組み込みのため依存追加なし。
- **成果物** (`src/server/src/eventStore.ts`):
  - `EventStore` — 操作ログ永続ストア。1 インスタンス = 1 DB、ファイルごとに `file_id` で仕切る。
  - スキーマ: `batches`(seq PK / file_id / batch_id / actor / clock / timestamp / ops_json、`UNIQUE(file_id, batch_id)`) + `commits`(ラベル付きオフセット)。読み出し順のため `(file_id, clock, timestamp, batch_id)` にインデックス。WAL 有効。
  - API: `appendBatch` (INSERT OR IGNORE でべき等) / `appendBatches` (トランザクション) / `getBatches` (clock 昇順) / `projectSheet` (projectBatches → toSheet) / `saveCommit` / `getCommits` / `close`。
  - 永続化境界の不変条件は「空 ops の Batch を弾く」の最小限。UUID フォーマット検証は外部 API 境界 (HTTP) の責務 (CLAUDE.md)。
- **テスト**: 12 追加 (全 347 pass)。`.test.md` あり。インメモリ (`:memory:`) で DB を分離。
- **非破壊**: 旧 `storage.ts` (GraphFile を JSON スナップショット保存) は温存。HTTP API を EventStore へ載せ替える配線は Phase 4 (sync-provider) と併せて行う。
- **Phase 4 へ引き継ぐ作業**:
  1. HTTP API (`index.ts`) の `/files` 系を EventStore へ載せ替え (現状は `storage.ts` の全体スナップショット保存)。載せ替え後に `storage.ts` を廃棄。
  2. Branch (base コミット + 分岐) の永続化。現状 EventStore は batches / commits まで。branches テーブルは sync-provider の分岐管理と併せて設計する。
  3. Lamport clock の永続化・復元 (再起動後に max(clock)+1 から再開する配線)。

## 8. Phase 4 (sync-provider) のサブフェーズ分割

Phase 4 (§9-3 / architecture §6) は atproto 配下 ~3458 行の再編 + 外部 I/O を伴い 1 PR に大きすぎるため、非破壊・追加優先で以下に分割する:

| スライス | 内容 | 状態 |
|---|---|---|
| **4a** | `SyncProvider` 境界 (push/pull/subscribe) + `NullSyncProvider` (完全ローカル) | ✅ 実装済 (下記メモ) |
| **4b** | outbox + オフライン分岐 (オフライン時 ops を積み復帰時 flush) | ✅ 実装済 (下記メモ) |
| **4c** | ATProto を provider 実装へ整理 (collections/sync/mapper/branchState/poller を `AtprotoSyncProvider` 内部へ封じ込め) | ✅ 実装済 (下記メモ) |
| **4d** | 構造改修: 全件 list の解消 (rkey/コレクション範囲取得, R3) / polling → Jetstream / cidCache 永続化 | 未着手 |
| (併走 W1) | 実配線 サーバ側: HTTP API に batch エンドポイント追加 (EventStore backed) | ✅ 実装済 (下記メモ) |
| (併走 W2) | 実配線 クライアント側: useEventStore ↔ Outbox/SyncProvider、旧 storage.ts 退役、Lamport clock 永続化 | 未着手 |

### Phase 4a 完了メモ (2026-07-13)

- **成果物** (`src/client/src/sync/`):
  - `syncProvider.ts`: `SyncProvider` インターフェース (`push(batches)` / `pull(since)` / `subscribe(onRemote)`) + `Cursor` (不透明・provider 定義) / `INITIAL_CURSOR` / `PullResult` (cursor-pagination) / `Unsubscribe` / `OnRemote` 型。
  - `nullSyncProvider.ts`: `NullSyncProvider` — 完全ローカル (未ログイン・オフライン運用) の既定 provider。push=no-op / pull=空+初期カーソル / subscribe=非配信。外の層が「provider は常に存在する」前提で書けるようにし、ATProto 有無の分岐を消す。
  - `index.ts`: バレル。
- **運搬単位は `Batch`** (統一語彙、Phase 1)。architecture §6 の擬似コードは旧 `GraphEvent[]` だが正典一本化に伴い `Batch[]` へ更新。
- **テスト**: 4 追加 (全 351 pass)。`.test.md` あり。境界の型定義はロジック無しのためテスト対象外、振る舞いを持つ `NullSyncProvider` を固定。
- **非破壊**: 既存 atproto コードは未変更。provider への封じ込め (4c) と外の層の配線切替は後続スライス。

### Phase 4b 完了メモ (2026-07-13)

- **成果物** (`src/client/src/sync/outbox.ts`):
  - `Outbox` — remote へ未 push の batches を FIFO 保持する送信キュー。`enqueue` (id べき等) / `pending` / `size` / `isEmpty` / `flush(provider)`。
  - **オフライン分岐は online フラグを持たず flush 結果で表現**: `provider.push` resolve → スナップショット分を id 指定で除去 / reject (オフライン) → 保留維持・次回 flush で再送。flush の起動タイミング (再接続検知・定期) は呼び出し側が決める。
  - **in-flight 非喪失**: push の await 中に enqueue された新規分を、成功時の一括クリアで巻き込まない (送信スナップショット分だけを除く)。`flushing` ガードで多重起動も防ぐ。
  - `FlushResult` = `{ ok, flushed, error? }`。
- **テスト**: 7 追加 (全 358 pass)。`.test.md` あり。`RecordingProvider` で online/offline・in-flight enqueue を再現。
- **非破壊**: 既存コードは未変更。Outcome を UI/EventStore に配線するのは後続。
- **後続へ引き継ぐ**: 保留のリロード生存 (durable backing) は、別コピーを持たず**ローカル正典ログ (EventStore) 上の watermark** として持たせる。Phase 3 引き継ぎの EventStore 配線と併せて実装する。

### Phase 4c 完了メモ (2026-07-13)

- **橋渡し方針の決定**: batch ↔ PDS は **PDS に batch/op-log コレクションを新設** (選択肢 A)。既存 snapshot レコード (node/edge/layout) へのアダプタ (選択肢 B) は clock/batch-id が落ち非可逆になるため不採用。既存 PDS データ破棄前提 (§0) なので新 lexicon を導入できる。
- **成果物**:
  - `atproto/types.ts`: `NSID.batch` (`app.conversensus.graph.batch`) + `BatchRecord` (actor/clock/timestamp/ops/createdAt。id は rkey として持ちボディに含めない)。
  - `atproto/collections.ts`: `batches` コレクション (put/get/list/delete)。
  - `atproto/batchMapper.ts`: `batchToRecord` / `recordToBatch` (往復非可逆なし) / `isBatchRecordValue` (外部境界ガード)。
  - `atproto/atprotoSyncProvider.ts`: `AtprotoSyncProvider implements SyncProvider`。push=putRecord (rkey=batchId, べき等) / pull=clock>cursor を clock 昇順 + cursor 単調前進 / subscribe=定期 poll で baseline 後の新規のみ配信。依存 (batch collection / scheduler) を DI しタイマー・PDS 非依存でテスト。
- **テスト**: 13 追加 (全 371 pass)。各 `.test.md` あり。in-memory batch collection + manual scheduler で決定論的に検証。
- **非破壊**: 既存 atproto コード (sync/mapper/branchState/poller) は未変更。新コレクションと provider を**追加**したのみ。既存 snapshot 同期の廃棄・外の層の provider 配線切替は後続。
- **4d / 後続へ引き継ぐ**:
  1. subscribe の手動 poll を Jetstream/firehose 購読へ (4d)。現状は `SUBSCRIBE_INTERVAL_MS` の暫定 polling。
  2. pull の「全件 list → JS filter」を rkey/コレクション範囲取得へ (4d, R3)。op-log は clock 単調なので rkey に clock を含める等で範囲取得可能。
  3. cidCache 永続化 (4d)。op-log では batch 不変なので CID 差分検出は不要になりうる (要検討)。
  4. `collections.batches` を `BatchCollection` として `AtprotoSyncProvider` に注入する実配線。旧 snapshot 同期 (syncSheetToAtproto / fetchSheetsFromAtproto) の退役。
  5. 外の層 (App/useEventStore) を provider (Null / Atproto) 経由へ切替。EventStore ↔ push/pull の配線。

### 実配線 W1 (サーバ側) 完了メモ (2026-07-13)

- **方針**: 実配線を「サーバ側 (W1) → クライアント側 (W2)」に分割。W1 はクライアントが消費する batch-append の HTTP 契約を先に確立する自己完結スライス。
- **保存モデルの帰結**: op-log では「集約は projection」。クライアントは既に shared の `projectBatches` を持つため、**サーバは batches の保存・配信に徹し projection しない**。
- **成果物**:
  - `src/server/src/eventStoreServer.ts`: `getEventStore()` — `DATA_DIR/events.db` を開く。解決パス単位でメモ化し、テストの `DATA_DIR` 差し替えに追随。DB を開く前に `mkdirSync` でディレクトリ保証。
  - `src/server/src/index.ts`: `POST /files/:id/batches` (batches 追記, べき等, 各要素を `BatchSchema` で検証) + `GET /files/:id/batches?since=<clock>` (clock 昇順・範囲取得)。zod を server 直接依存にせず shared の schema を使う。
  - `src/client/src/api.ts`: `pushBatches` / `fetchBatches` (薄い fetch ラッパー、テスト省略)。
- **テスト**: 6 追加 (全 377 pass)。`index.test.md` に節追加。
- **非破壊**: 既存の `/files` 系 (storage.ts) は未変更。旧 storage.ts の退役はクライアント移行 (W2) 後。
- **W2 へ引き継ぐ**: useEventStore/App が編集を `GraphEvent` でなく `Batch` として発行し、`pushBatches` (outbox 経由) と `fetchBatches`→`projectBatches` で読み書きするよう切替。Lamport clock の永続化・復元 (再起動後 max(clock)+1)。切替完了後に storage.ts / 旧 PUT /files を退役。
