# ユーザーテスト環境の作り方

このドキュメントは, Conversensus を手で触って動作確認・ユーザーテストするための **環境構築とテストデータ投入・リセット** の手順をまとめたものである.

アプリの GUI 操作そのもの (ファイル・シート・ノード・エッジ・ブランチの使い方) は [`operation-manual-for-dev.md`](./operation-manual-for-dev.md) を参照すること. 本書はその手前, 「テスターに渡す環境をどう用意し, どう初期状態へ戻すか」を扱う.

## 1. 起動 (step3 Phase 2 以降)

step3 Phase 2 (2026-10-01) で PWA になり、**ローカルサーバ (デーモン) と Tauri を撤去した**。
ローカル正典 (op-log と画像) はブラウザの中 (OPFS の SQLite) にある。

```shell
bun run dev:client   # web クライアント (vite) を 127.0.0.1:5173 で起動
```

- **`http://127.0.0.1:5173/` で開く** (`localhost` ではなく)。ATProto のログインは OAuth で、
  開発時は loopback client として `127.0.0.1` に戻ってくる。`localhost` で開くと、戻ってきた先が
  別の origin になり、保存領域も別になる
- **ATProto のログインや同期まで試すなら、開発用 PDS を先に起動する** (`:3000`)。手順は
  [`operation-manual-for-dev.md`](./operation-manual-for-dev.md) の「ATProto 向け開発時環境」。
  アカウントの DID 文書が `http://localhost:3000` を指していて、OAuth はそこへ直接届く必要がある
  (`infra/pds/docker-compose.yml`)
- **`src/client/.env.local` に `VITE_ATPROTO_PDS_URL=http://localhost:2583` が残っていれば `:3000` に
  直す** (または行ごと消す。既定が `:3000`)。残っていると handle の解決が古いポートへ行き、
  ログインが「ログインを始められませんでした」で止まる。同じファイルの `VITE_ATPROTO_HANDLE` /
  `VITE_ATPROTO_PASSWORD` はもう読まれない
- **ログインはパスワードを入れない。**handle を入れると PDS のページへ移り、そこでパスワードを
  入れて同意すると戻ってくる
- **開発環境でログインするのは Chrome。**開発用 PDS は http で動いていて、PDS のサインイン画面が
  使う CSRF の cookie に `Secure` が付いている。Chrome は http の `localhost` でもそれを受け取るが、
  **Safari は捨てる**ので「Missing CSRF header」(画面には「送信されたデータが無効です」) で止まる。
  Safari のログインは本番の PDS (https) で確かめる。ログインの要らない確認は Safari でもできる
- **Safari の「Dock に追加」した web app は開発環境では試せない。**`127.0.0.1` が `localhost` に変わり
  (変えられない)、`localhost` では OAuth を始めないので、パスワードのログインの口が出て失敗する
  (2026-10-07 利用者の実機)。web app は本番で確かめる
- **同じブラウザのタブは同じ保存領域を共有する** (タブごとに別の actor になる)。別の人として
  動かすには、別の origin (別のポート) か、別のブラウザ・プロファイルで開く (§5.1)

## 2. テストデータの投入

### 2.1 GUI で作る

最も簡単なのは, クライアント画面でファイルを新規作成し, ノード・エッジを手で置く方法である (操作は operation-manual を参照). 少数の題材を用意するだけならこれで足りる.

### 2.2 `.conversensus` を取り込む (再現可能)

同じ題材を毎回同じ形で用意したい場合は, 題材を `.conversensus` ファイルとして持っておき,
サイドバーのインポートで取り込む. 取り込むと file / sheet / node / edge の ID はすべて
振り直される. 題材は, 一度 GUI で作ってエクスポートしたものを使うのが確実である.

> step3 Phase 2 S2-7 までは, デーモンの HTTP API (`POST /files/import` など) を `curl` で
> 叩いて投入できた. デーモンを撤去したので, この口は無くなった.

## 4. クリーンな状態へのリセット

### 4.1 個別ファイルを消す

画面の「ファイルを削除」は, op-log に `file.remove` (tombstone) を 1 件**追記**する. 行は消えず,
PDS 経由で他端末にも伝わり, 他端末の発見 (`discoverRemoteFiles`) で復活しない.
(step3 Phase 2 S2-7 までは, デーモンの `DELETE /files/:id` で物理削除もできた.)

