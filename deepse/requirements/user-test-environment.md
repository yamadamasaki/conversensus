# ユーザーテスト環境の作り方

このドキュメントは, Conversensus を手で触って動作確認・ユーザーテストするための **環境構築とテストデータ投入・リセット** の手順をまとめたものである.

アプリの GUI 操作そのもの (ファイル・シート・ノード・エッジ・ブランチの使い方) は [`operation-manual-for-dev.md`](./operation-manual-for-dev.md) を参照すること. 本書はその手前, 「テスターに渡す環境をどう用意し, どう初期状態へ戻すか」を扱う.

## 1. サーバの起動

ローカル単体 (ATProto/PDS なし) でよければ, デーモンとクライアントの 2 つを起動すれば足りる.

```shell
bun run dev:server   # デーモン (HTTP API) を :3000 で起動
bun run dev:client   # web クライアント (vite) を :5173 で起動
```

`http://localhost:5173/` を開けばクライアントが動いている. ATProto ログインやブランチの remote 機能まで試す場合は, [`operation-manual-for-dev.md`](./operation-manual-for-dev.md) の「ATProto 向け開発時環境」に従って PDS を先に起動しておく.

デーモンのデータはすべて `DATA_DIR` (既定 `data/`) 配下に置かれる. `data/` は `.gitignore` 済みで, ここに何を投入・削除してもリポジトリには影響しない.

- `data/<fileId>.json` — 各ファイルの snapshot (`storage.ts`)
- `data/events.db*` — 操作ログ (op-log) の SQLite (`eventStore`)

## 2. テストデータの投入

### 2.1 GUI で作る

最も簡単なのは, クライアント画面でファイルを新規作成し, ノード・エッジを手で置く方法である (操作は operation-manual を参照). 少数の題材を用意するだけならこれで足りる.

### 2.2 HTTP API で投入する (再現可能)

同じ題材を毎回同じ形で用意したい場合は, デーモンの HTTP API を直接叩く. エンドポイントは以下.

| メソッド | パス | 用途 |
|----------|------|------|
| `POST` | `/files` | 新規ファイル作成 (空シート 1 枚を持つ). body: `{name?, description?, sheet?:{name?}}` |
| `GET` | `/files` | ファイル一覧 |
| `GET` | `/files/:id` | snapshot 取得 |
| `PUT` | `/files/:id` | ファイル全体を上書き保存 (snapshot). body は `GraphFile` 全体 |
| `DELETE` | `/files/:id` | snapshot 削除 (op-log は残る — §4 参照) |
| `GET` | `/files/:id/batches` | op-log (batch 列) 取得. **副作用注意, §5** |

**ID はすべて UUID でなければならない** (`fileId` / `sheetId` / `nodeId` / `edgeId` は Zod の branded UUID 型で検証される). ノードの座標・大きさは `sheets[].layouts[]` に `{nodeId, x, y, width?, height?}` として持たせる.

以下は「2 ノード + ラベル付きエッジ」を 1 枚のシートに持つファイルを投入する例. `POST` で器を作り, その `id` と最初のシートの `id` を引き継いで `PUT` で中身を流し込む.

```shell
uuid() { uuidgen | tr 'A-F' 'a-f'; }

# 1) 器を作り, file_id と sheet_id を取得
FID=$(curl -s -X POST http://localhost:3000/files \
  -H 'content-type: application/json' \
  -d '{"name":"テスト題材"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
S1=$(curl -s http://localhost:3000/files/$FID \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['sheets'][0]['id'])")

# 2) ノード・エッジ・レイアウトを PUT で流し込む
N1=$(uuid); N2=$(uuid); E1=$(uuid)
curl -s -X PUT http://localhost:3000/files/$FID \
  -H 'content-type: application/json' \
  -d "{
    \"id\":\"$FID\", \"name\":\"テスト題材\",
    \"sheets\":[{
      \"id\":\"$S1\", \"name\":\"Sheet 1\",
      \"nodes\":[
        {\"id\":\"$N1\",\"content\":\"前提\"},
        {\"id\":\"$N2\",\"content\":\"結論\"}],
      \"edges\":[{\"id\":\"$E1\",\"source\":\"$N1\",\"target\":\"$N2\",\"label\":\"ゆえに\"}],
      \"layouts\":[
        {\"nodeId\":\"$N1\",\"x\":100,\"y\":100},
        {\"nodeId\":\"$N2\",\"x\":420,\"y\":220}]
    }]
  }" -o /dev/null -w 'PUT %{http_code}\n'
```

