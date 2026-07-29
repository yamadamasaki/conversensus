# index.test.ts — テスト仕様

## 何をテストするか

`src/server/src/index.ts` の REST API エンドポイント:

| エンドポイント | 責務 |
|---|---|
| `GET /files` | ファイル一覧を返す (**op-log 単独**, Phase 6 p6-2) |
| `POST /files` | ファイルを新規作成する (op-log を genesis で初期化する, Phase 6 p6-1) |
| `DELETE /files/:id` | 指定 ID のファイルを削除する (**op-log 正典**, Phase 6 p6-2) |
| `POST /files/:id/batches` | 操作ログへ batches を追記する (step1 Phase 4 実配線) |
| `GET /files/:id/batches` | 操作ログを取得する (`?since=<clock>` で範囲)。**副作用は無い** — 読取時の lazy migration は Phase 6 p6-1 で撤去した |
| `POST /files/:id/commits` | コミット (ログ上のラベル付きオフセット) を保存する (step1 Phase 5) |
| `GET /files/:id/commits` | ファイルのコミット一覧を at 昇順で返す (step1 Phase 5) |
| `POST /files/:id/branches` | ブランチのメタ情報を保存する (`:id` = 分岐元 trunk, step1 Phase 5) |
| `GET /files/:id/branches` | trunk のブランチ一覧を base オフセット昇順で返す (step1 Phase 5) |

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

### 作成時 genesis と読取の無害性 (Phase 6 p6-1)

**p6-1 で読取時の lazy migration を撤去した**。ファイルは `POST /files` / `POST /files/import`
の時点で op-log を持ち (genesis 直書き, 設計 §3.2)、Phase 6 より前から在る snapshot は
デーモン起動時の一括移行 (§3.1) が処理する。よって `GET /files/:id/batches` は**副作用の無い
純粋な読取**になった。

- **新規作成ファイルの初回 GET は genesis を返す**。空ファイルでも `file.setName` /
  `sheet.create` の genesis batch が作られている。
- **二度目の GET も同じ結果**: 読取に副作用が無いことの直接の確認。
- **🔴 初回 read 前に積まれた batch が読取で破棄されない**: W3d-1 では同じ手順で
  lazy migration が `DELETE FROM batches` を実行し、積んだ増分を捨てていた
  (4d-0 §1.8 の事故の原因)。p6-1 でその経路ごと消えたので、**書いたものは読んでも消えない**。
  genesis も残る (置き換えではなく追記) ことまで確認する。

> 旧仕様では「`createFile` が snapshot を書くため GET が migration を発火する」ことを避けて
> append/retrieve の素の観点を生 file_id で検証していた。その回避は不要になったが、
> 生 file_id のケース自体は「op-log にしか無いファイル」の検証として引き続き有効なので残す。

### ケース設計

