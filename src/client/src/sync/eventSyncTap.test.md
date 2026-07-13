# eventSyncTap テスト仕様

## 何を

`EventSyncTap` (step1 Phase 4 実配線 W2、dispatch された GraphEvent を操作ログへ流す
tap) をテストする。event → Batch 変換・clock 採番・Outbox への enqueue・SyncProvider
への flush と、オフライン分岐を検証する。

## なぜ

漸進移行の要。既存の GraphEvent/undo-redo を残しつつ「編集 = 操作ログの追記」を
成立させる副経路であり、ここが回帰すると編集が op-log に載らず local-first の
永続が壊れる。次を固定する:

1. **ops を生じる event だけ流す**: presentation の空更新など ops 0 件の event は
   Batch にせずスキップし、**clock も消費しない** (無駄な採番で順序がずれない)。
2. **clock の単調増加**: 連続操作で Lamport clock が 1,2,3… と進む (LWW 順序の担保)。
3. **オフライン分岐**: provider.push が失敗しても保留を維持し (Outbox)、復帰後の
   操作が drain を再起動して未送信分ごと再送する。編集がオフラインで失われない保証。

`LocalServerSyncProvider` は api.ts (薄い fetch ラッパー) への委譲のみのためテスト対象外。
tap のロジックを framework 非依存に固定する。

## どのように

- テスト用 `RecordingProvider` (push を記録、`online` で成否を切替) を注入。
- **push**: `NODE_RELABELED` (node.setContent を生む) を record → settled 後に 1 件 push、
  ops が node.setContent であること。
- **空 ops スキップ**: width/height 無しの `NODE_STYLE_CHANGED` を record → push 0 件、
  注入した `LamportClock` が tick されていない (current()===0)。
- **clock 単調増加**: relabel を 3 連続 record → push された batch の clock が [1,2,3]。
- **オフライン**: `online=false` で record → push 0・pending 1・onError 1 回。その後
  `online=true` にして別 record → 保留分 + 新規の 2 件が push され pending 0。
- `settled()` で直列化された flush チェーンの完了を待つ。
