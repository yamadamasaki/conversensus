# O3 Spike レポート: ブランチ = 操作ログの分岐

> 日付: 2026-07-12 / Phase: 0 ([step1 実装計画](../plans/step1-implementation.md))
> PoC: `src/client/src/spikes/o3/branchAsLog.ts` + `.spike.test.ts` (投棄前提)

## 判定: ✅ **Go**

仮説「ブランチ = base offset + 追記イベント列 / コミット = ラベル付きオフセット / マージ = ブランチ ops を trunk へ追記し D7 ルールで解決」は成立する。最大リスクと見ていた**複合イベント (group/paste) の sync 語彙への載せ替えも分解で成立**したため、Partial ではなく Go。

Phase 1 (統一語彙) に進んでよい。

## 検証タスクの結果

| # | 検証 | 結果 |
|---|---|---|
| 1 | base + 追記列からブランチ sheet を projection | ✅ `project()` が clock 昇順の畳み込みで状態を導出。base とブランチ ops の連結だけでブランチ状態が得られる |
| 2 | マージ: structure=OR-Set / content=対立検出 / layout=静かな LWW | ✅ content の並行変更を 1 件の Conflict として検出しつつ LWW 確定。layout は Conflict に入れず LWW のみ。新規ノードはマージ後も保持 |
| 3 | 複合イベント (group/paste) を基本 op 列に分解 | ✅ `decomposeGroup` = node.add(group)+layout.set+N×node.setParent、`decomposePaste` = N×node.add+M×edge.add。projection で復元 |
| 4 | branchState.ts の解体マップ | 下表 |

## branchState.ts (969行) 解体マップ

現行は**レコード複製方式** (rkey `trunk_`/`{branchId}_`)。イベントログ分岐へ移す際の 13 公開関数 + 定数の仕分け:

| 現行シンボル | 分類 | 移行方針 |
|---|---|---|
| `computeOperations` | **残す (要拡張)** | state diff → ops は UI diff 表示に有用。**layout を含めるよう拡張** (D7、現状 L102 で除外) |
| `BRANCH_STATUS` / `Branch` / `Commit` 型 | **残す (再定義)** | ブランチ lifecycle は継続。`Commit` に log offset (clock) を持たせ、`Branch` = base + ops へ再定義 |
| `fetchBranchesForSheet` | 退避 | PDS I/O → sync-provider (branch メタの pull) |
| `fetchCommitsForBranch` | 退避 | PDS I/O → sync-provider (commit メタの pull) |
| `updateBranchStatus` | 退避 | branch メタ更新 → sync-provider |
| `createMergeRecord` | 退避 | merge マーカー書き込み → sync-provider |
| `fetchBranchSheetFromPds` | **廃棄** | ブランチ sheet はログの projection。PDS からのレコード読みは event pull に置換 |
| `syncBranchSheetToAtproto` | **廃棄** | rkey プレフィックス付きレコード書き込み → `push(events)` に置換 |
| `mergeBranchToTrunk` | **廃棄** | レコード複製マージ → ログマージ (本 PoC の `merge`) に置換 |
| `createMainBranch` | **廃棄** | trunk レコード生成 → ログ初期化に読み替え |
| `createBranch` | **廃棄** | レコード複製でブランチ生成 → base offset の記録のみに |
| `deleteBranchWithRecords` | **廃棄** | プレフィックス付きレコード一括削除 → 不要 (レコード複製をやめるため) |
| `createCommit` | **概念維持・再ホーム** | commit = ラベル付きオフセット。メタ書き込みは sync-provider へ |

→ **7 関数を廃棄、4 関数を sync-provider へ退避、`computeOperations` + 型のみ残す**。既存 PDS データ破棄前提のため、廃棄関数の移行コードは不要。

## Phase 1 に引き継ぐ課題 (spike で顕在化)

1. **Lamport clock の実装**: 発番は `++c` の簡易版。実装では受信時に `clock = max(local, remote) + 1` が必要。
2. **add-wins OR-Set の厳密化**: 現 projection は structure も clock-LWW。concurrent add/remove の add-wins は本 spike 未検証 → Phase 1 で厳密化。
3. **`computeOperations` の layout 対応** (D7)。
4. **`applyEvent` の `EDGE_PROPERTIES_CHANGED` が現状 no-op** (applyEvent.ts:273)。統一時に実装を補う。
5. **複合イベントを「分解して保存」か「複合のまま保存し projection 時に展開」か**: PoC は前者。undo/redo の粒度 (ユーザーの1操作=1 undo) を保つには後者が有利な場面がある → Phase 1 で語彙設計時に決定。
