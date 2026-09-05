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

**画面からの削除と `DELETE /files/:id` は別のものである** (ANA-127 以降).

| | 何が起きるか | いつ使うか |
|---|---|---|
| 画面の「ファイルを削除」 | op-log に `file.remove` (tombstone) を 1 件**追記**する. 行は消えない | 通常の削除. **PDS 経由で他端末にも伝わる** |
| `DELETE /files/:id` | batches / branches / commits / migration marker と legacy snapshot を 1 tx で**物理削除**する | 「この端末の op-log ごと無かったことにする」保守用 |

```shell
FID=<消したい file_id>
curl -s -X DELETE http://localhost:3000/files/$FID -o /dev/null -w 'DELETE %{http_code}\n'
curl -s http://localhost:3000/files       # 一覧から消えている
curl -s http://localhost:3000/files/ids   # 既知集合からも消えている (物理削除なので)
```

`GET /files` は tombstone を持つファイルを隠すが, `GET /files/ids` (この端末が op-log を
持つ file_id の全集合) には**削除済みも現れる**. 画面の削除の後にこの 2 つを見比べると,
tombstone が残っていること = 「消えたが忘れてはいない」状態を確認できる.

> **どちらの経路でも PDS 上の batch は消えない** (GC は非目標). ただし**復活するかどうかは
> 経路によって変わる**:
>
> - 画面から削除した → PDS の**最大 clock に tombstone が載る** → 他端末の発見
>   (`discoverRemoteFiles`) は着地レコードを見て materialize しない. 復活しない.
> - `DELETE /files/:id` だけした (tombstone を作らずに消した) → PDS には元の batch しか
>   無いので, **次の発見で materialize され直す**. ローカルだけを空にしたいならログアウトするか,
>   PDS 側のレコードも別途消すこと.
>
> つまり「テストデータを綺麗に消したい」なら**画面から削除してから** `DELETE /files/:id` する
> のが確実である (tombstone が PDS に残り, 物理削除した後も戻ってこない).

### 4.2 全部まっさらにする

すべてのテストデータを捨てて空から始めたいなら, デーモンを止めて `data/` の中身を消すのが最も確実である.

```shell
# dev:server を止めてから
rm -f data/*.json data/events.db*
```

> **⚠️ `*.json` も必ず消すこと.** Phase 6 以降 snapshot は作られないが, **それより前に
> 作られた `*.json` は残っている**. `events.db*` だけを消すと, 次回起動の一括移行が
> その json を拾って **File を復活させる**. 「消したのに 1 つだけ残る」はこれである
> (2026-09-05 に実際に起きた — `data/aaaa1111-….json` が 2026-07-29 のまま残っていた).

`data/` は gitignore 済みなので, 消してもリポジトリには影響しない. 次回 `dev:server` 起動時に `events.db` は自動的に再作成される.

### 4.3 PDS 側も消す

`data/` を消すのは**この端末のローカル正典だけ**である. PDS 上のレコードは残るので,
次に同期すると戻ってくる. remote まで空にしたいなら:

```shell
ATPROTO_IDENTIFIER=alice.test ATPROTO_PASSWORD=devpassword123 \
  bun run clear-pds-data          # DRY_RUN=1 を付けると件数だけ表示する
```

アカウント情報は残り, アプリケーションのレコードだけが消える. **アカウントごとに実行する**
— repo はアカウント単位なので, `bob.test` の分は別に消す必要がある.

> **step2 の多アクタ検証では消し残しが効く.** 他 actor の repo に古い batch や判断が
> 残っていると, それがそのまま名簿と projection に入る. 「なぜこの人が参加者なのか」が
> 分からなくなったら, まず両方の repo を空にしてやり直すこと.


## 5. 2 人目 (actor B) — 別アカウントで動かす (step2 Phase 0)

§5 の device B は **同じアカウント (同じ DID) の 2 台目**である. step2 の多アクタ同期は
**別の DID が別の repo を持つ**構成を要求するので, これとは別に 2 つ目のアカウントが要る.

現状の開発 PDS には既に 2 つある.

| ハンドル | DID | パスワード |
| --- | --- | --- |
| `alice.test` | `did:plc:jiceejfkqacmynibpou3kkxk` | `devpassword123` |
| `bob.test` | `did:plc:ag2ritx6qpujmphxjj2upd53` | 同上 |

