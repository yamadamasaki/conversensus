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
| `GET /files/:id/batches` | 操作ログを取得する (`?since=<clock>` で範囲) |

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

### ケース設計

| エンドポイント | ケース | 観点 |
|---|---|---|
| POST /files/:id/batches | 追記 → 201 + {appended:2} | 正常系 |
| POST /files/:id/batches | 同一 batch 再送 → appended:0 | べき等 |
| POST /files/:id/batches | 不正 Batch → 400 | 境界検証 |
| GET /files/:id/batches | clock 昇順で返す | 決定論的順序 |
| GET /files/:id/batches | ?since=1 → clock>1 のみ | 範囲取得 |
| GET /files/:id/batches | ログ無し → [] | 空ログ |
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
