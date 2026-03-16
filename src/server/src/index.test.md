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

## なぜテストするか

- API はクライアントとの唯一の契約であり、レスポンスの形式・ステータスコードが変わると即座に UI が壊れる
- storage 層のテストとは独立して、ルーティング・バリデーション・エラーハンドリングの正確さを保証したい

## どのようにテストするか

### 隔離

`storage.test.ts` と同じく `process.env.DATA_DIR` で一時ディレクトリを使用。
Hono アプリの `fetch` 関数を直接呼び出すことで、実際の HTTP サーバーを起動せずにテストする。

### ケース設計

| エンドポイント | ケース | 観点 |
|---|---|---|
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
