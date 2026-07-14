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
4. **再起動後の clock 復元 (W3)**: 初回 drain で永続ログ (`provider.pull`) の
   max(clock) を観測して `seed` し、発番を max+1 から再開する。再起動をまたいでも
   採番が既存 batch を必ず超え、順序が壊れない。復元は tick より前に行うため、
   復元前に届いた event は保留し (clock 未割当)、復元成功後に FIFO 順で採番する。
5. **restore 失敗時の保留**: pull が失敗した場合は seed も採番もせず event を保留し、
   onError 通知のうえ次の record で再試行する (0 起点の誤採番を防ぐ)。

`LocalServerSyncProvider` は api.ts (薄い fetch ラッパー) への委譲のみのためテスト対象外。
tap のロジックを framework 非依存に固定する。

## どのように

- テスト用 `RecordingProvider` (push を記録、`online` で成否を切替) を注入。
- **push**: `NODE_RELABELED` (node.setContent を生む) を record → settled 後に 1 件 push、
  ops が node.setContent であること。
- **空 ops スキップ**: width/height 無しの `NODE_STYLE_CHANGED` を record → push 0 件、
  注入した `LamportClock` が tick されていない (current()===0)。
- **clock 単調増加**: relabel を 3 連続 record → push された batch の clock が [1,2,3]
  (空ログを pull → seed(0) → tick 1,2,3)。
- **再起動後の復元**: `existing` に clock 5,7,6 の batch を仕込み、0 起点の clock を注入して
  record → seed(max=7) 後の tick で clock [8,9] が push される。
- **restore 失敗**: `pullFails=true` で record → push 0・pending 1・clock 0・onError 1 回。
  その後 `pullFails=false`・`existing=[clock 3]` にして別 record → seed(3) 後の tick で
  clock [4,5] が push され pending 0 (保留分ごと再試行)。
- **オフライン**: `online=false` で record → push 0・pending 1・onError 1 回。その後
  `online=true` にして別 record → 保留分 + 新規の 2 件が push され pending 0。
- **sheetId の付与 (W3c2)**: `record(event, sheetId)` で渡した sheetId が push された
  content batch に載ること、`record(event)` (sheetId 省略) では batch が sheetId を
  持たない (structure 経路) ことを固定する。sheetId は event と対で保留され、drain 時の
  `graphEventToBatch(event, tick, sheetId)` で載るため、clock 採番タイミングと独立に正しく紐づく。
- `settled()` で直列化された flush チェーンの完了を待つ。
