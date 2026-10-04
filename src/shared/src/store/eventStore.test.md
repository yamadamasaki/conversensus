# eventStore テスト仕様

## 何を

`EventStore` (step1 Phase 3 のローカル永続層) をテストする。`bun:sqlite` のドライバ
(`BunSqliteDriver`) をインメモリ (`:memory:`) で起動し、操作ログ (batches) の追記・取得・
projection・削除と blob を検証する。

step3 Phase 2 S2-1 で `src/server` から `src/shared/src/store` へ移した。`EventStore` は SQL の
エンジンに依らない (`SqlDriver`) ので、ここで `bun:sqlite` を通して固定したものが、ブラウザでは
SQLite-WASM の上で動く。ドライバどうしが同じに振る舞うことは `bunSqliteDriver.test.ts` の
契約が見る。

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
- **listAllFileIds (ANA-127)**: `GET /files/ids`。**表示のための除外を一切しない** file_id の
  全集合で、用途は remote からの発見 (`discoverRemoteFiles`) の既知集合ただ 1 つである。
  `listOplogFiles` との対比そのものがテストの主題なので、同じ状態に両方を当てて
  「一覧からは消えるが既知集合には残る」ことを 1 つのテストで見る。削除済み・0 シートの
  どちらも含むこと、重複せず初出順であることを固定する。
- **listOplogFiles (Phase 4e-2a)**: `GET /files` の一覧を作る。4e-2a では snapshot storage
  との和集合の op-log 側だったが、**Phase 6 p6-2 で `GET /files` の唯一の供給元になった**
  (設計 §3.3)。受信で materialize されたファイルは snapshot を持たないため、
  ここに出ないと一覧から永久に見えない (4e 設計 §3.2b)。
  - 空 op-log では空配列。
  - file 構造 op (`file.setName` / `file.setDescription` / `sheet.create`) を `projectFile` で
    畳んで `{id, name, description}` を得る (fold の第 2 実装を作らない)。
  - **projection が 0 シートの file_id は出さない** — 有効な GraphFile は必ず 1 シート以上
    (W3d-2 の読取失敗判定と同じ基準)。genesis の無い孤児 batch だけの file_id (D-4) を
    一覧に出すと、開いても描画できない項目が並ぶ。
  - 順序は初出順 (file_id ごとの最小 seq)。和集合だった頃は snapshot 順の後へ安定して
    足すための規則で、単独化後はそれ自体が一覧の順序になる。
  - **branch op-log の除外 (Phase 5 p5-1)**: branch batches は trunk と同じテーブルに
    branch 専用 file_id で同居する (設計 §3.1-B) ため、除外できないと UI のファイル一覧に
    branch がファイルとして並ぶ。**明示的な除外コードは書いていない** — `branchSheet` は
    シートのメタを引数から受け取る設計なので branch op-log は `sheet.create` を持たず、
    上の 0 シート除外がそのまま効く (設計 §9.2 / M2)。次の 3 点を固定する:
    - content batch だけの branch op-log は一覧に出ない (trunk は出る)。
    - 一覧から落ちても **branch op-log の中身は失われない** (p5-2 の `branchSheet` が
      ここから branchBatches を読む)。表示上の判断であって破棄ではない。
    - 🔴 **除外が依存している条件そのもの**: branch op-log に `sheet.create` が 1 つでも
      入ると branch は一覧に現れる。p5-2 以降の配線は「branch op-log へ構造 op を
      流さない」を守る必要があり、破れたらこのテストが赤くなって気づける
      (破れた場合は明示除外の実装が要る)。
  - **削除済みファイルの除外 (ANA-127)**: `file.remove` を持つ file_id を一覧から落とす。
    ここで固定したいのは除外そのものより **`batches` の行が残ること**である。削除を
    物理削除で実装していたのが ANA-127 の原因で、行ごと消えると tombstone
    まで消え、次の discovery が「ローカルに無い = 未知ファイル」と判定して PDS から
    materialize し直してしまう (設計 D1 の層 1)。したがって次の 4 点を固定する:
    - `file.remove` を持つ file_id は一覧に出ない。
    - **一覧から消えても `getBatches` は全 batch を返す** — 表示上の判断であって破棄ではない。
      これが崩れると ANA-127 が再発する。
    - 削除済みファイルがあっても他のファイルは一覧に残る (除外が file_id 境界で効く)。
    - `file.remove` の後に編集 batch が来ても復活しない (remove-wins, `isFileDeleted` 参照)。
  - 同一 batch_id の再受信はべき等 (件数 0・ログ不変)。`appendBatch` のべき等性を継承する。
  - marker は下げない (より新しい版で正典化済ならそのまま残す)。
- **projectSheet**: 操作ログを projection して Sheet を導出する。node.add → node.setContent
  で LWW の後勝ちが反映されること、空ログでは空 Sheet になること。
テストは `beforeEach` で毎回新しいインメモリ DB を生成し、テスト間の状態を分離する。

## blob ストア (ANA-116 S2)

### 何を

`putBlob` / `getBlob` — 画像などのバイナリを置く content-addressed なストア。

### なぜ

blob は **cid を鍵とする共有ストア**であり、batches / commits とは性質が違う。
ここを取り違えると静かにデータを失うため、次の 3 点を単体で固定する:

1. **BLOB 列であること**。画像は必ず 0x00 を含む。TEXT 列に落ちていると NUL で切れて
   壊れた画像になる — 目で見て気づきにくい。
2. **ファイルに紐づかないこと**。同じ blob は複数のファイル・複数のバージョンから
   参照されうる。ファイル削除の道連れにすると、他から参照されている画像が消える。
3. **冪等であること**。同じ cid = 同じ内容なので、後から来た方を捨ててよい。
   これが成り立たないと再送や重複アップロードのたびに行が増える。

cid の計算そのものは API 境界 (HTTP) の責務で、ここでは検証しない
(`appendBatch` が UUID を検証しないのと同じ方針)。

### どのように

- 格納した blob をバイト列・MIME・サイズごと読み返せる (往復)
- 同じ cid の再格納は `false` を返し、既存の内容と MIME を変えない (冪等)
- cid が違えば別の行として共存する
- 無い cid は `null`
- **0x00 を含むバイト列が欠けずに往復する** (BLOB 列であることの確認)

## merge の写し (step3 Phase 1 D2)

step2 では merge の写しが**同じ id のまま**別の clock で届いたので、保存側が「(clock, 積んだ人) が
最小の写しを正とし、位置を置き換える」(`compareCopies`) という**追記のみの例外**を持っていた。

step3 Phase 1 D2 で写しは merge した人自身の batch (新しい id) になり、**この例外は無くなった**。
保存は追記のみに戻り、同じ元を指す写しの重複は畳み込み (`orderBatches`) が除く
(`shared/src/events/project.test.md`)。

- **`copyOf` / `mergedIn` を往復する** (列を足したことの確認)
- **同じ元を指す別の写しは、両方とも追記される** — 除くのは畳み込みの役目
- **同じ id は二度追記しない** (べき等)


## 知らない種類の op (step3 FPR の確認 §5.3)

保存は受信した形のまま、読むときに知らない op を落とす (`rowToBatch` → `knownOpsOf`)。

- **読むときに落とし、知っている op は効く**
- **保存の JSON には残る** — クライアントを更新すれば、その時から効く。受信は手元に無い batch だけを
  引くので、保存の時点で捨てると二度と戻らない。driver で行を直に読んで確かめる
- **知らない op だけの batch も、ops が空のまま残る** — batch を落とすと因果の点 (actor, seq) が歯抜けになり、
  後の batch が「まだ見ていないものに依存する」ことになる
