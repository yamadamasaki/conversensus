# step1 W3 読み取り経路の移行 — 設計

> 位置づけ: Phase 4 実配線の W3。W2 (dual-write の tap) / W3a (Lamport clock 復元) 完了後の残作業のうち、
> 「ファイル読込を `fetchBatches`→`projectFile` に切替え、snapshot 読込を退役する」ための設計判断をまとめる。
> 上位方針は `deepse/architecture/step1.md` (D4: 操作ログを正典、集約は projection)。
>
> **改訂 (2026-07-13)**: architect レビュー (C1/C2/H1/H2/H3, M1-3, L1-2) と critic レビュー (C1/C2/H1/H2-new 他) を反映。
> - architect 反映: §3.4「既存 batch は genesis で吸収」の誤前提を撤回し pre-W3 op-log の破棄・再生成 (§3.5) を追加。
> - critic 反映 (2 巡): **genesis を local-only に単純化** (content-hash 完全決定論を廃止, H1-new)。genesis に予約 actor + **一意連番 clock** + snapshot canonicalization、hash 入力は ops のみ actor/timestamp 除外 (C1/C2-new/M-2)。想定アクターモデルを明示し `projectFile` を単純 LWW + 孤立防御に (H2-new)。構造操作の undo は既存 per-sheet undo と不整合のため step1 対象外 (M1-new/H-1)。cutover 状態機械 (破棄→genesis→seed) を規定 (M-1)。W3d5 (remote) は read-path から分離検討 (M-4)。branch 相互作用は W3d 着手前に要確認。
> - **critic 判定: REVISE → W3b は genesis 決定論仕様 (M-2) と並行度前提 (M-3) の確定を条件に着手可**。両者は本改訂に反映済み。

## 1. 問題 — 現状の op-log は「単一シートのグラフ内容」しか表せない

W2 で編集を op-log へ流す tap を配線したが、現状の語彙・射影・書き込み経路は次の範囲に留まる:

- **Op 語彙 (`unified.ts`, 15 種)**: `node.*` / `edge.*` のグラフ内容 op のみ。シート/ファイル構造の op が無い。
- **Batch (`unified.ts`)**: `id / actor / clock / timestamp / ops`。**シート scope (`sheetId`) を持たない**。`graphEventToBatch` (`toUnified.ts:282`) もシートを付与しない。
- **射影 (`projectBatches`, `project.ts:51`)**: `Batch[]` → **単一の `ProjectedGraph`**。`toSheet(graph, meta)` で 1 シートに変換。
- **書き込み経路の分裂 (レビュー C2)**:
  - node/edge 編集 → `useEventStore` → tap (`eventSyncTap.ts`) → op-log。
  - **シート/ファイル構造 (追加・削除・改名・順序) → `useFileSheetOperations.persistFile` → snapshot (ATProto + ローカル)**。op-log を一切通らない (`App.tsx:111` handleAddSheet、`useFileSheetOperations.ts:179-266`)。
- **presentation の未フィルタ (レビュー H1)**: `isSyncable` (`unified.ts:165`) は定義済みだが未使用。tap は空 ops のみスキップ (`eventSyncTap.ts:55`) するため、presentation op (`edge.setStyle`/`edge.setLabelOffset` 等) もローカル op-log に流入している。

一方 UI が扱う `GraphFile` (`schemas.ts:96`) は **複数シート + ファイルメタ + シートメタ + シート順序** を持つ。

**帰結**: 読み取り移行は「語彙拡張 + 大きな射影」だけでは済まない。**2 つの書き込み経路 (op-log と snapshot) を op-log に一本化**し、既にローカル op-log に書かれた **sheetId 無しの実 batch を安全に処理**する必要がある。

## 2. 設計目標と制約

