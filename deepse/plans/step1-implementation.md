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
| 論理時刻の実体 | Lamport / wall-clock / hybrid。LWW の順序付けに使用 | Phase 1 冒頭 (Lamport 推奨) |
| O1 ストレージ実体 | JSON / SQLite / IndexedDB | Phase 3 冒頭。O2 (配布形態) と連動 |
| 複合イベントの正規化 | grouping/paste を基本 ops に分解するか複合で運ぶか | Phase 0 の結論次第 |
