# step1 W3d 読み取り cutover — 設計

> 位置づけ: Phase 4 実配線 W3 の **W3d**。W3b (純ドメイン: `projectFile`/`graphFileToBatches`)・
> W3c1 (構造書込経路 op-log 化)・W3c2 (content の sheet-aware 化) 完了後の残作業。
> ファイル読込を snapshot から `fetchBatches`→`projectFile` へ切替え、op-log を読み書き両経路の
> 正典にする (D4 の完遂に向けた**最終手前**の一手)。snapshot 退役は次の W3e。
>
> 上位設計: `deepse/architecture/step1.md` (D4) / `deepse/plans/step1-w3-read-path.md` (§3.4/§3.5/§4/§8)。
> 本書は W3-read-path が W3d 着手前に残した 4 つの持ち越し (§8) をコード実態に基づいて確定する。
>
> **リスク: 高**。pre-W3 ログ破棄は不可逆。GraphEditor は hot path。慎重に段階化する。

## 1. 現状把握 (コード実態)

W3d の判断はすべて以下の実態に立脚する。

- **読み取りは snapshot 経由** (`useFileSheetOperations.ts:102` `openFile`): `fetchFileFromAtproto(id)` → 失敗時 `fetchFile(id)`。いずれも `GraphFile` スナップショット (server `storage.ts` / ATProto レコード)。op-log は読んでいない。
- **op-log は既に存在するが不完全**: W2 tap 以降、node/edge 編集と (W3c1/W3c2 で) 構造編集が `events.db` へ dual-write されている。しかし**初期状態は snapshot にしか無い** — op-log は「W2 以降の増分」だけ。→ **全既存ファイルが genesis 対象**であり、cutover では既存 op-log を全破棄して snapshot から作り直す (§4)。
- **`events.db` は単一 DB に全 file_id を格納** (`eventStoreServer.ts` シングルトン、`batches.file_id`)。snapshot は別系統 (`storage.ts`)。→ version marker は **per-file_id** が自然 (§3.2)。
- **サーバは snapshot と op-log の両方を持つ** (`index.ts:90` `readFile` / `index.ts:213` `getEventStore`)。→ discard→genesis を**サーバ側 1 トランザクションで原子的に**実行できる (§3.1)。
- **`projectFile` / `graphFileToBatches` は W3b で実装済・テスト済** (`project.ts:286` / `genesis.ts:194`)。読取に必要なドメイン部品は揃っている。
- **branch UI は旧 `branchState.ts` (PDS レコード複製方式) 経由** (`useBranchOperations.ts`)。ログ分岐 `branchLog.ts` (O3 成果) は shared に定義済みだが **UI 未配線**。branch は op-log と交わっておらず、かつ **ATProto/PDS 依存 = remote 機能**。→ W3d (local-only) では branch は駆動されない (§3.3)。
- `fetchBatches` は `clock > since` フィルタ実装済 (`index.ts:225`, `api.ts:81`)。全取得も可。

## 2. 目標と非目標

**目標**:
- trunk (非 branch) のファイル読込を `projectFile(fetchBatches(id))` に切替える。
- pre-W3 op-log を version-gated で一度だけ破棄し、snapshot から genesis で再生成する (§3.5 of W3-read-path)。
- snapshot 読込を**フォールボードとして併存** (dual-read 安全弁)。退行時に即座に戻せる。
- 実運用相当の batch 数で openFile レイテンシを実測し、cache の要否を判断する。

**非目標 (W3d では触らない)**:
- snapshot 書込 (`persistFile` / PUT /files / ATProto snapshot) の退役 → **W3e**。dual-write は継続。
- remote (ATProto) への op-log 配線・presentation 除外 → **W3d5**。W3d は Local/Null provider で完結。
- branch の op-log 化 (`branchLog.ts` の UI 配線) → **step2**。W3d では branch を凍結 (§3.3)。
- 構造操作の undo (step1 対象外で確定済)。

## 3. 設計判断 (W3-read-path §8 の 4 持ち越しを確定)

### 3.1 discard→genesis は**サーバ側**で実行する (2026-07-15 ユーザー合意)

**採用: サーバ側 lazy migration**。読み取り要求時、サーバが per-file marker を検査し、W3 未満なら 1 トランザクションで「破棄→genesis→marker 更新」を実行してから batches を返す。

```
openFile(id)
  → GET /files/:id/batches            (client)
     [server] marker(file_id) < W3 ?
       tx {
         DELETE FROM batches WHERE file_id = ?      // pre-W3 ログ破棄
         append graphFileToBatches(readFile(id))    // snapshot → genesis
         upsert marker(file_id) = W3_SCHEMA_VERSION
       }
     return getBatches(file_id)
  → projectFile(batches, id) → GraphFile   (client)
```