### 4.2 全部まっさらにする

ブラウザのサイトデータを消す. ローカル正典は origin ごとの保存領域 (OPFS) にあるので,
**`127.0.0.1:5173` のサイトデータ**を消せば空から始まる.

- Chrome: アドレスバーの左のアイコン → 「サイトの設定」→「データを削除」. または
  DevTools の Application → Storage → 「Clear site data」
- Safari: 設定 → プライバシー → 「Web サイトデータを管理」で `127.0.0.1` を削除

サイトデータには OAuth のセッションも入っているので, 消すとログアウトした状態になる.

### 4.3 PDS 側も消す

ブラウザのサイトデータを消すのは**この端末のローカル正典だけ**である. PDS 上のレコードは残るので,
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

DID は `curl -s "http://localhost:3000/xrpc/com.atproto.identity.resolveHandle?handle=bob.test"`
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
検証には **alice と bob がそれぞれ自分のローカル正典を持つ**構成が要る — ローカル正典は
origin (の保存領域) ごとなので, **別の origin で開く** (step3 Phase 2 以降).

```shell
# alice 側 (既定)
bun run dev:client                                   # 127.0.0.1:5173

# bob 側 (別のポート = 別の origin = 別の保存領域)
cd src/client && bunx vite --port 5174 --strictPort  # 127.0.0.1:5174
```

`127.0.0.1:5173` で `alice.test`, `127.0.0.1:5174` で `bob.test` に OAuth でログインする
(PDS のページでパスワードを入れる. パスワードは両方 `devpassword123`). ログインは Chrome で
行う (§1). 同じタブに 2 人を入れてはならない — 同じ origin のタブは同じ保存領域を共有する.

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

##### ⚠️ 平ら読みが健全でも, 画面は壊れていることがある

上の使い方は **`REPOS` に挙げた repo を全部読む「平ら読み」**である。これは
**誰の手元でもない名簿** — 「全部見えていれば名簿はこうなる」の答えであって、
**アプリはそう読まない**。アプリが読む repo は名簿が決め、その名簿は読んだ結果で決まる
(不動点計算)。したがって**平ら読みでは何も異常が無いのに、ある actor の画面だけが
壊れている**ことが起こる。

`SEED` を渡すと、アプリと同じ `readRoster` を通して**その actor から実際に見える名簿**を
出す。

```shell
SEED=bob.test bun run scripts/inspect-judgments.ts                          # その起点の File 一覧
SEED=bob.test FILE_ID=<uuid> bun run scripts/inspect-judgments.ts --dump    # 広がりが止まるまで
SEED=bob.test PASSES=0 FILE_ID=<uuid> bun run scripts/inspect-judgments.ts  # 起点の repo だけ
SEED=bob.test PASSES=1 FILE_ID=<uuid> bun run scripts/inspect-judgments.ts  # 同期サイクルと同じ
```

**「名前は出るが読んでいない repo」の行が答えである。**判断ログに名前が出ているのに
訪ねていない actor がいれば、その repo にある op はこの起点からは見えていない。

これで見つかった (2026-09-05, シナリオ 14-15)。alice が作った File で bob が alice を
呼び戻したとき、平ら読みの名簿には依頼がちゃんと出るのに、alice の画面は
「参加依頼が見つからない」だった。`SEED=bob.test PASSES=0` で読むと
「起点が無い」「捨てた op 6 件」がそのまま出る — 招待者 bob の repo には genesis が
無いので、そこだけ読むと依頼が残らず捨てられていた。修正済 (招待を検めるときは
`converge` で広げる)。

#### 参加期間の外を読んでいないこと

alice が bob を取り消した後も, bob の repo のレコードは減らない (相手は消さない).
alice 側のローカル正典に **取り消し後の bob の batch が入っていない**ことを見る.

ローカル正典 (ブラウザの OPFS) を外から覗くスクリプトは step3 Phase 2 S2-7 で撤去した
(§6.2). PDS 上の batch は `scripts/inspect-remote-batches.ts --dump` で見られる.

### 5.2 DtR graph を触る — **撤去済み**

DtR は step3 Phase 1 S1-1 で撤去した (競合の解消は merger に替わる, step3 Phase 5).

### 5.3 シート内を検索する (step2 Phase 7)

**2 アカウントも PDS も要らない.** 検索が見るのは自分の projection だけで, しかも
「いま表示しているシート」に閉じているので, §1 の構成 (`dev:client` だけ) で足りる.

