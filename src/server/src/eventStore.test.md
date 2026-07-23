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
- **appendReceivedBatches (Phase 4d-0)**: remote から受信した batch を追記し、**同じ tx で
  marker を立てる**。marker をここでは「lazy migration 済」ではなく **「この op-log は正典であり
  snapshot から作り直してはならない」宣言**として使う。
  - 受信 batch を追記し、同時に marker が立つこと。
  - **受信後の `migrateToOplog` が no-op になり、受信 batch が破棄されないこと** — これが本体。
    marker が無いと `GET /files/:id/batches` → `migrateToOplog` → `DELETE FROM batches` で
    受信内容が消える (設計 `step1-phase4d-receive.md` §1.8)。受信 batch は remote にしか無く、
    受信側 cursor が前進していれば二度と取り直せないため、静かな不可逆のデータ消失になる。
  - **受信していないファイルの lazy migration は従来どおり破棄→genesis すること** (W3d-1 の回帰)。
    `migrateToOplog` 側に「op-log が空でなければ migration しない」ガードを置くと、W3d-1 が
    仕様化した pre-W3 増分ログの破棄 (上記 §migrateToOplog) を壊す。**両者を分けるのが
    marker の役割**であり、この 2 本のテストが対で意図を固定する。
  - 受信 0 件では marker を立てない (lazy migration の機会を無意味に奪わない)。
- **listOplogFiles (Phase 4e-2a)**: `GET /files` を snapshot storage と op-log の和集合に
  するための op-log 側。受信で materialize されたファイルは snapshot を持たないため、
  ここに出ないと一覧から永久に見えない (4e 設計 §3.2b)。
  - 空 op-log では空配列。
  - file 構造 op (`file.setName` / `file.setDescription` / `sheet.create`) を `projectFile` で
    畳んで `{id, name, description}` を得る (fold の第 2 実装を作らない)。
  - **projection が 0 シートの file_id は出さない** — 有効な GraphFile は必ず 1 シート以上
    (W3d-2 の読取失敗判定と同じ基準)。genesis の無い孤児 batch だけの file_id (D-4) を
    一覧に出すと、開いても描画できない項目が並ぶ。
  - 順序は初出順 (file_id ごとの最小 seq)。和集合で snapshot 順の後に安定して足すため。
  - 同一 batch_id の再受信はべき等 (件数 0・ログ不変)。`appendBatch` のべき等性を継承する。
  - marker は下げない (より新しい版で正典化済ならそのまま残す)。
- **projectSheet**: 操作ログを projection して Sheet を導出する。node.add → node.setContent
  で LWW の後勝ちが反映されること、空ログでは空 Sheet になること。
- **saveCommit / getCommits**: at 昇順で読み返す、同一 id は上書き、file_id で分離。

テストは `beforeEach` で毎回新しいインメモリ DB を生成し、テスト間の状態を分離する。