- **原子性**: 破棄→genesis→marker がひとつの SQLite トランザクション。W3-read-path §3.5 の「破棄→genesis の順序厳守」が**構造的に保証**される (途中失敗はロールバックし marker 未更新 = 次回再試行)。
- **snapshot 健在の確認**: genesis は `readFile(id)` (snapshot) を入力とする。snapshot が無ければ migration せず現状維持 (op-log が既にあればそれを返し、無ければ空)。破棄の前提「snapshot が正典」が入力の存在で担保される。
- **却下したクライアント側案**: snapshot 取得→`graphFileToBatches`→discard endpoint→pushBatches の多段。round-trip とレース窓が増え、破棄用エンドポイントの新設 (誤爆リスク) が要る。サーバに両データが揃う以上、原子トランザクションに勝る利点がない。
- **Lamport seed の順序** (W3-read-path §3.5 の cutover 状態機械 step 3): クライアント tap の `ensureRestored` は初回 pull で `seed(max(clock))` する (`eventSyncTap.ts`)。migration は openFile の read で完了しているため、その後に走る tap の初回 pull は **genesis batch の max(clock) を必ず観測**する。→ 状態機械の (1)(2) はサーバ tx 内、(3) は client tap が read 後に seed、で順序が自然に閉じる。

### 3.2 version marker は **per-file_id**

- `events.db` は単一 DB・複数 file_id。migration の単位は「ファイルを開くとき」= file 単位。→ marker も per-file_id。
- **実装形**: `events.db` に marker テーブルを新設。

```sql
CREATE TABLE IF NOT EXISTS file_migrations (
  file_id        TEXT    PRIMARY KEY,
  schema_version INTEGER NOT NULL
);
```

- `W3_SCHEMA_VERSION = 1` (op-log 正典スキーマの初版) を定数化。marker 不在 or `< W3_SCHEMA_VERSION` を「未 migration」と判定。**ヒューリスティック (sheetId 無し batch の検出等) には依存しない** — 明示 marker で判定する (W3-read-path §3.5)。
- **新規作成ファイルも同一経路で吸収**: `createFile` 直後のファイルは marker 不在 → 初回 read で snapshot (空シート 1 枚) から genesis される。既存/新規で分岐しない。

### 3.3 branch は**凍結して据え置き** (2026-07-15 ユーザー合意)

W3-read-path §8「branch と projectFile の関係」の確定。

- **branch は remote(PDS) 依存で W3d(local-only) では駆動されない**。`useBranchOperations` は `fetchBranchSheetFromPds`/`syncBranchSheetToAtproto` (ATProto) を使う。W3d は Local/Null provider で完結するため、branch 経路はそもそも動かない。
- **cutover は trunk 読取のみ切替える**:

```
activeBranch == trunk/null → projectFile(op-log)        [W3d 新経路]
activeBranch != trunk      → fetchBranchSheetFromPds     [従来のまま・不変]
```

- **受け入れ条件**: W3d の read cutover が `branchState.ts`/`useBranchOperations` のコードに一切変更を加えないこと。trunk↔branch トグル (`App.tsx:196` の `graphKey`) が従来通り動くこと。
- **既知の割り切り (step1 スコープ)**: branch merge は snapshot (`syncBranchSheetToAtproto`→最終的に trunk snapshot) に書く一方、trunk 読取は op-log projection になる。両者の整合は step1 では**取らない** — branch 操作の結果は op-log に反映されず、snapshot にのみ残る。W3d は snapshot を dual-write で維持する (§3.4) ので snapshot 上では従来通り整合する。**op-log と branch の統合は `branchLog.ts` を UI 配線する step2 の課題**として明示的に繰り延べる。
- W3e (snapshot 退役) の**前提条件に「branch の op-log 化 (step2) 完了」を追加**する — snapshot を消すと branch が壊れるため。W3-read-path §4 の W3e 前提 (presentation 保全) に本項を加える。

### 3.4 dual-read 安全弁 — フラグで snapshot にフォールバック

- **読取ソースをフラグで切替える**。openFile が op-log 読取に失敗 (projectFile が throw / batches 取得失敗) したら snapshot にフォールバックし、コンソール警告を出す。
- **明示フラグ**: クライアントに `READ_FROM_OPLOG` (env / 定数) を持たせ、`false` で従来の snapshot 読取に即時退行できる。W3d マージ後の実機検証中に問題が出たら flag off で戻す。
- **snapshot は dual-write 継続** (§2 非目標): `persistFile` を残すため、flag off で戻した snapshot は常に最新。安全弁が「戻せる」ことを保証する。
- **フォールバック判定**: op-log が空 (genesis も snapshot も無い真の新規/欠損) の場合は projectFile が空 GraphFile を返す。「空」と「読取失敗」を区別し、空は正常・失敗のみフォールバックする。