#### 手順

1. File を作り, ノードを 2〜3 個置く. **本文と種別を別の語にしておく** — どちらで
   当たったのかを見分けるためである (例: 本文「争点の整理」, template を当てて種別「主張」)
2. 右上のツールバーの **🔍** を押す → 検索窓が出る
3. 語を打つ. **Enter を押さなくても打つたびに引く**

#### 見えるもの

| | 見えるはずのもの | 備考 |
| --- | --- | --- |
| 1 | 結果が `ノード / 本文` `辺 / 種別` のように**どの欄で当たったか**つきで並ぶ | 仕様の「要素の種類」 |
| 2 | 当たった部分だけ**黄色く**なる | 前後の文脈は残る |
| 3 | property は `プロパティ — 期限: date` のように**名前と型**も出る | 型は値から推論したもの |
| 4 | 結果を押すとグラフがその要素へ**寄って選択される** | 辺は始点のノードへ寄る |
| 5 | 検索前は結果の欄ごと出ない. 引いて 0 件なら「見つかりませんでした」 | 両者を混ぜない |

#### 確かめる価値がある境目

- **日本語の変換中に引かないこと.** 「かんじ」と打って変換している最中は結果が動かず,
  **確定した瞬間に**引き直される. ここが壊れていると未確定の文字で検索が走る
- **branch でも効くこと.** branch を開いてから検索する. branch を開くとシートが branch の
  projection に差し替わるので, **同じ検索窓がそのまま branch を引く**
- **シートや branch を切り替えたら検索窓ごと閉じること.** trunk と branch は別のグラフ
  なので, 移った時点で結果は無効である. 窓だけ残って空の結果が出るより素直だと判断した
  (利用者判断 2026-09-20 → step 3 で見直す). 仕組みは `App` が `GraphEditor` に渡す
  `key` による再マウントで, 検索の状態が初期値に戻る

> **⚠️ 仕様どおりにしていない点が 2 つある** (どちらも意図的, → step 3).
> **ダイアログは移動できない** — 既存のダイアログに移動できるものが 1 つも無く, 覆いの
> 構造から変えることになるため. 代わりに覆いを敷かず隅に置き, 結果を見ながらグラフを
> 触れるようにしてある. もう 1 つは **Enter を待たずに引く**点 (Enter でも引ける).

#### 検索できないもの (仕様どおり)

- **op-log は対象外**. 消した要素や昔の値は出てこない (時間を遡らない → step 3)
- **他のシート・他の File は対象外** (串刺しは → step 3)
- **system のプロパティ (`app.conversensus.*`) は出ない.** property editor が
  「見えない」と定めているものなので, 検索だけで出ると開けない結果になる

### 5.4 プロパティを編集する (step2 Phase 4)

**2 アカウントも PDS も要らない.** 自分の projection のプロパティを直すだけなので,
§1 の構成 (`dev:client` だけ) で足りる.

#### 手順

1. File を作り, ノードを 1 つ置く
2. そのノードを**選ぶ** (クリック)
3. 右上のツールバーの **🏷** を押す → プロパティの一覧が出る
4. 下の欄に名前と値を入れて「追加」

#### 見えるもの

| | 見えるはずのもの | 備考 |
| --- | --- | --- |
| 1 | 最初は「プロパティはありません」 | 行が 0 件であることと区別して言う |
| 2 | 追加すると **名前 / 型 / 値** の行が出る | 型は**必ず「文字列」** |
| 3 | 値の欄は直せる (Enter か他所をクリックで確定) | |
| 4 | 🗑 で消せる | |
| 5 | 辺を選ぶと辺のプロパティになる | 両方選んだときは **node を優先**する |

> **⚠️ 何も選んでいないと, 🏷 を押しても何も出ない** (ボタンだけが押された状態になる).
> 対象が無いので出しようがないのだが, 説明が無いので分かりにくい. → step 3 で見直す.

#### 確かめる価値がある境目

- **型は必ず「文字列」である.** `3` と打っても「数値」にはならない —
  **型を指定するのは実装コードか template のような拡張であって, 入力された値では
  ない** (利用者判断 2026-09-20). 値から推論すると `3` と打っただけで数値になり,
  **文字列の `"3"` を入れる手段が無くなる** (step 2 に型を指定する口は無い)
