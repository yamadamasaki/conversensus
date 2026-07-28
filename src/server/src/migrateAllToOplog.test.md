# migrateAllToOplog テスト仕様

対象: `migrateAllToOplog.ts` (`migrateAllFilesToOplog`)
関連設計: [step1 Phase 6 設計](../../../deepse/plans/step1-phase6-w3e-snapshot-retire.md) §3.1 / §5-1

## 何をテストするか

デーモン起動時の**一括移行**。`DATA_DIR` の snapshot を全件走査し、未 migration のものを
op-log 正典 (genesis) へ移す処理。

## なぜテストするか

Phase 6 は最終的に `storage.ts` を物理削除する (p6-5)。その前に**全 snapshot が op-log に
移っていること**が絶対条件で、漏れた 1 件はそのままユーザーデータの喪失になる。
`migrateFileToOplog` (単体の移行) は W3d-1 でテスト済なので、ここで固定すべきは
**「全件を漏れなく」「何度実行しても安全に」「1 件の失敗で全体を巻き添えにせず」**という
オーケストレーションの性質に絞る。

## どのようにテストするか

`DATA_DIR` をテストごとの一時ディレクトリに差し替え、`writeFile` で実際の snapshot JSON を
書いてから実行する (`migrateFileToOplog.test.ts` と同じ流儀)。EventStore は `IN_MEMORY`。

| # | テスト | 何を守るか |
|---|---|---|
| 1 | 未 migration の snapshot を全件 op-log 化する | **漏れが無いこと**。3 件それぞれに marker と genesis batch が立つことまで確認する (件数だけ合っていても中身が空なら意味がない) |
| 2 | 2 回目の実行は no-op (べき等) | 起動のたびに走るので**べき等性は必須**。snapshot を書き換えてから再実行し、batch id 列が変わらないことで「再 genesis していない」を示す。marker 検査が効いている証拠 |
| 3 | 壊れた snapshot が 1 件あっても残りは移行する | **失敗の隔離**。JSON として読めないファイルを混ぜ、それが `failed` に入りつつ健全な 2 件は `migrated` に入ることを確認。走査に `listSnapshotIds` (中身を読まない) を使う設計判断が効いているのはここ — `listFiles` で走査すると parse 段階で全体が throw する。壊れた側に marker が立たないことも確認する (次回起動で再試行できる) |
| 4 | snapshot が 1 件も無くても正常終了する | 初回起動 (まっさらな `DATA_DIR`) |
| 5 | `DATA_DIR` 自体が存在しなくても正常終了する | 2 組目のデーモン起動 (`DATA_DIR=data-b`) など。`listSnapshotIds` の `existsSync` ガードを固定する |
| 6 | snapshot を持たない op-log-only ファイルは触らない | Phase 4e-2b で受信 materialize されたファイルを `appendReceivedBatches` で作り、走査対象に**現れない**こと・batch が変化しないことを確認。snapshot 起点で走査する設計が「受信済みデータを壊さない」ことを構造で保証しているのを固定する |
| 7 | 所要時間を返す | 受入基準 §5-1 が移行時間の実測を要求するため、計測値が返ることを最低限固定する |

## テストしないこと

- **移行そのものの正しさ** (genesis の内容・破棄の原子性・marker の版数) — `migrateFileToOplog.test.ts`
  と `eventStore.test.ts` の担当。ここで重ねると同じ事実を 2 箇所で固定することになる。
- **起動時に呼ばれること** (`index.ts` の `import.meta.main` ガード) — エントリポイントの
  配線であり、テストからは `import.meta.main` が false になるため単体テストで観測できない。
  p6-6 の実機 e2e で確認する。