### 3.5 レイテンシ実測 — cutover の受け入れゲート

- **計測対象**: `projectFile(batches)` 単体 と openFile end-to-end (fetch + project)。
- **データ規模**: 合成 batch で N = 100 / 500 / 1,000 / 5,000。マルチシート (例: 5 シート) 構成も含める。
- **予算 (暫定)**: 典型ファイル (数百 batch) で projectFile < 50ms、openFile 体感 < 200ms。超過したら §3.6 の cache を W3d 内で導入するか、W3d を分割して cache を先行する。
- **ベンチは投棄可の script** (`*.bench.ts` かテスト内) で回し、数値を PR に記録する (W3-read-path critic M3-new)。

### 3.6 projection cache (レイテンシ超過時のみ)

- append-only ログの全 batch 再射影は batch 数に線形。hot path (openFile) では超過しうる。
- **一次案**: `branchLog` の commit オフセット (clock) を利用した projection スナップショット/キャッシュ。「clock ≤ C までの projection」を保存し、以降の増分だけ fold する。
- **W3d の blocker ではない**: §3.5 の実測が予算内なら cache は W3e 前 (op-log が唯一の読取源になる前) に回してよい。予算超過時のみ W3d 内で導入。

## 4. cutover 状態機械 (確定版)

W3-read-path §3.5 の状態機械を W3d の実装契約として確定する。

| # | 主体 | 動作 | 保証 |
|---|------|------|------|
| 1 | server (tx) | `marker(file_id) < W3` を検出 | 明示 marker、ヒューリスティック非依存 |
| 2 | server (tx) | `DELETE batches WHERE file_id` → `append graphFileToBatches(snapshot)` → `marker = W3` | 破棄→genesis→marker が原子的。失敗時ロールバック=次回再試行 |
| 3 | server | migration 後の `getBatches(file_id)` を返す | genesis batch を含む完全ログ |
| 4 | client | `projectFile(batches, id)` で `GraphFile` を構築、`setActiveFile` | 読取が op-log 正典に |
| 5 | client tap | 初回編集で `ensureRestored` → `seed(max(clock))` | genesis の clock を観測してから採番再開。逆行なし |

**不変条件**: step 2 (genesis) は step 5 (tap seed) より必ず先。サーバ read が genesis を確定させてからクライアントが projection→編集に入るため、配線上自然に成立する。テストでこの順序を固定する。

## 5. 実装スライス

W3d 自体を小さく分割し、各段でテスト・検証を挟む。

| スライス | 内容 | リスク |
|---------|------|-------|
| **W3d-1** | server: `file_migrations` テーブル + `W3_SCHEMA_VERSION` 定数 + `migrateFileToOplog(fileId)` (破棄→genesis→marker を tx で)。GET /files/:id/batches が read 前に lazy migration を呼ぶ。**snapshot は `readFile` から取得**。ユニットテスト (marker 不在→genesis 実行、marker 済→no-op、snapshot 欠損→skip、再入べき等) | 中 |
| **W3d-2** | client: `openFile` を `READ_FROM_OPLOG` フラグ下で `fetchBatches`→`projectFile` に切替。フラグ off / 失敗時は snapshot フォールバック。`handleCreate` も同経路に寄せる (作成直後の read で genesis)。ユニット/結合テスト (フラグ on/off、フォールバック、空ファイル) | **高** (hot path) |
| **W3d-3** | レイテンシ実測 (§3.5) + 予算判定。超過時のみ §3.6 cache。数値を PR 記録 | 低 (計測) |
| **W3d-4** | 実機 end-to-end (デーモン + ブラウザ): 既存ファイルを開き migration→projection 表示、編集→再オープンで一致、branch トグルが従来通り、flag off で snapshot 復帰。screenshot/手順を記録 | 高 (統合) |

各スライスは branch → PR → approve → merge。W3d-4 (実機検証) の合格を W3d 完了条件とする。

## 6. リスクと検証