クライアントを再読み込みすれば, 投入したファイルが一覧に現れる. 複数シートにしたい場合は `sheets` 配列に要素を足す.

> **補足 (操作ログ正典化との関係)**: `POST`+`PUT` で作ったファイルは snapshot だけを持つ「pre-W3 相当」の状態になる. クライアントが最初にそのファイルを開くと, デーモンが snapshot から op-log を自動生成する (lazy migration). つまり **HTTP API で投入した題材は, GUI で開いた瞬間に op-log 正典の形へ移行する**. これは意図した挙動である.

## 3. 読取ソースの切替 (dual-read 安全弁)

クライアントの読取ソースは環境変数 `VITE_READ_FROM_OPLOG` で切り替えられる (`src/client/src/config.ts`).

- 既定 (`true`): op-log を正典として読む (`fetchBatches` → `projectFile`). 失敗時は snapshot へ自動フォールバック.
- `false`: 従来どおり snapshot を直読する. 退行時に即座に戻せる安全弁.

`src/client/.env.local` に `VITE_READ_FROM_OPLOG=false` を書くか, 起動時にインラインで渡す. vite は env 変更の反映に再起動が要る. 既存の :5173 を止めずに比較したいときは, 別ポートで起動するとよい.

```shell
# snapshot 読取のクライアントを別ポートで起動 (既存 :5173 と併存)
cd src/client && VITE_READ_FROM_OPLOG=false bunx vite --port 5174 --strictPort
```

同じファイルを :5173 (op-log 読取) と :5174 (snapshot 直読) で開き比べれば, どちらの経路で描画されているかを確認できる.

## 4. クリーンな状態へのリセット

テストセッションの合間に初期状態へ戻すには, snapshot と op-log の両方を消す.

### 4.1 個別ファイルを消す

`DELETE /files/:id` は **snapshot だけ** を消す. op-log の batch と migration marker (`events.db`) は残るため, 完全に消すには op-log 側も別途クリアする. デーモンは `events.db` を WAL モードで開いているので, 別接続からの削除で干渉しない.

```shell
FID=<消したい file_id>
curl -s -X DELETE http://localhost:3000/files/$FID -o /dev/null -w 'DELETE %{http_code}\n'
bun -e "
import { Database } from 'bun:sqlite';
const db = new Database('data/events.db');
db.query('DELETE FROM batches WHERE file_id = ?').run('$FID');
db.query('DELETE FROM file_migrations WHERE file_id = ?').run('$FID');
db.close();
"
curl -s http://localhost:3000/files   # [] になれば一覧から消えている
```

### 4.2 全部まっさらにする

すべてのテストデータを捨てて空から始めたいなら, デーモンを止めて `data/` の中身を消すのが最も確実である.

```shell
# dev:server を止めてから
rm -f data/*.json data/events.db*
```

`data/` は gitignore 済みなので, 消してもリポジトリには影響しない. 次回 `dev:server` 起動時に `events.db` は自動的に再作成される.

## 5. 注意点 (ハマりどころ)

- **`GET /files/:id/batches` は副作用を持つ**. このエンドポイントは読取前に lazy migration を発火させる (snapshot → op-log 生成). 「まだ migration させたくない pre-W3 状態」のファイルを curl で観察する目的でこれを叩くと, その瞬間に migration が走ってしまう. 素の状態を保ちたいファイルには触れないこと. ブラウザに migration を起こさせて挙動を見たい場合は, クライアントで開く方を先にする.
- **`PUT /files/:id` は op-log を更新しない**. op-log への追記はクライアントの編集経路 (dispatch tap) 経由でのみ起きる. curl の `PUT` は snapshot だけを書き換えるので, op-log と snapshot に意図的な差を作ってフラグ切替の検証に使える (§3).
- **`data/` はリポジトリ管理外**. テストデータの投入・削除は自由に行ってよい.

## 関連

- [`operation-manual-for-dev.md`](./operation-manual-for-dev.md) — アプリ GUI の操作手順 (product-owner 向け動作確認マニュアル)
- `deepse/plans/step1-w3d-read-cutover.md` §10 — 本環境を使った W3d 読取 cutover の実機検証記録