- **日本語の変換中に確定しないこと.** 「かんじ」を変換している最中の Enter で
  値が確定してはいけない. ここが壊れていると, 変換しただけで op が飛ぶ
- **変えていない値で Enter を押しても op が積まれないこと** (下記の op-log で見る).
  変わらないものを積むと, 偽の上書きが相手の通知に出る
- **template の種別 (`*.kind`) は編集できない.** 灰色の文字で出て「種別は作成時に
  決まり、変更できません」と書かれる. toulmin を当てたシート (`+ シートを追加` の
  `▾`) で種別つきのノードを作ると見られる
- **配列・構造体は編集できない.** 「構造を持つ値はこの画面では編集できません」と
  出る. 消して入れ直す口は残るので行き止まりにはならない
- **system のプロパティ (`app.conversensus.*`) は出ない.** 画像を貼ったノードを
  選んでも, 画像の参照は一覧に現れない

#### 判定は画面ではなく op-log で行う

**画面が正しく見えることを合格条件にしてはならない** (§8.1 と同じ理由).

ローカル正典 (ブラウザの OPFS) を外から覗くスクリプトは step3 Phase 2 S2-7 で撤去した
(§6.2). PDS 上の batch は `scripts/inspect-remote-batches.ts --dump` で見られる.

見るもの:

- 値が**文字列**で積まれているか (`優先度="4"` であって `優先度=4` ではない)
- 削除が**値を省いた** op になっているか (`node.setProperty 期限` に値が無い)
- 変えていない値で確定したときに op が**増えていない**か

自動化した例が `src/client/data-p4/p4.ts` にある (Q3 の検証台本, 投棄前提).
**画面の見た目だけでは `"4"` と `4` を区別できない**ので, そこは必ずログで見る.

## 6. 2 台目 (device B) を同じマシンで動かす

remote 同期の検証では, 「別端末が PDS 経由で受け取れるか」を見たいことがある. step3 Phase 2
以降は, **別の origin (別のポート) で開いたクライアント**が別の端末に当たる (保存領域が別).
PDS は 1 つを共有する (それが検証したい経路である).

```shell
# device B のクライアント (127.0.0.1:5174)。同じアカウントでログインする
cd src/client && bunx vite --port 5174 --strictPort
```

同じ origin で開いたタブは別の端末にはならない — 同じ保存領域を共有し, タブごとに別の actor に
なるだけである (step3 Phase 2 D4).

画面は依然として証拠にしない. 検証は下の §6.1 で PDS のレコードを見て行う.

### 6.1 PDS 上のレコードを直接検査する

**「画面に載ったか」では remote 送信を検証できない**. 現状の跨端末伝播は legacy snapshot 経路が
肩代わりしており, batch op-log が載っていなくても「載ったように見える」偽の確証が起きる
(同 §4.1 / critic A2). PDS の batch コレクションそのものを見ること.

```shell
bun run scripts/inspect-remote-batches.ts                      # 受入基準を機械判定
bun run scripts/inspect-remote-batches.ts --dump               # 全 batch を clock 順に一覧
PDS_URL=http://localhost:3000 REPO=alice.test \
  bun run scripts/inspect-remote-batches.ts                    # 宛先を明示する場合
```

検査項目は genesis push・id 収束 (4e-0) / presentation 非搭載 (D7) / sheetId 往復 / clock 衝突なし の 4 つ.
genesis の検査は Phase 4e-0 で反転した — 旧 C1 (genesis 非 push) は削除され, いまは
「genesis が remote に載っており, かつ同一 fileId に複数の genesis id が分岐していない」
ことを見る (Phase 4e 設計 §1.2 MED1 の実機確認).
`listRecords` は公開エンドポイントなのでログインは要らない. このスクリプトはクライアントの pull と
同じ mapper (`recordToBatch`) を通すので, **別端末が Batch に戻せること** の確認も兼ねる.

### 6.2 ローカル正典 (受信結果) を検査する

step3 Phase 2 S2-7 まではデーモンの HTTP API を叩く `scripts/inspect-local-oplog.ts` があったが,
ローカル正典がブラウザの中 (OPFS) に移ったので撤去した. 受信の正しさは App 結合テスト
(`*.app-test.tsx`) が見ている. 実機でローカル正典を覗く口が要るようになったら, 開発ビルドの
`window.__conversensus` に足す.

## 7. 注意点 (ハマりどころ)