DID は `curl -s "http://localhost:2583/xrpc/com.atproto.identity.resolveHandle?handle=bob.test"`
で確かめられる (PDS を作り直すと変わる).

3 人目以降を足す場合は [`operation-manual-for-dev.md`](./operation-manual-for-dev.md) の
「アカウントの作成」に従う (招待コードを発行 → `createAccount`).

### 5.0 他 actor の repo を読む

step2 Phase 0 で `collections.ts` の**読み出し**を repo 引数化した. 省略すると自分の repo,
渡すと相手の repo を読む. **書き込みは引数化していない** — ATProto の credential は自分の
repo のものしか無いので, 他者の repo へは書けない.

実際に 2 つの DID をまたいで読めることは U6-P1 スパイクで確認済である.

```shell
bun run src/client/src/spikes/u6/p1.spike.ts
```

> **⚠️ 相手の repo の File は全部見える.** `listFileHeads` を他 actor の repo に回すと,
> 共同作業していない File も含めてその actor の File が全部返る (実測 23 個).
> `discoverRemoteFiles` は未知の fileId を新しい File として materialize するので,
> **発見経路にそのまま繋いではならない** (→ [u6-p1-report](../spikes/u6-p1-report.md)).

> **⚠️ 1 ページ読みでは届かない.** 相手の repo は自分のより大きいのが普通なので,
> `listRecords` の 1 ページ (100 件) では目的の batch に届かないことがある.
> 範囲取得 (`listByFile` / `listByRkeyPrefix`) を使うこと. これは単一端末では効率の話
> だったが, **多アクタでは正しさの話になる**.

### 5.1 2 アカウントで共同編集する (step2 Phase 2)

Phase 2 で「書くのは自分の repo だけ, 読むのは N 人の repo」が動くようになった.
検証には **alice と bob がそれぞれ自分のデーモンを持つ**構成が要る — ローカル正典は
端末 (デーモン) ごとなので, 1 つのデーモンを 2 アカウントで共有してはならない.

構成は §6 (device B) と同じで, **ログインするアカウントだけが違う**.

```shell
# alice 側 (既定)
bun run dev:server            # :3000, data/
bun run dev:client            # :5173

# bob 側
PORT=3001 DATA_DIR=data-b bun run dev:server
cd src/client && VITE_API_BASE=http://localhost:3001 bunx vite --port 5175 --strictPort
```

`:5173` で `alice.test`, `:5175` で `bob.test` にログインする (パスワードは両方
`devpassword123`). セッションは `localStorage` に載るので, **オリジンが違えば同じ
ブラウザで並べてよい** (`:5173` と `:5175` は別オリジンである).

#### ⚠️ ウィンドウを並べる. タブで重ねない

定期同期は **タブが不可視のとき止まる** (`document.hidden`). 裏で開いたままのタブが
30 秒ごとに参加者全員の repo を読み続けないための判断だが, **同じウィンドウの別タブに
すると, 見ていない方が同期しない**. 2 つのウィンドウを並べること (並べていれば,
フォーカスが無くても `hidden` にはならない).

可視に戻った瞬間には即座に同期が走るので, タブを切り替えた場合も戻せば追いつく.

#### 手順

1. alice で File を作り, ノードをいくつか置く
2. alice の参加者ダイアログで `bob.test` を依頼し, 参加コードをコピーする
3. bob の参加ダイアログにコードを貼る → **承認の前に「誰が・あなたを・どのファイルに」が
   名前で出る** (Phase 1)
4. 承認する → **bob のサイドバーにその File が現れる** (S3)
5. 双方で編集して, 30 秒以内に相手の画面へ出ることを見る (S4)

#### 見るもの