| エンドポイント | ケース | 観点 |
|---|---|---|
| POST /files/:id/batches | 追記 → 201 + {appended:2} | 正常系 |
| POST /files/:id/batches | 同一 batch 再送 → appended:0 | べき等 |
| POST /files/:id/batches | 不正 Batch → 400 | 境界検証 |
| GET /files/:id/batches | clock 昇順で返す (生 file_id) | 決定論的順序 |
| GET /files/:id/batches | ?since=1 → clock>1 のみ (生 file_id) | 範囲取得 |
| GET /files/:id/batches | ログの無い file_id → [] | 空ログ |
| GET /files/:id/batches | 新規作成の初回 GET → genesis | 作成時 genesis (p6-1) |
| GET /files/:id/batches | 二度目の GET も同じ genesis | 読取に副作用が無い |
| GET /files/:id/batches | 🔴 read 前に積んだ batch が消えない | 読取が破棄しない (p6-1) |
| GET /files | 初期状態は [] | 空一覧 |
| GET /files | op-log にしか無いファイルも載る (受信 materialize) | op-log 単独 (p6-2) |
| GET /files | 🔴 snapshot を直接書き換えても一覧は動かない | projection が唯一の正典 (p6-2) |
| GET /files | 孤児 batch だけの file_id は出ない (D-4) | 0 シート除外 |
| GET /files | branch 専用 file_id は出ない | branch 除外 (Phase 5 p5-1) |
| POST /files | 名前付きで作成 → 201 | 正常系 |
| POST /files | name 省略 → "無題" | デフォルト値 |
| GET /files/:id | 🔴 endpoint ごと存在しない → 404 | 撤去の固定 (p6-3) |
| PUT /files/:id | 🔴 endpoint ごと存在しない → 404 | 撤去の固定 (p6-3) |
| DELETE /files/:id | 削除 → 204 | 正常系 |
| DELETE /files/:id | 削除後に GET → 404 | 削除の完全性 |
| DELETE /files/:id | 存在しない ID → 404 | エラー系 |
| DELETE /files/:id | 🔴 削除後に batches が残らない | op-log の削除 (p6-2) |
| DELETE /files/:id | 🔴 op-log-only ファイルも消せる | §1.3 の穴 (p6-2) |
| DELETE /files/:id | 🔴 legacy snapshot も消える | 次回起動の移行による復活の防止 (p6-5a) |
| DELETE /files/:id | trunk 削除でブランチのメタと実体も消える | 孤児 batch の防止 |
| DELETE /files/:id | コミットも消える | メタの消し残し |
| POST /files/import | 正常なファイル → 201 | 正常系 |
| POST /files/import | ID をすべて再生成し参照を付け替える | 取り込み時の同一性分離 |
| POST /files/import | 🔴 応答の GraphFile = op-log の projection | 往復性 (p6-1, 設計 §6.3) |
| POST /files/import | インポートしたファイルが一覧に現れる | 一覧との整合 |

### import の往復性 (Phase 6 p6-1)

import は **ID 再生成 + 参照の付け替え**を通してから genesis 化する。応答として返す
`GraphFile` と、op-log を `projectFile` した `GraphFile` が食い違うと、**import 直後の画面と
再オープン後の画面が別物になる**。`graphFileToBatches` の往復性は W3b で固定済だが、
**import 固有の ID 再生成を通した後**の往復はどのテストも見ていなかった (設計 §6.3 で
未固定として挙げた点)。ノードとエッジを含む payload で、名前・説明・シート/ノード/エッジの
id 列・付け替え後の `source` 参照までを突き合わせて固定する。

## POST /files/:id/batches/received (Phase 4d-5)

remote から受信した batches を追記する**専用エンドポイント**。通常の
`POST /files/:id/batches` とは別口にしてある。

**なぜ別口か**: 受信は追記に加えて **op-log 正典 marker を同じ tx で立てる**必要が
ある (`EventStore.appendReceivedBatches`, Phase 4d-0)。marker が無いと次の
`GET /files/:id/batches` が lazy migration を起動し、`DELETE FROM batches` で受信内容を
丸ごと破棄する (設計 `step1-phase4d-receive.md` §1.8 / §3.3b)。受信 batch は remote に
しか無いので、失うと取り直せない。

> 設計 §3.3 は「受信は `POST /files/:id/batches` へ書く」と書いていたが、その
> エンドポイントは `appendBatches` (marker 無し) を呼ぶので、**そのまま従うと §3.3b の
> 不変条件を破る**。4d-0 は `appendReceivedBatches` を作ったが HTTP へ露出していなかった。

> **Phase 6 p6-1 での変化**: 読取時の lazy migration が撤去され、marker の役割は
> 「起動時の一括移行に snapshot から作り直させない」だけになった。したがって
> **別口である理由のうち「読取に破棄される」部分は消滅した**。エンドポイントの分離自体は
> 受信の意図を経路に残すために維持するが、marker は snapshot が消える p6-5 で役目を終える。

- **追記と件数**: 201 と `{ appended: N }` を返すこと。
- **べき等**: 同一 batch の再受信で `appended: 0` になること (受入基準 2)。
- **不正な Batch は 400**: 通常 POST と同じ検証を通ること。
- **受信 batch が後続の GET で失われない**: 受信経路の end-to-end 契約。4d-0 では marker が
  これを守っていたが、p6-1 以降は経路の別なく成立する。

