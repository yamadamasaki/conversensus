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

- `data/events.db*` — 操作ログ (op-log) の SQLite (`eventStore`). **これが唯一の正典**
- `data/<fileId>.json` — legacy snapshot。**step1 Phase 6 以降は新しく作られない**
  (p6-5a で書込を撤去)。Phase 6 より前に作られたファイルだけが残っており、
  デーモン起動時の一括移行で op-log 化される (移行後もファイル自体は残る)

## 2. テストデータの投入

### 2.1 GUI で作る

最も簡単なのは, クライアント画面でファイルを新規作成し, ノード・エッジを手で置く方法である (操作は operation-manual を参照). 少数の題材を用意するだけならこれで足りる.

### 2.2 HTTP API で投入する (再現可能)

同じ題材を毎回同じ形で用意したい場合は, デーモンの HTTP API を直接叩く. エンドポイントは以下.

| メソッド | パス | 用途 |
|----------|------|------|
| `POST` | `/files` | 新規ファイル作成 (空シート 1 枚を持つ). body: `{name?, description?, sheet?:{name?}}`. **genesis batch を直接書く** (snapshot は作らない) |
| `POST` | `/files/import` | ファイルのインポート (ID は再生成される) |
| `GET` | `/files` | ファイル一覧 (**op-log 単独**) |
| `DELETE` | `/files/:id` | ファイル削除 (**op-log 正典**: batches / branches / commits / marker を 1 tx で消す) |
| `GET` | `/files/:id/batches` | op-log (batch 列) 取得 |
| `POST` | `/files/:id/batches` | op-log への追記 (クライアントの編集経路) |
| `POST` | `/files/:id/batches/received` | 受信 batch の書き込み口 (marker も立てる) |

> **step1 Phase 6 で撤去された口**: `GET /files/:id` (snapshot 取得) と
> `PUT /files/:id` (全体保存) は **p6-3 で削除**した (404 になる)。読取は
> `GET /files/:id/batches` → クライアントの `projectFile`、書込は
> `POST /files/:id/batches` が唯一の口である。

**ID はすべて UUID でなければならない** (`fileId` / `sheetId` / `nodeId` / `edgeId` は Zod の branded UUID 型で検証される). ノードの座標・大きさは `sheets[].layouts[]` に `{nodeId, x, y, width?, height?}` として持たせる.

**題材の投入は GUI か import で行う**。`PUT /files/:id` が撤去された (Phase 6 p6-3) ため、
HTTP から中身を流し込む口は `POST /files/import` だけになった。以下は「2 ノード +
ラベル付きエッジ」を 1 枚のシートに持つファイルをインポートする例である.

```shell
uuid() { uuidgen | tr 'A-F' 'a-f'; }
FID=$(uuid); S1=$(uuid); N1=$(uuid); N2=$(uuid); E1=$(uuid)

curl -s -X POST http://localhost:3000/files/import \
  -H 'content-type: application/json' \
  -d "{
    \"version\":\"4\", \"id\":\"$FID\", \"name\":\"テスト題材\",
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
  }" -o /dev/null -w 'IMPORT %{http_code}\n'
```

> **ID は再生成される**: import は file / sheet / node / edge の ID をすべて振り直すので、
> 投入後の実 ID は `GET /files` と `GET /files/:id/batches` で確認する.


クライアントを再読み込みすれば, 投入したファイルが一覧に現れる. 複数シートにしたい場合は `sheets` 配列に要素を足す.

> **補足 (操作ログ正典化との関係)**: step1 Phase 6 以降、**作成・インポートの時点で
> op-log (genesis batch) が書かれる**. かつて存在した lazy migration (最初に開いた
> ときに snapshot から op-log を生成する仕組み) は p6-1 で撤去された — 作られた時点で
> op-log 正典なので不要になったためである.
>
> **「snapshot だけを持つ pre-Phase-6 のファイル」を再現したい**場合は、
> `data/<uuid>.json` に `GraphFile` の JSON を直接置いてデーモンを起動する.
> 起動時の一括移行がそれを op-log 化する (ログに `[migration] snapshot N 件を走査...`).
> HTTP からはこの状態を作れない.

## 3. 読取ソースの切替 (dual-read 安全弁) — **撤去済み**

かつてクライアントの読取ソースは `VITE_READ_FROM_OPLOG` で snapshot 直読へ戻せた.
**step1 Phase 6 p6-3 でこのフラグは撤去された**. 退避先の snapshot を維持していたのが
クライアントの書込 (`persistFile`) であり、それを消した時点で snapshot は古くなるため —
「op-log が読めない」より「1 世代前の内容が正常に見える」方が悪い、という判断である
(設計 `step1-phase6-w3e-snapshot-retire.md` §4.3).

読取経路は `GET /files/:id/batches` → `projectFile` の 1 本だけである.