- **pre-W3 ログ破棄は不可逆**: サーバ tx で marker ゲート。genesis 入力 (snapshot) の存在を破棄の前提条件にし、無ければ破棄しない。破棄前に snapshot をバックアップする運用手順を W3d-4 に含めるか検討。
- **hot path 退行**: dual-read フラグ (§3.4) で即座に snapshot へ戻せる。W3d-2 マージ後は flag on の実機検証期間を設け、問題があれば off。
- **projection 決定性**: `projectFile` は `orderBatches` (clock→timestamp→id) で決定論。genesis の予約 actor/一意連番 clock (W3b 済) で fold 順が端末非依存。W3d では既存テストの回帰確認。
- **branch を壊さない** (§3.3): read cutover が branch コードに触れないことを差分レビューで確認。trunk↔branch トグルの手動確認を W3d-4 必須項目に。
- **genesis べき等**: 同一 file を二重 migration しない (marker)。marker 更新前にクラッシュしても、破棄も未コミットなので再試行で回復 (tx 原子性)。
- **incremental read** (W3-read-path L1): W3d の openFile は全取得 (`fetchBatches(id)` since 無し)。増分 pull (tap の seed 用) は既存の `clock > since` を使うが、cursor の非一意性は W3d では顕在化しない (全取得のため)。remote 増分は W3d5。
- **検証**: 各スライスにユニットテスト + `.test.md`。W3d-4 は実機 e2e。lint/typecheck/test 全パス。

## 7. W3e / W3d5 への申し送り

- **W3e (snapshot 退役) の前提条件を更新**: (a) presentation が op-log に保全済 (W3-read-path H1)、(b) dual-read フラグ撤去可能なだけの実機実績、**(c) branch の op-log 化 (step2) 完了** ← §3.3 で新規追加。(c) が未了なら snapshot を消せない。
- **W3d5 (remote)**: genesis batch は local-only だが、tap 経由で remote へ通常 push される必要がある。genesis batch が outbox に載って ATProto へ流れる配線を W3d5 で確認 (presentation は `isSyncable` で除外)。
- **step2 (branch op-log 化)**: `branchLog.ts` を UI 配線し、`branchState.ts` (旧 PDS 複製) を退役。branch と projectFile の統合はここで初めて成立する。2 台目デバイス実機検証を伴う難所。

## 8. 未解決点 (W3d 実装中に確定)

- ~~レイテンシ実測の結果次第で §3.6 cache を W3d に含めるか W3e 前送りか (§3.5 の予算判定)。~~ → **W3d-3 で確定 (§9)。cache 不要**。
- 破棄前 snapshot バックアップの要否・運用形 (§6)。単一ユーザー・ローカルなので storage.ts の JSON が残るが、明示バックアップ手順を W3d-4 で判断。
- ~~`handleCreate` 直後の read 経路統一の具体 (作成レスポンスをそのまま使うか、必ず fetchBatches で読み直すか) — W3d-2 で確定。~~ → W3d-2 で fetchBatches 読み直しに統一済。

## 9. W3d-3 レイテンシ実測結果 (2026-07-16)

**結論: projection cache (§3.6) は不要。W3d-2 の op-log 読取 cutover を予算内で受け入れる。**

- **計測**: `projectFile(batches, fileId)` 単体。合成 batch (genesis + 1 op/batch の増分編集) を N 段階で生成し、warmup 5 回後に 50 回計測の median。実行環境 macOS arm64 / Bun v1.3.8。ベンチは `src/shared/src/events/projectFile.bench.ts` (投棄可・CI 非搭載)。
- **予算 (§3.5)**: 典型ファイル (数百 batch) で projectFile < 50ms。

| N (batch) | 1 sheet (200 nodes base) | 5 sheets (100 nodes/sheet base) |
|-----------|--------------------------|----------------------------------|
| 100       | 0.15ms                   | 0.23ms                           |
| 500       | 0.22ms                   | 0.28ms                           |
| 1,000     | 0.27ms                   | 0.36ms                           |
| 5,000     | 0.77ms                   | 0.93ms                           |

- **予算比**: 数百 batch (典型) で **0.2ms 前後 = 予算の 1/200 以下**。最悪の N=5,000 でも 1ms 未満。
- **ヘッドルーム確認 (単一シート・極端規模)**: N=10,000 → 1.5ms、N=20,000 → 2.5ms、N=50,000 → 5.9ms。batch 数に**線形** (約 0.12ms/1,000 batch) で、50,000 batch でも予算の 1/8。
- **判定**: 全ケースで予算内、かつ実運用が到達しうる規模では圧倒的余裕。§3.6 の projection cache は W3d でも W3e 前でも**導入不要**。将来 op-log が数万 batch/ファイルに達し、かつ openFile の体感が問題化した時点で再検討する (線形なので予測可能)。
- **openFile end-to-end の扱い**: fetch (HTTP + SQLite) は I/O 律速で projection の CPU コストとは別軸。projection が支配項でないことが本計測で確定したため、体感悪化が出た場合の一次被疑は fetch/転送側であり projection cache ではない。end-to-end 体感の合否は実機で W3d-4 に委ねる。