> marker (正典宣言) そのものの性質 — 受信 0 件で立てない / ファイル境界で分離する — は
> `eventStore.test.md` の担当。p6-1 で HTTP 越しに marker の有無を観測する手段が無くなった
> (読取が挙動を変えないため) ので、ここで重ねていた 2 件は EventStore 側へ一本化した。

## 一覧と削除の op-log 単独化 (Phase 6 p6-2, 設計 §3.3 / §3.5)

### GET /files — 和集合から op-log 単独へ

4e-2a の `listFiles ∪ listOplogFiles` を `listOplogFiles` だけにした。すべてのファイルが
op-log を持つようになった (起動時の一括移行 §3.1 + 作成時の genesis 直書き §3.2) ので
和集合が要らなくなり、同時に **「name は snapshot 側を正とする」という二重の正典が消える**。

固定したいのはこの「正典がどちらか」であって件数ではない。そこで従来の
「両方に在れば snapshot の name を正とする」テストを**意味を反転させて**残した:
`PUT /files/:id` (snapshot にしか書かない経路) で改名しても一覧は動かず、op-log の
projection が返る。和集合へ戻ると即座に赤くなる。

> **一括移行に失敗した snapshot はここに現れない**。無言の消失を避けるため、失敗は
> 起動時に warn される (`migrateAllFilesToOplog`)。§4.1 の撤去順序どおり、
> `GET /files/:id` はまだ生きているので中身へは到達できる。

### DELETE /files/:id — snapshot 削除から op-log 削除へ

設計 §1.3 が挙げた**既存の穴**を塞ぐ変更なので、テストは穴の形に沿って置く:

- **削除後に batches が残らない**: 従来は snapshot だけ消えて op-log が残っていた。
  同じ id が受信で materialize されると、消したはずの内容が復活しうる。
- **op-log-only ファイルも消せる**: 受信 materialize されたファイルは snapshot を持たず、
  従来は 404 で**ユーザーが消せないファイル**になっていた。
- **trunk 削除でブランチのメタと実体も消える**: branch の中身へは `branch_file_id` から
  しか辿れない (`deleteBranch` と同じ理由)。trunk だけ消すと孤児 batch が永久に残る。
- **コミットも消える**: メタの消し残しの検出。

snapshot 削除も併せて呼び続けているのは、まだ書かれているため (p6-5 で落とす) と、
一括移行に失敗して op-log を持たないファイルにも削除手段を残すため。応答は
「どちらでも消せなければ 404」で、既存の 404 契約は変わらない。

### 撤去した snapshot endpoint (Phase 6 p6-3, 設計 §3.4 / §3.6)

`GET /files/:id` (snapshot 読取) と `PUT /files/:id` (全体保存) を撤去した。

- **読取**: server に「GraphFile を組み立てて返す」責務を残すと projection の実装が
  client (`projectFile`) と server の 2 箇所に生まれ、R2 の二重モデルを別の形で
  再生産する。client が `GET /files/:id/batches` → `projectFile` する (§3.4 の B 案)。
- **書込**: client の `persistFile` が解体され消費者を失った。状態の書込口は
  `POST /files/:id/batches` (op-log への追記) ただ一つになった。

**「消えたこと」を 404 で固定する**。復活すると client 側の消費者も一緒に戻せてしまい、
二重モデルが静かに再発するため。なお `GET /files` の「snapshot を書き換えても一覧は
動かない」テストは、HTTP から snapshot を書けなくなったのでテスト専用ヘルパ
`writeLegacySnapshot` で直接置く形へ変えた (観測したい不変条件は同じ)。

## snapshot が生成されないこと (Phase 6 p6-5a, 受入基準 §5-2)

p6-3 で読取経路が消えた後、snapshot の書込は **write-only** — 誰も読まないのに書かれ続ける
状態だった。これは R2 の二重モデルそのもの (Phase 5 で実害が出た構造) なので p6-5a で
書込ごと落とした。

テストは endpoint の応答ではなく **`DATA_DIR` に `*.json` が現れないこと**を直接見張る。
書込の消滅は「戻ってきても応答は変わらない」性質の変更で、応答を見るテストでは検出できない
ためである。作成・インポート・編集の 3 経路を通す — 3 つとも `GraphFile` を手元に持って
おり、うっかり書き戻す実装を足しうる場所だから。