> branch 側の安全弁 `VITE_BRANCH_FROM_OPLOG=false` (旧 PDS レコード複製方式へ戻す)
> も **p6-5b で撤去された**. p6-6 の実機 e2e で op-log 経路に退行が無いことを
> 確認してから、退行先だった `branchState.ts` ごと退役させている (§3.7 / §6.1).
> branch の作成・編集・commit・merge・close・delete は op-log の 1 本だけである.

## 4. クリーンな状態へのリセット

テストセッションの合間に初期状態へ戻すには, op-log (`events.db`) を消す.

### 4.1 個別ファイルを消す

**`DELETE /files/:id` だけで完全に消える** (step1 Phase 6 p6-2 以降). 削除の正典は op-log 側で,
batches / branches / commits / migration marker と legacy snapshot を 1 トランザクションで消す.
かつては snapshot しか消しておらず, op-log が残って同じ id の受信で内容が復活しうる穴があった.

```shell
FID=<消したい file_id>
curl -s -X DELETE http://localhost:3000/files/$FID -o /dev/null -w 'DELETE %{http_code}\n'
curl -s http://localhost:3000/files   # [] になれば一覧から消えている
```

> **PDS 上の batch は消えない**. ログイン中の別端末が同じファイルを持っていれば,
> 次の発見 (`discoverRemoteFiles`) で materialize され直す. ローカルだけを空にしたいなら
> ログアウトするか, PDS 側のレコードも別途消すこと.

### 4.2 全部まっさらにする

すべてのテストデータを捨てて空から始めたいなら, デーモンを止めて `data/` の中身を消すのが最も確実である.

```shell
# dev:server を止めてから
rm -f data/*.json data/events.db*
```

`*.json` (legacy snapshot) は Phase 6 以降そもそも作られないので, 通常は `events.db*` を
消すだけで足りる.

`data/` は gitignore 済みなので, 消してもリポジトリには影響しない. 次回 `dev:server` 起動時に `events.db` は自動的に再作成される.

## 5. 2 台目 (device B) を同じマシンで動かす

remote 同期 (step1 W3d5) の検証では, 「別端末が PDS 経由で受け取れるか」を見たいことがある.
`PORT` と `DATA_DIR` を分ければ, 同じマシン上に **完全に独立した 2 組目のデーモン + クライアント**
を立てられる. PDS は 1 つを共有する (それが検証したい経路である).

```shell
# device B のデーモン (:3001, データは data-b/)
PORT=3001 DATA_DIR=data-b bun run dev:server

# device B のクライアント (:5175). 宛先デーモンを :3001 に向ける
cd src/client && VITE_API_BASE=http://localhost:3001 bunx vite --port 5175 --strictPort
```

`data-b/` は `.gitignore` の `data-*/` パターンに含まれるので, 消してもリポジトリに影響しない.
事前の `mkdir` は要らない — ディレクトリが無ければ `GET /files` は空一覧を返し, 最初の書込で
`Bun.write` が親ごと作る (`storage.ts`).

> **⚠️ 「同じファイルへ両方から書き込む」構成は step1 Phase 4d 以降で解禁**
> (`deepse/plans/step1-phase4d-receive.md`). W3d5 時点では remote 経路が **送信 (push) のみ**で
> 受信 (import) が無く, device B のデーモンが自前の genesis batch を独立生成して
> **clock が衝突する 2 系統の genesis** が remote に載る恐れがあったため, 検証を
> 「A が送ったものを B が取得できるか」に限定していた. Phase 4d で受信経路が入り,
> 端末一意の actor (`did#deviceId`) と `clock → actor → id` の全順序が入ったので,
> **双方向の編集を前提に検証してよい** (それが 4d-6 の検証内容である).
> **genesis actor の batch も Phase 4e-0 以降は remote へ push される**
> (`deepse/plans/step1-phase4e-bootstrap.md` §3.1 — genesis は content-addressed で
> 端末間べき等なので, 同一 snapshot 由来なら id が一致し PDS 上で dedup される).
>
> 画面反映は Phase 4e-3 で入った — 受信着地後に再 projection が走り, 開いている
> ファイルへ反映される. ただし**画面は依然として証拠にしない** (§5.1 冒頭の理由).
> 検証は下の §5.1 / §5.2 のスクリプトで行うこと.

### 5.1 PDS 上のレコードを直接検査する

**「画面に載ったか」では remote 送信を検証できない**. 現状の跨端末伝播は legacy snapshot 経路が
肩代わりしており, batch op-log が載っていなくても「載ったように見える」偽の確証が起きる
(同 §4.1 / critic A2). PDS の batch コレクションそのものを見ること.

