# migrateFileToOplog テスト仕様

## 何を

`migrateFileToOplog` (W3d-1: op-log 読み取り正典化の lazy migration オーケストレーション) を
テストする。snapshot (`storage.ts` の JSON) を入力に genesis batch を生成し、`EventStore` の
原子トランザクション (破棄→genesis→marker) を駆動する薄い調停層の分岐を固定する。

`DATA_DIR` をテスト毎の一時ディレクトリへ差し替えて snapshot を書き、`EventStore` は
インメモリ (`:memory:`) を渡す。両者を跨いだ「snapshot → op-log」の橋渡しを検証する。

## なぜ

W3d の cutover は **pre-W3 ログの破棄という不可逆操作**を含む。破棄してよいのは
「snapshot が正典として健在」かつ「未 migration」のときだけであり、この 2 条件の判定と
skip / 実行の分岐を誤ると、データを静かに失うか二重に破棄する。調停層の責務は次の 3 点:

1. **未 migration かつ snapshot 有** のときだけ genesis を実行する。
2. **snapshot 欠損なら破棄しない** (現状維持)。破棄の前提が無いのに op-log を消さない。
3. **再入べき等**: 既に marker 済なら snapshot が変わっていても再 genesis しない。

原子性 (破棄→genesis→marker が 1 tx) は `EventStore.migrateToOplog` の責務なので、
ここでは「どの入力条件で migration を呼ぶ / 呼ばない」の分岐を固定する。

## どのように

- **marker 不在 + snapshot 有** → `true` を返し、marker が `W3_SCHEMA_VERSION` に立ち、
  genesis batch (最低でも `file.setName`) が積まれる。
- **snapshot 欠損** → migration せず `false`。marker は `null` のまま、ログは空
  (破棄の前提が無いので現状維持)。
- **二度目の呼び出し** → snapshot を書き換えても marker 済なので `false` の no-op。
  ログは初回 genesis のまま (再入べき等)。
- **pre-W3 増分ログが先に存在** → migration で増分を破棄し、snapshot 由来の genesis に
  置き換える (破棄→genesis)。

テストは `beforeEach` で一時 `DATA_DIR` と新しいインメモリ `EventStore` を用意し、
`afterEach` で store を閉じてディレクトリを削除し、テスト間の状態を分離する。