- **ローカル正典は origin ごと**. `localhost:5173` と `127.0.0.1:5173` は別の保存領域である.
  いつも `127.0.0.1` で開くこと (§1)
- **プライベートブラウズの窓では使えない** (Safari). 保存領域が開けないので「この窓では保存
  できません」と出て編集できない (step3 Phase 2 D5)
- **service worker は本番ビルドでだけ動く**. 開発サーバでは登録されないので, オフライン起動は
  `bun run --cwd src/client build && bun run --cwd src/client preview` で確かめる

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

§1 のとおりクライアントを起動し, **Safari で** `http://127.0.0.1:5173/` を開くだけである.
**ログインは開発環境の Safari ではできない** (開発用 PDS が http のため, §1). ログインの要らない
操作 (編集・画像・検索・プロパティ) は Safari で確かめられる.

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

- **サーバの起動は要らない**. Playwright が**専用ポートで自前のクライアントを起動する**
  (開発サーバ `:5174`, 本番ビルドの配信 `:5175`). §1 で立てた `:5173` は触らない
- **利用者のデータは汚れない**. E2E はテストごとに新しいブラウザのプロファイルで開く
  (`tests/fixtures.ts`). 保存領域もそのプロファイルの中にある
- テストは `tests/*.spec.ts`, 仕様書は同じ場所に `tests/*.spec.md` を置く.
  `bunfig.toml` が `tests/` を bun のランナーから外しているので `bun test` とは衝突しない