```shell
bun run scripts/inspect-remote-batches.ts                      # 受入基準を機械判定
bun run scripts/inspect-remote-batches.ts --dump               # 全 batch を clock 順に一覧
PDS_URL=http://localhost:2583 REPO=alice.test \
  bun run scripts/inspect-remote-batches.ts                    # 宛先を明示する場合
```

検査項目は genesis push・id 収束 (4e-0) / presentation 非搭載 (D7) / sheetId 往復 / clock 衝突なし の 4 つ.
genesis の検査は Phase 4e-0 で反転した — 旧 C1 (genesis 非 push) は削除され, いまは
「genesis が remote に載っており, かつ同一 fileId に複数の genesis id が分岐していない」
ことを見る (Phase 4e 設計 §1.2 MED1 の実機確認).
`listRecords` は公開エンドポイントなのでログインは要らない. このスクリプトはクライアントの pull と
同じ mapper (`recordToBatch`) を通すので, **別端末が Batch に戻せること** の確認も兼ねる.

### 5.2 ローカル正典 (受信結果) を検査する

§5.1 が PDS 側 = **送信**結果を見るのに対し, こちらは端末のローカル op-log = **受信**結果を見る.
受信の検証はこちらが主役になる (step1 Phase 4d).

**「op-log に行が増えた」も証拠にならない**ことに注意する. シート作成 batch を受け取っていない
状態で content batch だけ届くと, 着地はするが projection から無言で落ちる (設計 §1.10).
基準 6 がこの穴を塞ぐ.

```shell
# device B を検査 (自端末のみの検査)
DAEMON_URL=http://localhost:3001 FILE_ID=<uuid> bun run scripts/inspect-local-oplog.ts

# 全基準を検査する (収束・marker・取りこぼしを含む)
DAEMON_URL=http://localhost:3001 PEER_URL=http://localhost:3000 DATA_DIR=data-b \
  PDS_URL=http://localhost:2583 REPO=alice.test \
  bun run scripts/inspect-local-oplog.ts --snapshot /tmp/deviceB.json

bun run scripts/inspect-local-oplog.ts --dump    # 全 batch を clock 順に一覧
```

- `FILE_ID` はファイルが 1 つだけなら省略できる. 複数あると候補を出して止まる.
- 環境変数を渡さなかった検査は **未実施として一覧に出る** (黙って PASS にはしない).
- **基準 2 (べき等) は 2 回実行して比較する**: 1 回目で `--snapshot` に記録 → 再受信させる →
  同じコマンドを再実行. 1 回目は必ず PASS (記録するだけ) なので, 2 回目まで回して初めて判定になる.
- `DATA_DIR` を渡すと `events.db` の migration marker を直接読む. これは元々「marker が無いまま
  受信 batch があると, 次の読み取りで lazy migration が受信内容を破棄する」(設計 §1.8) 事故を
  検出するための検査だった. **lazy migration は Phase 6 p6-1 で撤去された**ので破棄の危険自体は
  無くなったが, marker は「op-log がこのファイルの正典である」という宣言として残っており,
  受信経路が marker を立てていることの確認として引き続き有効である.

## 6. 注意点 (ハマりどころ)

- **`GET /files/:id/batches` の副作用は無くなった** (step1 Phase 6 p6-1). かつては読取前に lazy migration を発火させたため「素の pre-W3 状態を保ちたいファイルには触れない」注意が要ったが, 移行は**デーモン起動時に一括で**行われるようになったので, curl で観察しても状態は動かない.
- **snapshot を書く口はもう無い** (Phase 6 p6-5a). `PUT /files/:id` は撤去済みで, `POST /files` / `POST /files/import` も snapshot を作らない. op-log と snapshot に意図的な差を作る検証 (旧 §3) は成立しない.
- **`data/` はリポジトリ管理外**. テストデータの投入・削除は自由に行ってよい.
- **`GET /files` は op-log 単独** (Phase 6 p6-2). ファイルが一覧に出ないときは snapshot ではなく op-log を見ること — 構造 op (`sheet.create`) を持たない孤児 batch だけの file_id は一覧に出ない仕様である.

## 7. Safari で使い込む (WebKit 適合の常時検証)

step1 Phase 7 完了後の「人間が実際に使い込むフェイズ」では, **日常のドライバを Chrome ではなく
Safari にする** (2026-07-31 のユーザー決定). 追加の環境構築は要らず, ブラウザを変えるだけである.

### 7.1 なぜ Safari か

配布形態の到達点である **Tauri v2 は, macOS ではネイティブの WKWebView 上で動く**. これは
Safari と同じ **WebKit** であり, Chrome (Blink) とは描画も JavaScript API も違う.

つまり **Chrome での「動いた」は Tauri の証拠にならない**. 使い込みで積み上げる機能が増えるほど,
後から WebKit で検証し直す対象が比例して増えていく. 逆に最初から Safari で使い込めば,
**使い込みそのものが WebKit 適合の証跡になり, 検証を後払いしなくて済む**.