- **D4 の完遂**: op-log を読み書き両経路の正典にし、`GraphFile`/`Sheet` を projection として導出する。
- **非破壊・dual-write 継続**: 既存 UI / undo-redo / snapshot 保存を壊さず段階移行。切替検証後に旧経路を退役。
- **既存データの保全**: 現行ファイルは snapshot が正典。移行時に **snapshot → 初期 batch (genesis)** で op-log を bootstrap。presentation を含めて取りこぼさない。
- **pre-W3 op-log の扱い**: W2 で書かれた sheetId 無し batch は snapshot 由来ではない。**破棄して snapshot から再生成**する (§3.5)。
- **genesis は local のみ (critic H1-new)**: genesis は**ローカルだけが実行**し、remote (PDS) へは通常の push 経路で送る。content-hash による local/remote 独立生成の完全決定論には依存しない (§3.4)。二重 genesis の危険は「remote では genesis しない」の 1 ルールで消える。
- **想定アクターモデル (critic L2-new)**: step1 は **単一ユーザー・複数端末の逐次編集を主**とし、同時編集は「コンフリクト可視化のみ」(D7)。tombstone GC や reorder reconcile は並行対応ではなく **「孤立データを表示から落とさない防御」** と位置づけ、実装・テストは通常系 (single-actor) を主とする。
- **決定論**: 射影は `clock → timestamp → id` 順 (既存 `orderBatches`)。多シートでもこの順序を保つ。

## 3. 設計判断

### 3.1 シート scope は Batch に付与する (optional)

**採用: `BatchSchema` に `sheetId: SheetIdSchema.optional()` を追加**。

- 1 ユーザー操作 (= 1 Batch) は単一シート内で完結する (group/paste も同一シート内。`toUnified.ts` の batch はシートをまたがない)。op ごとに持つ必要はなく batch レベルで十分・軽量。
- `graphEventToBatch(event, clock, sheetId)` へ拡張。tap は `activeSheetId` を渡す (`GraphEditor` が受領済み `App.tsx:191`、シート単位で key 済み `App.tsx:187`。配線は W3c2)。
- **file-level batch は `sheetId` を持たない** (構造 op のみの batch)。sheetId の有無ではなく **op カテゴリで content/structure を判別**する (レビュー L2)。

> 却下: op-level scope (op 肥大・冗長)。(file,sheet) ストリーム分割 (§6-B)。

### 3.2 語彙拡張 — file/sheet 構造 op と新カテゴリ

`OP_CATEGORY` は既に `structure` (node/edge のグラフ構造) を持つ。**file/sheet 構造は別カテゴリ `file` を新設**し、routing で graph 構造と区別する。

| op | カテゴリ | コンフリクト方針 (レビュー M1) |
|----|---------|------------------------------|
| `sheet.create` (`target: SheetId`, `name`, `description?`) | file | add-wins |
| `sheet.remove` (`target: SheetId`) | file | remove-wins + tombstone (射影で削除シートの batch を GC) |
| `sheet.setName` (`target`, `name`) | file | content 相当 = 可視化 (LWW だが差分は将来 UI で提示) |
| `sheet.setDescription` (`target`, `description?`) | file | content 相当 |
| `sheet.reorder` (`order: SheetId[]`) | file | layout 相当 = サイレント LWW。**ただし §3.3 で live シートと reconcile** |
| `file.setName` (`name`) | file | content 相当 |
| `file.setDescription` (`description?`) | file | content 相当 |

- `Category` に `file` を追加。`isSyncable`: `file` は**同期対象** (presentation のみローカル)。
- **`isSyncable` を実際に適用する** (レビュー H1/未使用の解消): remote (ATProto) provider へ push する際に presentation op を除外。ローカル op-log には presentation も残す (ローカル正典)。この配線は W3d5 (remote) で行う。

### 3.3 射影を `projectFile` (GraphFile) へ拡張

新 `projectFile(batches): GraphFile` (fileMeta も op から導出):

1. batch を **op カテゴリで分岐** (レビュー L2): `file` カテゴリ op → 構造 fold、それ以外 → シート content。
2. 構造 fold: `sheet.create`/`remove` で live シート集合、`*.setName/setDescription` でメタ、`file.setName/setDescription` でファイルメタ。**LWW で fold し最後の値を採る**だけの単純な射影とする (critic H2-new)。
3. content: batch を `sheetId` でグルーピングし、各シートを既存 `projectBatches` + `toSheet` で fold。削除済みシートの batch は **射影時に無視するだけ** (物理 GC はしない — single-actor では不要, critic H2-new)。
4. **シート順序の reconcile (レビュー H2, 防御目的)**: `sheets = reconcile(liveSheetSet, latestReorder)` — 最新 `sheet.reorder` の順に並べ、**order に無いが live なシートを決定論的順序 (create の clock 昇順) で末尾に追加**、削除済みは除く。これは並行編集対応ではなく **孤立シートを表示から落とさない防御**。テストは single-actor の通常系を主とする。
- 既存 `projectBatches`/`toSheet` は温存 (下位関数として再利用)。
- **将来の最適化 (レビュー M3)**: `openFile` は hot path (174x)、append-only で全 batch 再射影はコスト増。`branchLog` の commit オフセット機構 (`eventStore.ts:150`) を使った projection スナップショット/キャッシュを、op-log が唯一の読取源になる前 (W3e 前) に計画する。W3 本体の blocker ではない。