- **Playwright の版が上がったら、ブラウザを入れ直す** (`bunx playwright install webkit chromium`).
  入れ直さないと、どのテストも数 ms で `Executable doesn't exist` で落ちる (依存の更新 #291 で 1.63 に上がった)
- **合成イベントで再現しないものは書かない** — トラックパッド由来の挙動・クリップボード・
  ファイル選択ダイアログ・描画品質は §8.3 のチェックリスト (人間) の領分である

## 9. Tauri (デスクトップアプリ) — **撤去済み**

step3 Phase 2 S2-7 (2026-10-01) で Tauri の配布をやめた. インストールは PWA で行う
(ブラウザの「ホーム画面に追加」/「アプリとしてインストール」). 以前の手順と spike の記録は
git の履歴にある (`src-tauri/` と本書の旧 §9).

## 10. FPR の完了基準を実機で確かめる (step3)

FPR の完了基準 ([step3 実装計画 §0](../plans/step3-implementation.md)) のうち, **人の手と実機が要る 2 つ**の手順.
結果は [`step3-fpr-check.md`](../plans/step3-fpr-check.md) の表に書く. 基準 3・4 は Claude が Chrome で確かめ済み,
基準 5 は机上で確かめて決めることが 1 つ残っている (同書 §5.3).

### 10.1 基準 1: PWA (Safari)

> ブラウザ (Safari を含む) で PWA として開き, インストールでき, オフラインで編集できる

**service worker は本番ビルドでだけ登録する** (`main.tsx`) ので, dev サーバ (`:5173`) では確かめられない.
次のどちらかで開く.

| | どこで | ログイン | 向いている確認 |
| --- | --- | --- | --- |
| a | 手元の本番ビルド `http://127.0.0.1:5175/` | **できない** (開発用 PDS が http, §1) | インストールとオフライン編集 |
| b | 本番 `https://app.conversensus.site` | できる | a に加えて, オフラインの編集が戻ったときに PDS へ送られること |

a の起動:

```shell
bun run --cwd src/client build
bun run --cwd src/client preview --port 5175 --strictPort   # E2E の offline.spec.ts と同じ配信
```

b は **いまの main を本番に出してから**使う (§11). 本番の Caddy は COOP/COEP を付けている
(step3 Phase 2 D8) — 付いていないと保存領域 (OPFS) が開けない. 本番のアカウントが要る (§11.3).

#### 手順 (macOS の Safari)

> **⚠️ Safari の web app は Safari と保存領域を共有しない.** 「Dock に追加」した web app は, 追加の時点で
> cookie だけを写し, それ以降は履歴・cookie・Web サイトのデータ (OPFS を含む) を Safari と共有しない
> (Apple の仕様). **Safari の窓で作った File は web app には見えない** — 不具合ではない. Chrome の PWA は
> ブラウザと同じ保存領域を見るので見える (2026-10-05 に利用者が実機で確かめた違い).
> web app の中の File を Safari と揃えたければ, ログインして PDS 経由で同期させる (b)

1. Safari で開く
2. **インストール**: メニューの「ファイル」→「Dock に追加…」. Dock から開くと, アドレスバーの無い窓で開く
3. **インストールした窓の中で** File を 1 つ作って node を 2〜3 置く (Safari の窓で作った File はここには出ない, 上の注意)
4. **オフライン**: a なら preview を止める (`Ctrl+C`). b なら Wi-Fi を切る
5. インストールした窓を**閉じて開き直す**. 起動し, 3 の File が開けることを見る (service worker が殻を返している)
6. node を足す・本文を変える・シートを足す. **再読み込みしても残る**ことを見る (OPFS に書けている)
7. b なら: オンラインに戻し, 左下の未送信の件数が 0 に戻ることを見る. 別の端末 (または Chrome) で
   同じアカウントにログインし, 6 の編集が届くことを見る

#### iPhone / iPad の Safari (できれば)

**iOS からは a (手元の本番ビルド) には繋げない. b (本番) で行う.**

- preview は `127.0.0.1` でだけ待ち受けている (`vite.config.mjs` の `DEV_HOST`)
- 待ち受けを広げて Mac の IP (`http://192.168.x.x:5175`) で開いても**動かない**. http の IP は安全な文脈
  (secure context) ではないので, service worker も, cross-origin isolation (SharedArrayBuffer) も, OPFS も使えず,
  保存領域が開けない. 動くのは https か `127.0.0.1` / `localhost` だけである
- 手元を https で見せる手 (トンネル・自前の証明書) はあるが, ログインはどのみちできず (開発用 PDS が http),
  Vite の Host 検査 (`preview.allowedHosts`) も外す必要がある. 本番に出す方が手数が少ない

本番で: Safari で `https://app.conversensus.site` を開き, 共有ボタン →「ホーム画面に追加」. 以降は macOS と同じ.
**ホーム画面の web app も Safari と保存領域を共有しない** (macOS と同じ). **iOS では保存領域が消されることがある**
(ITP. 7 日使わないと消える場合がある, step3 Phase 2 U1). 長く置いてから開き直して File が残っているかも見る価値がある.

#### 見るもの

- オフラインで開いたとき「起動中…」で止まらない. 止まったら Web インスペクタのコンソールを写す
- 保存領域が開けないときは「この窓では保存できません」の画面になる (プライベートブラウズなど, §7). これが
  通常の窓で出たら, COOP/COEP か OPFS の問題である

### 10.2 基準 2: 2 アカウントで merger

> 2 アカウントが同じ File を編み, branch の explicit merge で競合したとき, merger で解消して merge できる

開発環境で行う (§5.1 と同じ構成: alice が `127.0.0.1:5173`, bob が `127.0.0.1:5174`, どちらも Chrome).
開発用 PDS (`:3000`) を先に起動しておく (§1).

#### 手順

1. **共有**: alice が File「FPR merger」を作り, node を 1 つ置いて本文を「もと」にする. 参加者ダイアログで
   bob を招待し, bob が参加コードで参加する (§5.1 の 1〜4). 双方の画面に「もと」が出るまで待つ
2. **branch で編集**: bob が Sheet 1 で「+ branch」→ 名前「b1」. b1 を開いて本文を「bob 案」に変え, コミットする
3. **trunk で並行に編集**: alice が trunk の同じ node の本文を「alice 案」に変える. bob の画面の trunk に
   「alice 案」が届くまで待つ (30 秒以内. 急ぐなら「今すぐ同期」)
4. **merge**: bob が b1 を開いて「merge ↑」を押す → **確認のダイアログではなく merger が新しいタブで開く**
   (上に merge 元・merge 先, 下に merge 後と conflict list)
5. **解消**: conflict list に競合が 1 件 (本文が「alice 案」と「bob 案」). 例えば
   - merge 先の pane で node を右クリック →「merge 後に取り込む」で alice 案にする, または
   - merge 後の pane で本文を「両案をまとめる」に書き換える
6. conflict list のチェックを入れ, コメントを書いて「merge」を押す
7. **結果**: bob の trunk に 5 の値が出る. alice の画面にも届く (30 秒以内). branch b1 は「(merged)」になる

#### 見るもの

- 4 で merger が開かず確認のダイアログが出たら, 競合が layout だけだった可能性がある (layout だけなら merger を
  開かない仕様, step3 Phase 5 Q6). 本文 (content) で競合させること
- 5 のチェックとコメントが揃うまで merge は押せない
- 7 で alice 側に**「競合を LWW で確定した」の通知が出ない**こと (merger で決めた競合なので, Phase 5)
- 余力があれば: merger を開いたまま alice がもう一度同じ node を変える → merge 先の pane が新しくなり,
  チェックが外れて merge が押せなくなる (Phase 5 S5-2)

## 11. 本番へ出す (step3 以降)

本番は 2 つだけである (step3 Phase 2 で API サーバを撤去した).

| | URL | 中身 |
| --- | --- | --- |
| クライアント | `https://app.conversensus.site` | ビルドした静的ファイル. Caddy が `/var/www/conversensus` から配る |
| PDS | `https://pds.conversensus.site` | ATProto PDS (Docker, `infra/pds/docker-compose.prod.yml`). Caddy が `127.0.0.1:2583` へ渡す |

サーバは Hetzner の VPS (`178.105.63.123`, Ubuntu). リポジトリの置き場は `/opt/conversensus`.

### 11.1 出し方

**`release` ブランチへ push すると GitHub Actions が出す** (`.github/workflows/deploy.yml`).

```shell
git push origin main:release        # main をそのまま出す
```

workflow がすること (サーバの上で):

1. `release` を checkout して `bun install --frozen-lockfile`
2. クライアントをビルドする. **失敗したらここで止まり, 配信も設定も触らない**.
   PDS の URL は `src/client/.env.production` (`VITE_ATPROTO_PDS_URL`) から入る
3. `infra/caddy/Caddyfile` を `caddy validate` に通してから `/etc/caddy/Caddyfile` に置き, reload する.
   **配信の設定もリポジトリが正**である — COOP/COEP をここで付ける
4. `rsync --delete` で `/var/www/conversensus` を入れ替える (古い版のファイルを残さない)

手で出したいとき (Actions が使えないとき) は, 上の 1〜4 を SSH でそのまま実行すればよい
(workflow の `script` が手順そのもの).

### 11.2 出した後に確かめる

```shell
curl -sI https://app.conversensus.site/ | grep -i cross-origin     # COOP と COEP の 2 行が出る
curl -s https://app.conversensus.site/client-metadata.json          # JSON (OAuth の client_id)
curl -s https://pds.conversensus.site/xrpc/_health                  # {"version":"..."}
```

ブラウザでは `https://app.conversensus.site/` を開き, コンソールで `crossOriginIsolated` が `true`.
本番のアカウントで OAuth でログインでき (Safari を含む), File を作ると左下が「クラウド同期済み」になる.

**service worker が前の版を持っている**ので, 出した直後に開くと前の版の画面が出ることがある.
再読み込みすれば新しい版になる (画面と `sw.js` は `no-cache` で配っている).

### 11.3 PDS のアカウント

**登録は閉じてある** (`PDS_INVITE_REQUIRED=true`, 2026-10-05). 開けていた間に, 誰のものでもない
アカウントが 38 個作られ, Bluesky の like や follow に使われていた (同日に削除した). 開け直さないこと.

アカウントを足すときは招待コードを発行して作る. サーバの上で:

```shell
cd /opt/conversensus/infra/pds
PW=$(grep '^PDS_ADMIN_PASSWORD=' .env | cut -d= -f2-)
curl -s -u "admin:$PW" -H 'Content-Type: application/json' \
  -d '{"useCount":1}' http://127.0.0.1:2583/xrpc/com.atproto.server.createInviteCode
# → {"code":"pds-conversensus-site-xxxxx-xxxxx"}

curl -s -H 'Content-Type: application/json' -d '{
  "handle": "<名前>.pds.conversensus.site", "email": "<メール>",
  "password": "<パスワード>", "inviteCode": "<上のコード>"
}' http://127.0.0.1:2583/xrpc/com.atproto.server.createAccount
```

handle は `*.pds.conversensus.site` に限られる (`availableUserDomains`). いるアカウントの一覧は
ログイン無しで見られる:

```shell
curl -s 'https://pds.conversensus.site/xrpc/com.atproto.sync.listRepos?limit=100'
```

PDS の設定は `/opt/conversensus/infra/pds/.env` (git の外. 秘密を含む). 変えたら
`docker compose -f docker-compose.prod.yml up -d` で作り直す (データは volume `pds-data` に残る).

#### PDS を上げる

**app と PDS が同じ site (`*.conversensus.site`) にあるので, PDS の OAuth は `same-site` を受け付ける版でなければ
ならない.** 0.4.219 (oauth-provider 0.16.0) は `/oauth/authorize` で `Sec-Fetch-Site: same-site` を断り,
パスワードを入れた後に「何らかのエラーが発生しました」(コンソールに
`Forbidden sec-fetch-site header "same-site"`) で止まった. 2026-10-05 に pds 0.5.37 (oauth-provider 0.23.1) へ
上げて直した.

**image は版の tag で固定してある** (#286, `0.4.5037` — `_health` が返す版と同じ綴り. `latest` だと, いつ上がるかが
決まらない). 上げるときは, 先に **リポジトリの 2 つの compose ファイルの tag を PR で上げて** main:release で出し
(サーバの compose ファイルはリポジトリの写し), それから控えを取って上げる (DB の移行は戻せない).
tag の一覧は `https://github.com/bluesky-social/pds/pkgs/container/pds`:

```shell
cd /opt/conversensus/infra/pds
grep image: docker-compose.prod.yml          # 上げた版になっていること
docker compose -f docker-compose.prod.yml stop
tar -czf /root/pds-backups/pds-data-$(date +%Y%m%d).tgz -C /var/lib/docker/volumes/pds_pds-data _data
cp -p .env /root/pds-backups/env-$(date +%Y%m%d)
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --force-recreate
curl -s https://pds.conversensus.site/xrpc/_health
```

控えは `/root/pds-backups/` にある (2026-10-05: 0.4.219 の時点のもの).

### 11.5 版と tag (v1.0.0 から)

**SemVer に `v` を付けた注釈付きの tag** (`vMAJOR.MINOR.PATCH`) を、本番に出した commit に打ち、GitHub Release に
説明を付ける。数の意味は conversensus では次のとおり (2026-10-05 に決めた):

| | 上げるとき |
| --- | --- |
| MAJOR | **op-log や lexicon の形式を壊す変更** (移行を伴う)。FPR でこの約束を始めた |
| MINOR | 機能を足す。**op の種類を足すのはここ** — 古い版は知らない op を保存して読み飛ばすので壊れない (FPR の確認 §5.3 案 A) |
| PATCH | 直す |

出すときの手順 (§11.1 の後):

```shell
git push origin main:release                     # 出す (Actions が走る)
gh run watch <run id> --exit-status              # 成功を待つ。§11.2 で確かめる
git tag -a vX.Y.Z <出した commit> -m "vX.Y.Z — 一言"
git push origin vX.Y.Z
gh release create vX.Y.Z --title "..." --notes-file <説明> --verify-tag
```

**tag は本番に出して確かめた commit に打つ** (出す前に打たない)。`src/client/package.json` と
`src/shared/package.json` の `version` も同じ数にそろえておく (次の版の PR の中で上げる)。

| 版 | 日付 | commit | 内容 |
| --- | --- | --- | --- |
| v1.0.0 | 2026-10-05 | `6858976` | 最初の公開版 (FPR) |
| v1.0.1 | 2026-10-07 | `5846385` | 受信の検証を強めた (書き手と repo の照合、File の起点は創設者のもの)、壊れた編集を 1 件ずつ読み飛ばす・clock に上限・表示する画像をラスタに限る、デプロイを専用のユーザーで行う |

### 11.4 一度だけの作業 (済んだもの)

- **旧 API サーバを止める** (step3 Phase 2 S2-7): `systemctl disable --now conversensus`.
  2026-10-05 の最初の deploy の後に行った. 旧 API のデータは移さない (v2 で読めない, step3 Phase 2 Q2)

## 関連

- [`operation-manual-for-dev.md`](./operation-manual-for-dev.md) — アプリ GUI の操作手順 (product-owner 向け動作確認マニュアル)
- [`../plans/step1-phase8a-r1-spike.md`](../plans/step1-phase8a-r1-spike.md) — R1 (ARM64/Rosetta) 切り分け spike (実施済). §7 の Safari 戦略の裏取り (S4) と, §8 の根拠となった実測記録を含む
- `deepse/plans/step1-w3d-read-cutover.md` §10 — 本環境を使った W3d 読取 cutover の実機検証記録