> **Safari と WKWebView は同一ではない** (対応 API や既定の挙動に差がある). あくまで近似であり,
> どこまで代理になるかは Phase 8a の spike (S4) で確かめる —
> [`../plans/step1-phase8a-r1-spike.md`](../plans/step1-phase8a-r1-spike.md) §4 S4.

### 7.2 手順

§1 のとおりサーバを起動し, **Safari で** `http://localhost:5173/` を開くだけである.

```shell
bun run dev:server   # :3000
bun run dev:client   # :5173
```

デーモンの CORS は origin が `localhost` で始まれば通す設定なので (`src/server/src/index.ts` の
`cors()`), ブラウザを変えても追加設定は要らない.

**Web インスペクタを必ず開いておくこと**. Safari は開発者向け機能が既定で無効なので,
設定 → 詳細 から Web 開発者用の機能を表示する (文言は Safari のバージョンによって違う) と
「開発」メニューが出る.

> **コンソールを見ずに使い込むと, WebKit 固有の失敗を無言で見逃す**. step1 が Phase 7 まで
> 一貫して守ってきた「無言の失敗を作らない」([`../plans/step1-phase7-range-fetch.md`](../plans/step1-phase7-range-fetch.md) §3.6)
> と同じ理由である —
> W3d5 では PDS への送信が数週間にわたり全滅していたのに, 画面が正常に見えたため
> 気づけなかった前例がある.

### 7.3 既知の壊れている箇所 (使い込みの前に知っておく)

GitHub issue **#51「non-chrome web ブラウザに対応する」** に「少なくとも safari では動いていない.
import ボタンが, はみ出して表示されているし, クリックしても実行されていない」と報告済みである.

| 箇所 | コード | 症状 |
|------|--------|------|
| import ボタン | `src/client/src/Sidebar.tsx:199` (`<input type="file">` + `FileReader`) | はみ出して表示され, クリックしても実行されない (#51) |
| 貼り付け (Cmd+V) | `src/client/src/GraphEditor.tsx:760` (`navigator.clipboard.read()`) | 未報告だが, Safari はユーザー操作の要件と対応フォーマットが Chrome と違うので挙動差が出うる |

これらは **Tauri 化したときにそのまま持ち越される不具合**である (同じ WebKit なので).
使い込みフェイズで潰しておけば, Phase 8 は配布の作業だけになる.

### 7.4 見つけたものをどこへ書くか

CLAUDE.md の Issue ドリブン開発に従い, 使い込みで出た機能追加・不具合は GitHub Issues に書く.

- **WebKit 固有と思われるもの** → #51 にぶら下げる (コメントで追記). 個別 issue に切り出すのは,
  修正の単位が大きくなってからでよい
- **ブラウザに依らないもの** → 通常どおり新規 issue

**切り分けは 2 ブラウザで同じ操作をするのが最も安い**. Chrome で再現しなければ WebKit 固有,
両方で壊れていればアプリのロジックの問題である.

### 7.5 Safari 固有の観察点 — localStorage

クライアントは localStorage に 3 つの状態を持つ.

- `atproto_session` — ATProto のセッション
- deviceId — actor (`<did>#<deviceId>`) の端末側の識別子 (`src/client/src/sync/actor.ts`)
- rkey 移行の marker (DID 単位, `src/client/src/sync/migrateRemoteRkey.ts`)

Safari はスクリプトが書いた保存領域の寿命の扱いが Chrome と違うため, **これらが消えることがありうる**.
消えても正しさは失われない設計になっている (deviceId が変わっても actor が 1 つ増えるだけ, marker が
消えても移行は差分計算でやり直せる) が, **「昨日までログインしていたのに今日は未ログイン」を
アプリの不具合と誤診しないこと**. 判別は Web インスペクタの ストレージ タブで行う.

### 7.6 Chrome を使い続けてよい場面

- アシスタント (Chrome MCP) による自動検証 — 現状 Chrome にしか接続できない
- WebKit 不具合の切り分け (§7.4 の 2 ブラウザ比較)
- `scripts/inspect-*.ts` による検査 — ブラウザに依存しない

## 関連

- [`operation-manual-for-dev.md`](./operation-manual-for-dev.md) — アプリ GUI の操作手順 (product-owner 向け動作確認マニュアル)
- [`../plans/step1-phase8a-r1-spike.md`](../plans/step1-phase8a-r1-spike.md) — R1 (ARM64/Rosetta) 切り分け spike. §7 の Safari 戦略が成立するかの裏取り (S4) を含む
- `deepse/plans/step1-w3d-read-cutover.md` §10 — 本環境を使った W3d 読取 cutover の実機検証記録