### 3.4 genesis (snapshot → 初期 batch) — local-only・presentation 込み

- 移行対象ファイルの初回オープン時、op-log が空なら `graphFileToBatches(file)` で genesis batch 群を生成し append。
  - 各シート: `sheet.create` + nodes/edges/layouts (`node.add`/`edge.add`/`node.setLayout`…)。
  - **presentation も必ず含める (レビュー H1)**: `edge.setStyle`/`edge.setLabelOffset` 等はスナップショットに保存済みのユーザーデータ。これを genesis しないと W3e の snapshot 退役で既存スタイル・ラベル位置が永久消失する。presentation op はローカル限定 (remote へは push しない)。
  - ファイル/シートメタ: `file.setName`/`sheet.setName` 等。
- **local-only genesis (critic H1-new)**: genesis は**ローカルだけ**が実行し、remote へは通常の push 経路で送る。local/remote が独立に同一 batch を生成する完全決定論 (content-hash) には依存しない。→ 「remote では genesis しない」の 1 ルールで二重 genesis 分岐を消す。これにより architect H3/M2 が要求した content-hash の完全決定論は不要になり、設計が単純化する。
- **予約 actor + 一意連番 clock (critic C2-new/M-2)**: genesis batch は `actor = "genesis"` の**予約アクター**に固定 (端末非依存)、clock は **genesis 専用の予約レンジで batch ごとに一意な連番**を割り当てる。同値 clock を作らないことで `orderBatches` の tiebreak (`clock → timestamp → id`, `project.ts:44`) が **timestamp に昇格しない** — wall-clock timestamp は端末間で異なるため、同値 clock だと fold 順が非決定になる (critic M-2)。ユーザー操作の採番 (予約レンジの後, tap の `seed = max(clock)`) と decoupling する。
- **決定論 ID の hash 入力 (critic M-2)**: genesis batch id を snapshot から導く際、**hash 入力は ops の内容 (各 op の branded target = NodeId/EdgeId/SheetId を含む) のみ**とし、**actor・timestamp は除外**する。各 op は一意の branded UUID を含むため実務上 hash 衝突は起きない。actor を含めると端末差で id が変わり二重生成の原因になるため必ず除外 (projection は actor を一切参照しない, `project.ts`)。
- **同一端末内の再 genesis べき等性 (critic C1-new)**: local-only なので hash の跨端末一致は不要だが、**同一端末で二重に genesis しないべき等性**は必要。genesis batch id を snapshot から決定論的に導く際、`SheetSchema` の `nodes`/`edges`/`layouts` 配列と `properties` (`z.record`) はシリアライズ順が不定 (`schemas.ts:83,90-93`)。→ genesis 前に **正規化 (canonicalization)** を定義: ノード/エッジを ID でソート、properties キーをソート、layout を対応付けでソート。この正規化を `graphFileToBatches` の第一責務とし、テストで固定する。
- genesis の clock 予約レンジは §3.5 の破棄・再生成とセットで「クリーンなログの先頭」から始める。

### 3.5 pre-W3 ローカル op-log の破棄・再生成 (レビュー C1) — 新規

W2 の tap (merged) は node/edge 編集ごとに **sheetId 無し・event 由来 ID の batch** をローカル SQLite に書き込み済み。これらは snapshot 由来でも決定論 ID でもないため genesis と衝突せず、cutover 時に `projectFile` が genesis batch (sheet-scoped) と stale batch (default-sheet) を二重 fold し **node 状態が重複・矛盾**する。

- 安全策は **pre-W3 のローカル op-log を破棄し snapshot から全面再生成 (genesis)** すること。snapshot が正典 (§2) なので破棄しても情報は失われない。
  - **注 (critic M-1 訂正)**: op-log は「誰も読んでいない」わけではない。W3a の `eventSyncTap.ensureRestored` (`eventSyncTap.ts:79`) が clock seed のため既にログを読んでいる。破棄の安全性は「snapshot が正典」から来るのであって「未読だから」ではない。
