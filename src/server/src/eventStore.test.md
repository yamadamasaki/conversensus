# eventStore テスト仕様

## 何を

`EventStore` (step1 Phase 3 のローカル永続層) をテストする。SQLite (`bun:sqlite`) を
インメモリ (`:memory:`) で起動し、操作ログ (batches) の追記・取得・projection と、
コミット (ラベル付きオフセット) の保存・取得を検証する。

## なぜ

Phase 3 の永続モデルは「append-only な操作ログ + projection」。保存の正しさは
次の3点に依存し、いずれも回帰すると静かにデータを壊すため単体で固定する:

1. **べき等な追記**: 同期・再送で同じ Batch が二重適用されうる。`(file_id, batch_id)`
   の一意制約で重複を無視できないと、ログが膨れ projection が壊れる。
2. **決定論的な順序**: projection は clock 順の畳み込みに依存する。追記順に関わらず
   clock 昇順で読み返せることを保証する。
3. **ファイル境界の分離**: 複数グラフを 1 DB に同居させるため、file_id で batches /
   commits が確実に仕切られること。

永続化の境界でバリデーション (壊れた Batch を弾く) するのも、ログに不正データを
残さないための防御であり、テストで固定する。

## どのように

- **appendBatch / getBatches**:
  - 追記した Batch をそのまま読み返せる (往復)。
  - 同一 batch_id の再追記は `false` を返し重複しない (べき等)。
  - file_id が異なれば同一 batch_id でも共存する (境界分離)。
  - 追記順が逆でも clock 昇順で返る (決定論的順序)。
  - ops 空の壊れた Batch は `BatchSchema` 検証で追記を拒否する。
- **appendBatches**: 一括追記でトランザクション適用し、新規に入った件数のみを返す
  (一部重複時は新規分のみカウント)。
- **sheetId の永続化 (W3c2)**:
  - content batch の `sheetId` を append→getBatches で round-trip できること。
  - `sheetId` 無し (structure) batch は `sheetId` 無しで読み返ること。
  - `sheet_id` 列が無い旧スキーマ DB (W3c2 以前) をファイルとして用意し、`EventStore` で開くと
    `PRAGMA table_info` 検査 → `ALTER TABLE ADD COLUMN` で列が追加され、旧 batch は sheetId 無しで、
    新規 content batch は sheetId 付きで扱えること。再オープンしてもマイグレーションはべき等
    (列が既存なら ALTER しない) であることを固定する。破棄・再生成 (W3d) 前でも既存 DB を壊さない防御。
- **op-log 正典化 marker / migrateToOplog (W3d)**:
  - marker 不在のファイルは `getSchemaVersion` が `null` を返す (未 migration 判定)。
  - `migrateToOplog` が genesis batch を append し marker を `W3_SCHEMA_VERSION` に立てて `true` を返す。
  - migration 前に存在した pre-W3 増分ログを**破棄してから** genesis で作り直す (破棄→genesis の順序)。
  - marker 済のファイルへの再 `migrateToOplog` は、別の genesis を渡しても **no-op で `false`** を返し、
    ログを初回 genesis のまま保つ (marker ゲートによる再入べき等)。
  - marker は file_id 境界で分離する (`file_migrations` の per-file PRIMARY KEY)。
- **projectSheet**: 操作ログを projection して Sheet を導出する。node.add → node.setContent
  で LWW の後勝ちが反映されること、空ログでは空 Sheet になること。
- **saveCommit / getCommits**: at 昇順で読み返す、同一 id は上書き、file_id で分離。

テストは `beforeEach` で毎回新しいインメモリ DB を生成し、テスト間の状態を分離する。
