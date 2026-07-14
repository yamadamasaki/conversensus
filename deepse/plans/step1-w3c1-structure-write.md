# step1 W3c1 — 構造の書き込み経路 (op-log 化) — 設計

> 位置づけ: W3 (読み取り経路移行) のスライス W3c1。上位設計は `deepse/plans/step1-w3-read-path.md` §4 の W3c1 行
> 「シート/ファイル構造変更を op として発行。採用案: 構造イベントを `GraphEvent` union に追加し tap 経由へ。
> undo は step1 対象外。`persistFile` の snapshot 書きは dual-write で併存」。
> W3b (語彙拡張 + `projectFile` + genesis, #156 merged) 完了後の続き。

## 1. 問題 — 構造操作が op-log を通らない

現状、編集の書き込み経路は 2 つに分裂している (W3 設計 C2):

- **ノード/エッジ編集**: `GraphEditor` → `useEventStore.dispatch` → `onEvent` = `syncTap.record` → op-log (W2 で配線済)。
- **シート/ファイル構造** (追加・削除・改名・説明): `App`/`useFileSheetOperations` の各ハンドラ → `persistFile(GraphFile)` → **snapshot (ATProto + ローカル) のみ**。op-log を一切通らない。

構造操作を op-log の正典 (D4) に載せるのが W3c1 の目的。

### 1.1 核心の障害 — tap が GraphEditor の中にある

`syncTap` は `GraphEditor.tsx:363` の `useEventSyncTap(file.id)` で**生成**され、`useEventStore` の `onEvent` に渡っている。しかし:

- `GraphEditor` は `${sheetId}/${branchId}` で key され、**シート切替で remount** する (`App.tsx:187`)。→ tap がシートごとに作り直され、Lamport clock / Outbox がリセットされる (W3 の伏在課題)。
- 構造操作は `App`/`useFileSheetOperations` の**ファイルレベル**で起き、GraphEditor の外にある。GraphEditor が mount されていない状況 (シート未選択等) もある。

→ 「GraphEvent union に載せて tap 経由」を実現するには、**tap を GraphEditor の外 (ファイル寿命) へ持ち上げる**必要がある。これが W3c1 の本質。

## 2. 方針 (承認済: approach 1 — tap を持ち上げる)

`EventSyncTap` を **ファイル単位で 1 つ**だけ持ち、content と structure の両方をそこへ流す。構造操作は「専用 emitter で batch を直接 append」(W3 設計が却下した案 b) ではなく、**構造 `GraphEvent` → `graphEventToOps` → file op** という統一経路 (採用案 a) に載せる。

### 2.1 tap の配置

- `useEventSyncTap(activeFile?.id)` を **`useFileSheetOperations` の中**へ移す (activeFile を所有しているため自然)。`activeFile.id` で key し、ファイルを開いている間 clock / Outbox を維持する。
  - 副次的利益: シート切替で tap が作り直されなくなり、clock の連続性が改善する (W3b genesis の予約 clock → W3a restore の seed → 以降の tick が一直線に繋がる)。
- `useFileSheetOperations` は `syncRecord: (event: GraphEvent) => void` を公開する (activeFile が無ければ no-op)。
- **content 経路**: `App` は `fileOps.syncRecord` を `GraphEditor` に prop で渡し、GraphEditor 内の `useEventSyncTap` 生成を廃止 (`useEventStore(..., syncRecord)`)。挙動は同一、生成場所だけ持ち上げ。
- **structure 経路**: `useFileSheetOperations` の構造ハンドラが `syncRecord(structureEvent)` を呼ぶ (persistFile と dual-write)。`handleAddSheet` は branchOps に依存するため `App` に残し、`fileOps.syncRecord` を呼ぶ。

### 2.2 構造 GraphEvent と toUnified 変換

`EventBase['category']` に `'file'` を追加し、構造イベント型を `GraphEvent` union へ追加する。`graphEventToOps` で W3b の file op へ変換する:

| GraphEvent | → file op | 発火元 |
|-----------|----------|--------|
| `SHEET_CREATED` (sheetId, name, description?) | `sheet.create` | handleAddSheet (App) |
| `SHEET_REMOVED` (sheetId) | `sheet.remove` | handleDeleteSheet |
| `SHEET_RENAMED` (sheetId, name) | `sheet.setName` | handleSaveSheetSettings |
| `SHEET_DESCRIBED` (sheetId, description?) | `sheet.setDescription` | handleSaveSheetSettings |
| `FILE_RENAMED` (name) | `file.setName` | handleSaveFileSettings |
| `FILE_DESCRIBED` (description?) | `file.setDescription` | handleSaveFileSettings |

- 構造イベントは **`useEventStore.dispatch` を通さない**。`syncRecord` (= `tap.record`) を直接呼ぶ。→ `applyEvent` / `invertEvent` に構造イベントの case は不要 (nodes/edges を触らない)。
- **undo 対象外 (step1)**: dispatch を通さないので undo スタックに乗らない。現状の構造操作も snapshot 差替で undo 非対応 → **退行なし**。
- `graphEventToBatch` は sheetId を付与しない → file 構造 batch は `sheetId` 無し (§3.1 と整合)。
- 設定変更 (name/description 同時更新) は **変化した項目のみ** イベント化する (無変化なら発火しない = 空 batch 回避)。

### 2.3 スコープ

**含む**: 開いているファイルの sheet 追加/削除/改名/説明、file 改名/説明。

**含まない (後続へ)**:
- **ファイル新規作成 (`handleCreate`) / ファイル削除 (`handleDeleteFile`)**: ファイル寿命の管理。新規ファイルの op-log bootstrap は genesis (W3d cutover) の領分。W3c1 は「開いているファイルの構造変更」に限定。
- **sheet.reorder**: 現状 UI トリガが無い。語彙 (W3b) にはあるが配線は reorder UI 追加時。
- **Batch.sheetId の server 永続化**: file 構造 batch は sheetId 不要のため W3c1 では非ブロッカー。content の sheet-aware 化 (W3c2) で eventStore に列追加。

## 3. clock 連続性 (最重要)

ファイル単位で tap が 1 つ = **Lamport 発番源が 1 つ**。W3b genesis の予約連番 clock → W3a の `seed(max(clock))` → structure/content の `tick()` が単一系列で単調増加する。案 b (構造専用 tap を別置き) だと発番源が 2 つになり `orderBatches` の fold 順が非決定になる (W3b が timestamp tiebreak を避けた意図が崩れる) ため却下。

## 4. branch との相互作用

- 構造操作 (sheet/file) は**ファイルレベル**で branch と独立。branch モードか否かに関わらず `syncRecord` で op-log へ流す。
- content 編集は現状 branch モードでも `GraphEditor` の `useEventStore.onEvent` 経由で既に tap に流れている。tap を持ち上げても**この挙動は不変** (onEvent の呼び元は変わらない)。
- branch projection (`branchSheet`) と `projectFile` の関係は W3d 着手前の確認事項 (O3 持ち越し)。W3c1 は書き込みのみで読み取り cutover をしないため、ここは非ブロッカー。

## 5. 変更ファイル

- `src/client/src/events/GraphEvent.ts`: `EventBase['category']` に `'file'` 追加、構造イベント型 6 種 + union 追加。
- `src/client/src/events/toUnified.ts`: `graphEventToOps` に構造イベント → file op の変換 6 種追加。
- `src/client/src/hooks/useFileSheetOperations.ts`: tap を内蔵 (`useEventSyncTap(activeFile?.id)`)、`syncRecord` 公開、構造ハンドラで dual-write emit。
- `src/client/src/hooks/useEventSyncTap.ts`: `fileId` が null 可 (未オープン時 no-op tap) に対応。
- `src/client/src/App.tsx`: GraphEditor へ `syncRecord` を prop 渡し、`handleAddSheet` で emit。
- `src/client/src/GraphEditor.tsx`: 内部 `useEventSyncTap` 廃止、prop の `syncRecord` を `useEventStore` に渡す。

## 6. テスト

- **toUnified**: 構造イベント 6 種が対応する file op に変換されることを単体テスト (`toUnified.test.ts`)。無変化イベントが空 ops を生む場合の扱いも固定。
- **useFileSheetOperations**: 構造ハンドラが fake provider (or fake tap) へ期待する batch を emit しつつ persistFile (snapshot) も呼ぶ (dual-write) ことをテスト。設定変更で変化項目のみ emit されることを固定。
- 各テストに `.test.md` を付す。
- 既存テスト全パス + typecheck + lint。W3c1 は書き込み経路のみ (読み取りは snapshot のまま) なので e2e cutover 検証は W3d。

## 7. 検証 (dual-write の非破壊性)

- 構造操作後も `persistFile` の snapshot 書きは従来通り動く (既存挙動を壊さない)。
- op-log には file 構造 batch が積まれる (LocalServerSyncProvider → server eventStore、sheetId 無しで appendBatch)。
- 読み取りは W3d まで snapshot が正典 → UI 表示は不変。

## 8. 持ち越し

- ファイル新規作成/削除の op-log 化 (genesis と併せ W3d)。
- sheet.reorder の配線 (reorder UI 追加時)。
- Batch.sheetId の server 永続化 (W3c2)。
- branch projection と projectFile の関係確認 (W3d 着手前)。