- **version-gated**: ストレージにスキーマ/バージョンマーカーを持たせ、W3 スキーマ未満のログを検出したら破棄→genesis を一度だけ実行。ID べき等性に依存せず明示的な移行ステップとする。marker の粒度 (per-DB / per-file_id。EventStore は 1 DB に複数 file_id を格納しうる) は W3d で確定 (critic L-2)。
- **cutover 状態機械 (critic M-1/L1)**: W3d の手順を厳密に順序化する — **(1) pre-W3 ログ破棄 → (2) genesis append (予約 clock レンジ) → (3) tap の `ensureRestored` を genesis 後に初回実行し `seed(max(clock))`**。tap の初回 pull が genesis 完了前に走らない配線を W3d の受け入れ条件とする。これを守らないと genesis batch の clock と tap の `tick` が衝突・逆行する。破棄前に snapshot が健在であることも確認。
- この破棄は W3d の cutover で行う (それまで dual-write で snapshot が正典)。

## 4. 移行・退役シーケンス (スライス分割・改訂)

| スライス | 内容 | リスク |
|---------|------|-------|
| **W3b** | 純ドメイン (shared): `Batch.sheetId?` + `file` カテゴリ + 構造 op 7 種 + `projectFile` (reorder reconcile・単純 LWW) + `graphFileToBatches` genesis (canonicalization・presentation・予約 actor/一意連番 clock 込み)。UI 未接続。ユニットテスト (OpKind/OP_CATEGORY/applyOp の網羅性を型・テストで固定 (critic M2-new); genesis が空 ops batch を作らないこと (`appendBatch` は空 ops を throw, `eventStore.ts:93`, critic L-3)) | 低 |
| **W3c1** | 構造の書き込み経路 (レビュー C2): シート/ファイル構造変更を op として発行。**採用案: 構造イベントを `GraphEvent` union に追加し `useEventStore` 経由へ**ルーティング (tap を自動獲得)。**undo 単位を先に決定 (critic M1-new): step1 では構造操作を undo 対象外**とする (現状 `handleDeleteSheet` 等は snapshot 差替で undo 非対応 → 退行なし)。`persistFile` の snapshot 書きは dual-write で併存 | 中 |
| **W3c2** | content を sheet-aware に: tap が `activeSheetId` を batch に付与 | 中 |
| **W3d** | 読み取り cutover: §3.5 の破棄→genesis (version-gated, 順序厳守) → `fetchBatches`→`projectFile`。snapshot はフォールバックとして一時併存 (dual-read 安全弁)。**実運用相当の batch 数で openFile レイテンシを計測 (critic M3-new)** | **高** (GraphEditor hot path) |
| **W3d5** | remote 統合 (レビュー H3): `AtprotoSyncProvider` を tap へ配線 + `isSyncable` で presentation 除外。**genesis は local-only なので remote は通常 push で受ける** (独立 genesis しない, critic H1-new)。**step1 の read-path から分離検討 (critic M-4): 2 台目デバイスの実機検証が要る難所なので Phase 4d と統合するか step2 送りにしてよい。W3d (ローカル cutover) は remote 無し (Local/NullSyncProvider) で完結させる** | 高 |
| **W3e** | 退役: snapshot 読込・PUT /files・storage.ts・ATProto snapshot 経路を撤去。**前提条件: presentation が op-log に保全済み (H1)** | 高 |

各スライスは branch → PR → approve → merge。W3d 着手前に実機 end-to-end (デーモン + ブラウザ) で projection 読取を検証。

### branch との相互作用 (critic 指摘・要確認)

`App.tsx` は undo/`GraphEditor` を `${sheetId}/${branchId}` でキーし、`branchLog.ts`/`merge.ts` (branch projection `branchSheet`) が既存。`projectFile` (ファイル全体) と branch (シート単位のログ分岐) の関係は本設計に未登場で、architecture O3 の持ち越し。**W3d の read-path cutover で branch projection を壊さない保証**を着手前に確認する (どのログ範囲を branchSheet が読むか)。step1 の当面のスコープ (単一ユーザー・複数端末) で branch を凍結扱いにするかも含め、W3d 設計時に決める。

## 5. リスクと検証

