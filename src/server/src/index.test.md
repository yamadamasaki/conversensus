# index.test.ts — テスト仕様

## 何をテストするか

`src/server/src/index.ts` の REST API エンドポイント全5種:

| エンドポイント | 責務 |
|---|---|
| `GET /files` | ファイル一覧を返す |
| `POST /files` | ファイルを新規作成する |
| `GET /files/:id` | 指定 ID のファイルを返す |
| `PUT /files/:id` | 指定 ID のファイルを更新する |
| `DELETE /files/:id` | 指定 ID のファイルを削除する |
| `POST /files/:id/batches` | 操作ログへ batches を追記する (step1 Phase 4 実配線) |
| `GET /files/:id/batches` | 操作ログを取得する (`?since=<clock>` で範囲)。読み取り前に未 migration なら snapshot から genesis で正典化する (W3d) |

## なぜテストするか

- API はクライアントとの唯一の契約であり、レスポンスの形式・ステータスコードが変わると即座に UI が壊れる
- storage 層のテストとは独立して、ルーティング・バリデーション・エラーハンドリングの正確さを保証したい

## どのようにテストするか

### 隔離

`storage.test.ts` と同じく `process.env.DATA_DIR` で一時ディレクトリを使用。
Hono アプリの `fetch` 関数を直接呼び出すことで、実際の HTTP サーバーを起動せずにテストする。

操作ログエンドポイントは EventStore (SQLite) を裏に持つ。`getEventStore` は `DATA_DIR`
から解決したパス単位でメモ化するため、テスト毎の一時 `DATA_DIR` で分離される。

### 操作ログ (batches) の観点

保存モデルは「操作ログ (append) + projection」。サーバは batches の保存・配信に徹し、
集約 (Sheet) の導出は `projectBatches` を持つクライアント側で行う。次を固定する:

- **べき等な追記**: 再送 (outbox flush 再試行) で同じ batch が二重に入らない。`appended`
  は新規分のみ数える。
- **決定論的な取得順**: projection は clock 順の畳み込みに依存するため取得は clock 昇順。
- **範囲取得 (`since`)**: pull のカーソル前進のため clock > since のみ返す。
- **境界バリデーション**: 不正な Batch は 400。server は zod を直接依存に持たず shared の
  `BatchSchema` で各要素を検証する。

### W3d lazy migration (読み取り正典化)

`GET /files/:id/batches` は読み取り前に `migrateFileToOplog` を呼び、未 migration の
ファイルを snapshot から genesis で op-log 正典化する。この副作用を固定する:

- **append/retrieve の素の観点は snapshot 無しの生 file_id で検証する**。`createFile` は
  snapshot を書くため、そのファイルへの GET は migration を発火させてしまう。生 file_id
  なら snapshot が無く migration は skip されるので、追記した batch がそのまま読み返せる。
- **新規作成ファイルの初回 GET は genesis を返す**。空 snapshot でも `file.setName` /
  `sheet.create` の genesis batch が生成される (新規/既存を分岐せず同一経路で吸収)。
- **migration はべき等**: 二度目の GET も同じ genesis を返す (marker ゲート)。
- **初回 read 前に積まれた pre-W3 増分は破棄される**: openFile より前に post した増分
  batch は、初回 GET の migration で破棄され genesis に置き換わる (破棄→genesis)。

### ケース設計

| エンドポイント | ケース | 観点 |
|---|---|---|
| POST /files/:id/batches | 追記 → 201 + {appended:2} | 正常系 |
| POST /files/:id/batches | 同一 batch 再送 → appended:0 | べき等 |
| POST /files/:id/batches | 不正 Batch → 400 | 境界検証 |
| GET /files/:id/batches | clock 昇順で返す (生 file_id) | 決定論的順序 |
| GET /files/:id/batches | ?since=1 → clock>1 のみ (生 file_id) | 範囲取得 |
| GET /files/:id/batches | ログも snapshot も無い → [] | 空ログ (migration skip) |
| GET /files/:id/batches | 新規作成の初回 GET → genesis | W3d lazy migration |
| GET /files/:id/batches | 二度目の GET も同じ genesis | migration べき等 |
| GET /files/:id/batches | pre-W3 増分は破棄される | 破棄→genesis |
| GET /files | 初期状態は [] | 空一覧 |
| POST /files | 名前付きで作成 → 201 | 正常系 |
| POST /files | name 省略 → "無題" | デフォルト値 |
| GET /files/:id | 作成後に取得できる | 正常系 |
| GET /files/:id | 存在しない ID → 404 | エラー系 |
| PUT /files/:id | 名前を更新できる | 正常系 |
| PUT /files/:id | 存在しない ID → 404 | エラー系 |
| DELETE /files/:id | 削除 → 204 | 正常系 |
| DELETE /files/:id | 削除後に GET → 404 | 削除の完全性 |
| DELETE /files/:id | 存在しない ID → 404 | エラー系 |

## POST /files/:id/batches/received (Phase 4d-5)

remote から受信した batches を追記する**専用エンドポイント**。通常の
`POST /files/:id/batches` とは別口にしてある。

**なぜ別口か**: 受信は追記に加えて **op-log 正典 marker を同じ tx で立てる**必要が
ある (`EventStore.appendReceivedBatches`, Phase 4d-0)。marker が無いと次の
`GET /files/:id/batches` が lazy migration を起動し、`DELETE FROM batches` で受信内容を
丸ごと破棄する (設計 `step1-phase4d-receive.md` §1.8 / §3.3b)。受信 batch は remote に
しか無いので、失うと取り直せない。

**ローカル編集の書き込み経路 (通常 POST) は marker を立ててはならない** — 受信して
いないファイルの lazy migration は W3d-1 どおり動く必要がある。両者を分けるのが
marker の役割なので、エンドポイントも分けて取り違えを経路で防ぐ。

> 設計 §3.3 は「受信は `POST /files/:id/batches` へ書く」と書いていたが、その
> エンドポイントは `appendBatches` (marker 無し) を呼ぶので、**そのまま従うと §3.3b の
> 不変条件を破る**。4d-0 は `appendReceivedBatches` を作ったが HTTP へ露出していなかった。

- **追記と件数**: 201 と `{ appended: N }` を返すこと。
- **べき等**: 同一 batch の再受信で `appended: 0` になること (受入基準 2)。
- **不正な Batch は 400**: 通常 POST と同じ検証を通ること。
- **🔴 受信 batch は lazy migration に破棄されない**: 「初回 read 前に積まれた pre-W3 増分は
  migration で破棄される」テストと**同じ手順**で、書き込み口だけを受信用に替える。
  marker が「正典宣言」として働き、同じ状況で結果が逆になることを固定する。4d-0 の要。
- **通常 POST は marker を立てない**: 上の保護が「全ファイルで migration を無効化した」
  わけではないことの対照。W3d-1 の破棄挙動を壊していないことの証拠。
- **受信 0 件では marker を立てない**: 空配列を受けても正典宣言をせず、その後の
  lazy migration が従来どおり働くこと。機会を無意味に奪わないため。