| | 観点 | 確かめ方 |
| --- | --- | --- |
| 1 | alice の編集が bob のグラフに出る (**完了基準 1**) | 画面 + `[sync] read N participant repo(s)` |
| 2 | 取り消した後の操作が反映されない (**完了基準 3**) | alice が bob を取り消す → bob が編集 → alice に出ない. `outside period` の数が増える |
| 3 | 開き直さずに反映される (**#202**) | 同一アカウントの 2 窓でも見られる (§6) |
| 4 | 相手の無関係な File が並ばない (**U6-P1**) | bob のサイドバーに alice の他の File が無い |
| 5 | 相手の op-log を複製していない (**S0**) | 下記 |

#### コンソールに出るもの

```
[sync] read 1 participant repo(s): 12 batch(es) in period, 3 new, 0 outside period
[participation] joined 1 file(s), 12 batch(es)
```

`outside period` が 0 でないことは**異常ではない** — 取り消された actor の repo には
取り消し後の op がそのまま残るので, この数は「それが手元に入っていない」ことの証拠に
なる (観点 2 の観測点である).

#### 観点 5: 相手の op-log が複製されていないこと

**bob の repo に alice が書いた batch があってはならない.** `catchUp` はローカル正典の
batch を remote へ積み直すので, 柵 (S0) が無いと受信した alice の分を bob の repo へ
書き戻してしまう.

```shell
REPO=bob.test bun run scripts/inspect-remote-batches.ts --dump
```

`actor=` の欄に出てよいのは **bob の DID** と, File の起源である `genesis` だけである.
`did:plc:jicee…` (alice) が出たら S0 が効いていない.

#### 名簿がおかしいときは判断ログを直に見る

名簿は**複数の repo に分かれている**ので、どれか 1 つの repo を見ても「なぜこうなるのか」は
分からない。画面に出るのは畳み込みの結果だけで、**捨てられた op は行を持たない**
(捨てられた依頼は誰にも見えない)。

```shell
REPOS=alice.test,bob.test bun run scripts/inspect-judgments.ts               # File の一覧
REPOS=alice.test,bob.test FILE_ID=<uuid> bun run scripts/inspect-judgments.ts --dump
```

全 repo を読んで畳み込み、**参加中 / 依頼中 / 離脱中**と**捨てた op とその理由**を出す。

> **⚠️ 起点 (`participation.genesis`) が 2 つある状態を特に見る。**起点は File に 1 つで、
> 2 つ目は `duplicateGenesis` で捨てられる。捨てられた側の actor は参加者でなくなり、
> その actor が出した依頼も承認も pre 条件で連鎖して落ちるので、**名簿が丸ごと壊れる**。
> しかも起点の clock は 0 固定なので、後から書いても順序で覆せない。
> 症状は「承認しても File が現れない」で、レコードを消すまで直らない。
> (2026-09-05 に実際に起きた。原因は修正済 — `ensureOwnGenesis` が手元に 1 件も無い
> File を「自分の File」と判定していた)

#### 参加期間の外を読んでいないこと

alice が bob を取り消した後も, bob の repo のレコードは減らない (相手は消さない).
alice 側のローカル正典に **取り消し後の bob の batch が入っていない**ことを見る.

```shell
FILE_ID=<uuid> bun run scripts/inspect-local-oplog.ts --dump
```

## 6. 2 台目 (device B) を同じマシンで動かす

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
> ファイルへ反映される. ただし**画面は依然として証拠にしない** (§6.1 冒頭の理由).
> 検証は下の §6.1 / §6.2 のスクリプトで行うこと.

### 6.1 PDS 上のレコードを直接検査する

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

### 6.2 ローカル正典 (受信結果) を検査する

§6.1 が PDS 側 = **送信**結果を見るのに対し, こちらは端末のローカル op-log = **受信**結果を見る.
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

## 7. 注意点 (ハマりどころ)

- **`GET /files/:id/batches` の副作用は無くなった** (step1 Phase 6 p6-1). かつては読取前に lazy migration を発火させたため「素の pre-W3 状態を保ちたいファイルには触れない」注意が要ったが, 移行は**デーモン起動時に一括で**行われるようになったので, curl で観察しても状態は動かない.
- **snapshot を書く口はもう無い** (Phase 6 p6-5a). `PUT /files/:id` は撤去済みで, `POST /files` / `POST /files/import` も snapshot を作らない. op-log と snapshot に意図的な差を作る検証 (旧 §3) は成立しない.
- **`data/` はリポジトリ管理外**. テストデータの投入・削除は自由に行ってよい.
- **`GET /files` は op-log 単独** (Phase 6 p6-2). ファイルが一覧に出ないときは snapshot ではなく op-log を見ること — 構造 op (`sheet.create`) を持たない孤児 batch だけの file_id は一覧に出ない仕様である.

## 8. Safari で使い込む (WebKit 適合の常時検証)

step1 Phase 7 完了後の「人間が実際に使い込むフェイズ」では, **日常のドライバを Chrome ではなく
Safari にする** (2026-07-31 のユーザー決定). 追加の環境構築は要らず, ブラウザを変えるだけである.

### 8.1 なぜ Safari か

配布形態の到達点である **Tauri v2 は, macOS ではネイティブの WKWebView 上で動く**. これは
Safari と同じ **WebKit** であり, Chrome (Blink) とは描画も JavaScript API も違う.

つまり **Chrome での「動いた」は Tauri の証拠にならない**. 使い込みで積み上げる機能が増えるほど,
後から WebKit で検証し直す対象が比例して増えていく. 逆に最初から Safari で使い込めば,
**使い込みそのものが WebKit 適合の証跡になり, 検証を後払いしなくて済む**.

> **Safari と WKWebView は同一ではない** (対応 API や既定の挙動に差がある). あくまで近似だが,
> **どこまで代理になるかは Phase 8a の spike (S4) で実測し, 代理として機能することを確認した**
> (2026-08-02) — [`../plans/step1-phase8a-r1-spike.md`](../plans/step1-phase8a-r1-spike.md) §7 S4.
>
> | 対象 | Chrome (Blink) | Safari (WebKit) | Tauri (WKWebView) |
> |---|---|---|---|
> | テキスト描画の鮮明さ | 鮮明 | ぼやける | **ぼやける** |
> | import ボタン (#51, §8.3) | 正常 | 壊れる | **同じ壊れ方** |
>
> Safari と Tauri が一致し Chrome だけが違った. **Safari で見つかる壊れ方は Tauri でも起きる**
> と考えてよい. なお「ぼやけ」は不具合ではなく Blink と WebKit のテキストラスタライズの差である
> (検証機は非 Retina モニタで `devicePixelRatio: 1` が正しい値だった).

### 8.2 手順

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

### 8.3 既知の壊れている箇所 (使い込みの前に知っておく)

GitHub issue **#51「non-chrome web ブラウザに対応する」** に「少なくとも safari では動いていない.
import ボタンが, はみ出して表示されているし, クリックしても実行されていない」と報告済みである.

**2026-08-13 (ANA-125) に, ここに挙がっていたものは全部直した.** 記録として残す —
同じ形の不具合が出たときの見分け方になるからである.

| 箇所 | 症状 | 状態 |
|------|------|------|
| import ボタン | はみ出して表示され, クリックしても実行されない (#51) | ✅ 直した (`eff8372`). flex の `min-width: auto` で入力欄が縮まないため. **Chromium でも溢れており**, WebKit でだけサイドバーの端を越えて押せなくなっていた |
| 貼り付け (Cmd+V) | Safari は権限とフォーマットの要件が Chrome と違うので挙動差が出うる | ✅ **実 Safari で確認済み, 問題なし** (2026-08-13). 画像の貼り付けも, 選択中の画像ノードへの差し替えも動く |
| ノードのサイズ変更 | `ResizeObserver loop completed with undelivered notifications.` が未処理例外として数百件出てコンソールが埋まる (**WebKit のみ**) | ✅ 直した (`c4bac9b`). 出所は `@xyflow/react` の中で直す場所が無いため, **そのメッセージだけ**握り潰している |
| トラックパッドのタップ | 掴んだ先 (ノード or 画面全体) がカーソルに付いて動き続け, もう一度クリックするまで止まらない (**WebKit のみ**) | ✅ 直した (`d7dca2e`). WebKit はタップを `buttons=0` で配送し, `mouseup` を `mousedown` より先に配送することがある. 移動の `buttons` が 0 ならドラッグを打ち切る |
| import した後の同期 | どのファイルで何をしても `putRecord` が 400 (`got 740.5`) になり, **remote 送信が全部止まる** (ブラウザ非依存) | ✅ 直した (`2f1e6a3`). ATProto に float 型が無く, genesis 経路が座標を丸めていなかった |

**WebKit で見つかるものは Tauri (WKWebView) にそのまま持ち越される** (同じエンジンなので).
使い込みフェイズで潰しておけば, Phase 8 は配布の作業だけになる.

**見送っているもの**: 文字のボケ (ANA-104). `textarea` の編集中がほとんどで, 何か操作すると
解消する. 直せなくはないが自動判定できず保守負債になるため見送った
(根拠と再開条件は [`../plans/step1-refinement-ana125-safari.md`](../plans/step1-refinement-ana125-safari.md) §7.1).

### 8.4 見つけたものをどこへ書くか

CLAUDE.md の Issue ドリブン開発に従い, 使い込みで出た機能追加・不具合は GitHub Issues に書く.

- **WebKit 固有と思われるもの** → #51 にぶら下げる (コメントで追記). 個別 issue に切り出すのは,
  修正の単位が大きくなってからでよい
- **ブラウザに依らないもの** → 通常どおり新規 issue

**切り分けは 2 ブラウザで同じ操作をするのが最も安い**. Chrome で再現しなければ WebKit 固有,
両方で壊れていればアプリのロジックの問題である.

### 8.5 Safari 固有の観察点 — localStorage

クライアントは localStorage に 3 つの状態を持つ.

- `atproto_session` — ATProto のセッション
- deviceId — actor (`<did>#<deviceId>`) の端末側の識別子 (`src/client/src/sync/actor.ts`)
- rkey 移行の marker (DID 単位, `src/client/src/sync/migrateRemoteRkey.ts`)

Safari はスクリプトが書いた保存領域の寿命の扱いが Chrome と違うため, **これらが消えることがありうる**.
消えても正しさは失われない設計になっている (deviceId が変わっても actor が 1 つ増えるだけ, marker が
消えても移行は差分計算でやり直せる) が, **「昨日までログインしていたのに今日は未ログイン」を
アプリの不具合と誤診しないこと**. 判別は Web インスペクタの ストレージ タブで行う.

### 8.6 Chrome を使い続けてよい場面

- アシスタント (Chrome MCP) による自動検証 — 現状 Chrome にしか接続できない
- WebKit 不具合の切り分け (§8.4 の 2 ブラウザ比較)
- `scripts/inspect-*.ts` による検査 — ブラウザに依存しない

### 8.7 WebKit の自動検証 (Playwright E2E, ANA-125)

**使い込みで見つけたものを機械判定として残す口**である. 設計は
[`../plans/step1-refinement-ana125-safari.md`](../plans/step1-refinement-ana125-safari.md).

```shell
bun run test:e2e          # webkit (本命) + chromium (対照)
bun run test:e2e:webkit   # webkit だけ
```

- **サーバの起動は要らない**. Playwright が**専用ポートで自前のデーモンとクライアントを
  起動する** (daemon `:3100` / client `:5174`). §1 で立てた `:3000` / `:5173` は触らない
- **利用者の `data/` は汚れない**. E2E のデーモンは `DATA_DIR=data-e2e` を使い,
  **起動のたびに消す**. `data-e2e/` は gitignore 済 (`data-*` のパターン)
- **ポートを分けているのは意図的である**. 同じオリジンだと `/blobs/:cid` が
  `immutable` で返るためブラウザの HTTP キャッシュが混ざる (§6 のハマりどころと同じ罠)
- テストは `tests/*.spec.ts`, 仕様書は同じ場所に `tests/*.spec.md` を置く.
  `bunfig.toml` が `tests/` を bun のランナーから外しているので `bun test` とは衝突しない
- **合成イベントで再現しないものは書かない** — トラックパッド由来の挙動・クリップボード・
  ファイル選択ダイアログ・描画品質は §8.3 のチェックリスト (人間) の領分である

## 9. Tauri (デスクトップアプリ) で動かす

**Phase 8 (2026-08-14) で, アプリとして単体で動く形になった.** 下の §9.0 が現在の手順で,
§9.1 以降は spike 当時の記録である.

### 9.0 いまの手順 (Phase 8 S0〜S5)

```shell
bun run app:dev      # 開発中に動かす (デーモンも自動で立つ)
bun run app:build    # .app と .dmg を作る
```

`app:build` は **デーモンのコンパイルと Tauri 用クライアントビルドを自分で走らせる**ので,
事前の準備は要らない. 出力は `src-tauri/target/release/bundle/` の下.

**知っておくべきこと:**

- **アプリは独立している.** デーモン (57MB のバイナリ) を同梱しており, bun も
  リポジトリも要らない. `bun run dev:server` を立てておく必要は無い
- **データは別の場所にある** — `~/Library/Application Support/site.conversensus.app/`.
  開発中の `data/` とは混ざらない. **アプリは空の状態から始まる**ので,
  既存のファイルを持ち込みたければ export / import で運ぶ
- **ポートは 39847** (開発用の 3000 とは分けてある). 開発サーバと同時に動かしてよい
- **終了するとデーモンも終わる.** 強制終了された場合も, デーモンが親の消失を検知して
  自分で終わる (残ると次回起動が `EADDRINUSE` で壊れるため)
- **ログは `~/Library/Logs/site.conversensus.app/`** にある.
  デーモンの出力もここへ流れるので, 起動しないときはまずこれを見る

**初回起動 (配布物を受け取った場合)**: **署名していない**ので, ダウンロードした
`.dmg` から入れたアプリは Gatekeeper に止められる. **右クリック → 開く** で一度許可すれば,
以後は普通に起動できる. 「壊れているので開けません」とは出ない (バンドルを ad-hoc 署名して
あるため) が, **「開発元を検証できません」は出る** — これは正常である.

> 自分でビルドした `.app` には quarantine 属性が付かないので, 手元では警告自体が出ない.
> 配った場合の挙動を確かめたいときは `spctl -a -vv -t exec <app>` で判定だけ見られる.

### 9.1 spike 当時の記録 (2026-08-02)

Phase 8a の spike で **Tauri v2 のシェルに conversensus クライアントを載せて
動かすところまで実測済み**である. そのとき **§1 の手順のままでは動かず, 2 点の追加が要る**
ことが分かったので, 先に記録しておく. 詳細と根拠は
[`../plans/step1-phase8a-r1-spike.md`](../plans/step1-phase8a-r1-spike.md) §7.2.

#### §1 に足りない 2 点 (当時)

| 事項 | 必要な対応 |
|---|---|
| **デーモンの CORS** | `ALLOWED_ORIGIN='tauri://localhost'` を渡す |
| **クライアントのビルド** | `VITE_API_BASE=http://localhost:3000` を明示する |

```shell
# デーモン: Tauri の origin を許可する
ALLOWED_ORIGIN='tauri://localhost' bun run dev:server

# クライアント: ローカルデーモンを向いた dist を焼く
VITE_API_BASE=http://localhost:3000 bun run --cwd src/client build
```

**なぜ要るか**:

- **CORS**: デーモンの `cors()` は origin が `http://localhost:` で始まるものだけ通す
  (`src/server/src/index.ts`). macOS の Tauri v2 は custom scheme を使うので origin は
  **`tauri://localhost`** であり, この前綴りに該当しない. 既存の `ALLOWED_ORIGIN` env が
  ちょうど逃げ道になる (コード変更は要らない).
- **`VITE_API_BASE`**: `bun run --cwd src/client build` は vite の production モードなので
  `src/client/.env.production` を読み, **dist に VPS の URL (`https://api.conversensus.site`)
  が焼き込まれる**. 明示しないと Tauri アプリはローカルデーモンではなく本番 VPS と話す.
  **ATProto ログインは本物の PDS で成立してしまうため画面は一見正常に見え, 気づきにくい**
  (spike ではこの切り分けに 40 分を要した).

#### 要らないもの

- **Info.plist の ATS (App Transport Security) 例外は不要**. `tauri://localhost` (secure context)
  から `http://localhost:3000` への fetch は素で通る. A/B で確認済み
- **CSP の緩和は不要**. `bun create tauri-app` が生成する `tauri.conf.json` は `"csp": null`

#### この環境で Tauri の中身を観測する方法

macOS の権限設定により, **`screencapture` (画面収録) も `osascript` (アクセシビリティ) も
devtools も使えない**ことがある. そのとき使える代替手段:

- **webview が起動したかの判定** — アプリを起動すると WKWebView のヘルパープロセス
  (`com.apple.WebKit.GPU` / `.Networking` / `.WebContent`) が直後の PID で生える.
  アプリを kill すると道連れに落ちるので, 因果まで確認できる
- **webview 内部の値を機械的に採る** — `frontendDist` を差し替えて診断ページを読ませ,
  `devicePixelRatio` や機能検出の結果を **localhost のプローブサーバへ fetch で送り返す**.
  spike ではこれで `origin` / `devicePixelRatio` / `navigator.clipboard.read` の有無などを取った

## 関連

- [`operation-manual-for-dev.md`](./operation-manual-for-dev.md) — アプリ GUI の操作手順 (product-owner 向け動作確認マニュアル)
- [`../plans/step1-phase8a-r1-spike.md`](../plans/step1-phase8a-r1-spike.md) — R1 (ARM64/Rosetta) 切り分け spike (実施済). §7 の Safari 戦略の裏取り (S4) と, §8 の根拠となった実測記録を含む
- `deepse/plans/step1-w3d-read-cutover.md` §10 — 本環境を使った W3d 読取 cutover の実機検証記録