- **書き込み経路の一本化 (C2)** が最大の隠れ工数。構造 op を `GraphEvent` union に載せる設計を W3c1 で先に固める (**undo は step1 では対象外**と決定, critic M1-new)。
- **pre-W3 ログ破棄 (C1)** は一度きり・不可逆。version marker で厳密にゲートし、破棄 → genesis の順序を厳守、破棄前に snapshot が健在であることを確認。
- **genesis の単純化 (critic H1-new)**: local-only genesis。予約 actor `"genesis"` + 予約 clock レンジ + snapshot の canonicalization で同一端末内べき等。跨端末 content-hash 決定論には依存しない。
- **presentation 保全 (H1)**: genesis に presentation を含め、W3e の退役前提条件にする。
- **projectFile の単純さ (critic H2-new)**: 単純 LWW fold + 削除シートの射影時無視 (物理 GC なし) + reorder は孤立防御。テストは single-actor 通常系を主に、reorder 防御をエッジケースとして固定。
- **網羅性 (critic M2-new)**: 新 op 7 種を `OP_CATEGORY` (`Record<OpKind,Category>`)・`applyOp` の switch・`isSyncable` に漏れなく追加。W3b テストで型・実行両面から固定。
- **GraphEditor / useFileSheetOperations は hot path**。W3d は dual-read 安全弁で退行時に snapshot へ戻せるようにする。projection 負荷は batch 数に線形 → W3d e2e でレイテンシ実測 (critic M3-new)。
- **incremental pull (レビュー L1)**: `since` フィルタは `clock > since` (clock は非一意, `index.ts:225`)。W3d の incremental 読取は `seq` (PK, `eventStore.ts:47`) か `(clock,id)` を cursor にする。
- **検証**: 各スライスでユニットテスト (.test.md 付き) + W3d/W3d5/W3e は実機 end-to-end。lint/typecheck/test 全パス。

## 6. 代替案と却下理由

- **A. メタは snapshot 据置、グラフ内容のみ projection (dual-model)**: `GraphFile` が二重正典になり D4 に反する。storage.ts を退役できず移行が完了しない。中間緩和策としては可だが最終形にしない。
- **B. op-log を (file, sheet) 単位に分割**: サーバ/ATProto のコレクション分割増、ファイルメタ・順序を別ストリーム管理する複雑さ。batch scope で足りるため不採用。
- **C. 読み取り移行を見送り dual-write のまま**: op-log が書かれるが誰も読まない状態が続き D4 が名目のみに。step1 の目的を満たさない。
- **構造 op の書き込み経路 (W3c1) 内での代替**: (a) `GraphEvent` union 経由 = 採用 (tap 自動、undo は step1 対象外)。(b) `useFileSheetOperations` に専用 emitter を置き batch を直接 append = 却下。
- **genesis の跨端末決定論 (content-hash single genesis)**: architect が提案したが critic H1-new で却下。local-only genesis + 通常 push で二重 genesis 分岐を防げるため、正規化・hash・actor 一致の複雑さを負う必要がない。

## 7. 次アクション

1. **本改訂設計のユーザー承認** (architect + critic の 2 巡レビュー反映済み。critic 判定 REVISE の着手条件 M-2/M-3 は反映済み)。
2. W3b (語彙拡張 + `projectFile` + genesis、純ドメイン・最低リスク) から着手。W3b の実装前 blocker (critic): (a) snapshot canonicalization 仕様、(b) 予約 actor + 一意連番 clock、(c) hash 入力定義 — いずれも §3.4 に反映済みで W3b の `graphFileToBatches` 仕様として実装する。

## 8. 後続スライスへ持ち越す未解決点 (open questions)

- **構造 op の undo 責務 (H-1)**: step1 は「構造操作 undo 対象外」で確定。将来 undo を求めるならファイルレベルの別 undo レーンが必要 (per-sheet の `useEventStore` とは別)。W3c1 で再確認。
- **W3d5 (remote genesis 統合) を step1 に残すか (M-4)**: 2 台目デバイスの実機検証が必要。並行度前提 (§2) と連動して W3d 完了時に判断。
- **branch (branchLog/merge) と projectFile の関係**: O3 持ち越し。read-path cutover で branchSheet が読むログ範囲を W3d 着手前に確認。
- **pre-W3 ログ破棄の粒度と version marker の実装形 (L-2)**: per-DB / per-file_id。W3d で確定。