**`storage.deleteFile` は残る**ので、削除側にもテストを 1 件足した (上表)。既存 snapshot を
消し損ねると、marker も一緒に消えているため**次回起動の一括移行がそれを拾って削除済み
ファイルを復活させる**。書込が消えた後も削除が要る理由はここにあり、根拠が消えると
「もう書かないのだから消す必要もない」と誤って撤去されうる。

### branch 専用 file_id の一覧除外 (Phase 5 p5-1)

branch batches は trunk と同じ `batches` テーブルに **branch 専用 file_id** で同居する
(設計 §3.1-B)。除外できないと UI のファイル一覧に branch がファイルとして並ぶ。

一覧が `listOplogFiles` 単独になった今 (p6-2)、branch を隠しているのはこの除外だけになる。
**明示的な除外コードは書いていない** — 既存の 0 シート除外がそのまま効くため
(設計 §9.2 / M2)。HTTP の口でもそれを固定する。

## ブランチ / コミットのメタ情報 (step1 Phase 5)

branch/commit を op-log 上で成立させるための**メタの器**。batches と違い append-only の
ログではなく上書き保存 (`INSERT OR REPLACE`) であり、**local daemon 専用で remote へは
同期しない** (設計 `step1-phase5-branch-oplog.md` §9.2 の不変条件)。

### コミット (`/commits`)

コミット = 操作ログ上のラベル付きオフセット (`{id, message, at, authorActor}`)。

- **保存と応答**: 201 と保存内容を返す。UI が採番結果をそのまま扱えること。
- **at 昇順で取得**: `Commit.at` は `batchesUpTo` の切り出し位置なので、履歴は
  分岐点の古い順に並ぶ必要がある。
- **空なら空配列**: コミットの無いファイルでも 200 + `[]` (404 にしない)。
- **境界バリデーション**: `id` が UUID でない等の不正な body は 400。branded UUID を
  API 境界で強制する規約 (CLAUDE.md #2) の実施点。

### ブランチ (`/branches`)

`BranchMeta` = ログドメインの `Branch` + `{sheetId, trunkFileId, branchFileId}`。
`:id` は**分岐元 trunk の file_id** であり、branch 自身の op-log (`branchFileId`) とは別物。

- **保存と応答 / base オフセット昇順の取得 / 空なら空配列**: コミットと同じ観点。
- **trunk での分離**: 別 trunk のブランチが一覧に混ざらないこと。branch は per-sheet で
  数が増えるため、分離が崩れると他ファイルのブランチが UI に現れる。
- **🔴 URL と body の trunk 不一致は 400**: `trunkFileId` は保存先の絞り込みキーでもある
  ため、URL と食い違ったまま受け付けると **`GET /files/:id/branches` のどの :id でも
  取り出せないブランチ**が静かに生まれる (作成は成功したように見える)。400 で弾き、
  かつ body 側の trunk にも保存されていないことを確認する。
- **未定義の `status` は 400**: `status` は `BRANCH_STATUS` の 4 値のみ。open/merged の
  遷移で分岐の生死を判定するため、未知の値が入ると判定不能になる。

#### `DELETE /files/:id/branches/:branchId` (p5-4)

旧 `deleteBranchWithRecords` (PDS レコード一括削除) の置換。branch はメタと
**branch 専用 file_id の op-log** の 2 箇所に散っているため、片方だけ消す API を
作らない (メタだけ消すと辿れない batch が残り、op-log だけ消すと空のブランチが並ぶ)。

- **削除後はメタも branch op-log も空**: 「消えていること」を両側から確認する。
- **存在しないブランチは 404**: client 側ラッパーはこれを成功として扱う (二重削除を
  失敗にしない) が、その判断を client に閉じ込めるため server は区別して返す。
- **別 trunk 指定では消えない**: `:id` (trunk) を経路に含める理由そのもの。id だけを
  知る呼び出しが他ファイルのブランチを消せないことを固定する。
