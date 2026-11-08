# agent actor と依頼・相談 node (設計)

> 状態: **第三稿** (2026-11-08)。[レビュー 1](./agent-actor-review-1.md) と
> [レビュー 2](./agent-actor-review-2.md) の回答を畳み込んだ。
> 「決定」と書いたものは利用者の回答で決まったもの。「案」と書いたものは §6 の問いへの回答待ち。

関連 issue: #350 (「依頼」node)、#349 (MCP)、#342 (異なる PDS 間の共同作業)、
#348 (markdown との相互運用)、#310 (同期のライブラリ化)。
この設計から切り出したもの: #354 (書いた人の表示)、#355 (既存の sheet に template を追加で適用)、
#356 (template の種類の名前の i18n)、#357 (read-only の property を表示するトグル)

## 1. 目的

言語モデルをベースにした agent が conversensus のグラフに参加できるようにする。
側面は二つあり、互いに独立に価値を持つ。

| | 側面 | 性格 |
| --- | --- | --- |
| A | agent が自立した actor として conversensus を読み書きする | **基盤** — 誰として、どこから読み書きするか |
| B | agent も人間も含めて、相手に応答を求める「依頼」「相談」node | **語彙** — グラフの中で何を表すか |

当面の動機は、例題 (と ontology の文書) を作るのを agent に手伝ってもらうことである。
その先には、複数の agent に simulation のようなことをさせる思惑もある (A1)。

### 1.1 原則: agent と人間を対等に扱う

> **conversensus は、agent と人間を区別しない。agent に固有の制限・承認・経路を設けない。**

- 「agent が agent をどんどん名簿に加えたら?」は、人間でも同じである。conversensus の前提として
  割り切る (レビュー 1 D1)
- 信頼や promise のようなものを入れるとしても、上から決めるのではなく、利用の中から
  bottom-up に育てる
- この原則から、第一稿の D5 (agent は branch にだけ書く) と D6 (agent が従う依頼を絞る) を外した (§5)

### 1.2 非目標 (この設計では扱わない)

- agent どうしの交渉・計画の協調 (複数 agent のオーケストレーション)
- conversensus のサーバ側で agent を動かす・提供すること。agent は operator が
  自分の手元か自分のサーバで動かす
- 異なる PDS 上の agent (#342 に任せる)。招待は同じ PDS の DID に限られている (`targetForeignPds`)
- 依頼の割り当て・期限・優先度・引き受けなどのタスク管理の機能
- 依頼・相談への答えの数や採否を conversensus が扱うこと (D10)

## 2. 側面 A: agent を actor にする

### D1. agent は自分の DID と repo を持つ (委任ではない) — 決定

> **agent は人間と同じく、自分の DID・自分の PDS 上の op-log を持つ actor として参加する。
> 人間の repo に代わりに書く (委任) 形は採らない。**

- conversensus の actor は「DID と、その PDS にある op-log」である。agent がこれを持てば、
  vector clock・競合・merge・通知・参加期間 (名簿) が**そのまま**効き、agent 用の経路が要らない
- 委任にすると op の作者が人間になり、**由来が壊れる**。op は他人の repo に永久に残る
  (step3 D3) ので後から直せない
- 参加の手続き (`participation.invite` / `accept` / `revoke`) は変えない

**アカウント (A1 決定)**: agent の DID は自前の PDS に作る。**作った人が operator である。**
agent ごとに DID を分ける (agent どうしを参加させるため)。

### D2. 「誰が入れたか」は名簿から導出する。agent であることは自分で名乗る — 決定 (A7)

レビュー 1 の問い「operator が名簿から外れたり消えたりしたら、その agent はどうなるか」には、
**どうもならない**と答える。agent は他の参加者と同じく名簿に残り、外すなら `revoke` する。
これは人間を招いた人が外れたときと同じである (§1.1)。

ここで二つの情報を分ける。

| 情報 | 出所 | 新しく積むもの |
| --- | --- | --- |
| この File に**誰が入れたか** | 名簿の `participation.invite` の発行者 | 無い (導出) |
| この DID が **agent であり、誰のものか** | agent の repo の宣言 + operator の repo の裏付け (A3) | レコード 2 種 |

- 前者は File ごとの話で、op-log に既にある
- 後者は File をまたぐ話で、表示 (「この actor は agent」) にだけ使う。conversensus の振舞いは
  変えない (§1.1)。言語モデルの agent であることは分かるようにする (A7)

宣言の形 (A3・A7 決定):

- agent の repo に `app.conversensus.v2.agentProfile` (`operator: Did`、`model`、`description`)
- operator の repo に `app.conversensus.v2.operatedAgent` (`agent: Did`)
- **両方がそろい、互いを指していれば**「裏付けあり」。片方だけなら「agent を名乗っている」とだけ表示する

### D2a. node・edge に書いた人を表示する — 決定 (A8、#354)

誰が書いた node・edge かを、avatar の icon で表示する。agent だけでなく人間にも同じく効く。
**#354 として別に進める。**

「書いた」の定義の案:

> **その node (edge) の意味を変える op を出した actor 全員。** 作成 (`node.add`) と、
> 中身・ラベル・プロパティ・親の変更 (`setContent`・`setLabel`・`setProperty`・`setParent` …)。
> 位置と見た目 (`setLayout`・`setStyle`) は数えない。

- 作者は op に既にあるので、表示は projection からの導出で足りる (op は足さない)
- 並べ方は作った人を先頭に、あとは最後に書いた順。多いときは重ねて表示し、hover で広げる
- 位置を動かしただけの人を数えないのは、並べ替えた人が全 node の作者になるのを避けるため

### D3. agent は headless な client として走る — 方向は決定、細部は実装時

今の畳み込み・同期・PDS への読み書きはブラウザ (`src/client/src/atproto`) にある。
agent にはこれを **画面を外して** 動かす client が要る。

```
[ shared: op / 畳み込み / 参加の判定 / 保存 (SQL) ]   ← 既に src/shared にある
[ sync: PDS への読み書き・firehose・range fetch ]     ← 今は client にある。切り出す (#310 と同根)
[ 入口: MCP server ]                                  ← #349
[ agent: Claude Code など MCP の client / 常駐の loop ]
```

**保存 (A5 決定: SQLite で同じ schema)**: すでにそうなっている。ブラウザは Worker の中の
wasm SQLite (OPFS 上)、bun は `bunSqliteDriver` で、どちらも `src/shared/src/store` の
同じ schema と `sqlDriverContract` を通る。headless では bun の SQLite に file を 1 つ置けばよい。

**認証 (A2)**: ATProto の OAuth には **device flow が無い** (spec は authorization code
grant だけ)。代わりに native client の **loopback redirect** がある — CLI が手元に小さな
受け口 (`http://127.0.0.1:<port>/`) を開き、ブラウザで一度ログインしてもらう
(`gh auth login` と同じ形)。

| | loopback OAuth (public client) | app password |
| --- | --- | --- |
| 本番の認証方式との統一 | **統一できる** (OAuth だけ) | 経路が 1 つ増える |
| セッションの長さ | **最長 2 週間** (public client の上限)。その後は再ログイン | 失効しない (取り消すまで) |
| 実装 | ほどほど (DPoP・PKCE・PAR は client library が持つ) | 小さい (`passwordAuth.ts` がある) |
| 向く段 | 段 3 (人間が横で操作する) | 段 5 (常駐する agent) |

決定: **段 3 は loopback OAuth で始める。**常駐の agent の認証 (app password か
confidential client か) は段 5 で考える (A2')。
なお `http://localhost` の client_id を本番の PDS が受けるかは任意なので、自前の PDS で確かめる。

### D4. agent には完全な encoding で読ませ、op で書かせる — 決定 (A6)

- **読む**: graph を property も含めて**欠けなく**テキストに落とす encoding を作る。
  人間が読むための graphdown とは目的が違う (レビュー 1 D4)。graphdown は encoding の
  一つという位置づけになり、agent 用の encoding とは分ける
  - node・edge の id を残し、書くときに参照できるようにする
  - 逆向き (テキスト → graph) は要らない。書くのは op だから
- **書く**: MCP の道具は **既存の op に 1 対 1 で対応させる** (`node.add`、`node.setContent`、
  `edge.add`、`node.setProperty` …)。agent 専用の op は作らない (step3 D3)
- 「テキストを書き換えて差分を op にする」形は採らない。差分の推定が静かに違う答えを出すからである

### D5. agent はどこに書いてもよい — 決定 (A4)

人間と同じく trunk にも branch にも書ける (§1.1)。branch を見ている人が依頼すれば、agent は
その branch に書く — 人間と同じである。branch から branch は切れない、という今の制約も人間と同じに受ける。

## 3. 側面 B: 依頼・相談 node

### D6. 依頼・相談の種類は template で定義する。core が知るのは「応答を求める node」だけ — 決定 (B4)、細部は案

> **依頼・相談の種類は core に入れず、template graph で定義する。**
> 他の actor への言語行為の種類はこれから増えるかもしれないからである (レビュー 1 B4)。

「依頼」「相談」を種類に持つ template を、Toulmin model と同じく**作り込みの種**として持つ
(`src/shared/src/template/`)。

**種類の持ち方 (レビュー 2 D6 の問いへの答え)**: 種類は**プロパティに持っている**。
template を当てた sheet の node は `<templateId>.kind` というプロパティを持ち、値は種類の **id** である
(`kindPropertyOf`。template graph から作った template では、種類の node の NodeId)。
label は `node.setLabel` で各 node にも書かれるが、**表示のためのもので、同一性ではない**。
したがって多言語の問題は表示だけに出て、agent や通知の判定には影響しない。
表示の i18n は #356 で扱う (#330 案 B「焼き込んだら引き直さない」の決定を改めることになる)。

**core が知るもの**: 通知・状態・ボタン (D8、D11、D12) は、conversensus が node を読めないと
作れない。そこで core は種類に依らない**「応答を求める node」**だけを知る。
`app.conversensus.addressee` を持つ node がそれである。依頼・相談の template はこれらを既定値付きで持つ。

| システム・プロパティ (案) | 値 | 意味 | 書く人 |
| --- | --- | --- | --- |
| `app.conversensus.addressee` | `Did[]` (空 = 不特定) | 応答を求めている相手。これを持つことが「応答を求める node」の印 | 依頼した人 |
| `app.conversensus.sent` | 整数 (送った回数) | 送った (D12) | 送った人 |
| `app.conversensus.closed` | `boolean` | 閉じた | 閉じた人 |
| `app.conversensus.answers` (edge に付ける) | 整数 (どの送信への答えか) | この edge は答えへのつながり | 答えた人 |

- 将来どんな言語行為の種類が増えても、この 4 つは変わらない
- agent と人間を区別しない (レビュー 1 D7)
- 値の表示は、read-only の property を見せるトグル (#357) で確かめられる

### D7. 答えを置く場所 — 決定 (B7)

template のふつうのプロパティ `answerTarget` (`.` を含まない名前) に置く。

| `answerTarget` | 答え方 | 依頼と答えのつながり |
| --- | --- | --- |
| `linkedNode` (既定) | 新しい node を作り、依頼から edge を張る | edge |
| `newSheet` | 新しい sheet を作る | 依頼 node から sheet node (#347) への edge |
| `newFile` | 新しい File を作る | 依頼 node から File への参照 node (Deep Link #251 の形) への edge |

- **`self` (依頼 node を答えで置き換える) は無し** (B2)。#350 の「この node の中身を書いて」は
  `linkedNode` で受ける
- どの場合も、依頼 node から出る edge に `app.conversensus.answers` を付ける (D6)。
  答えが別の sheet・File にあっても、つながりは依頼のある sheet に残るので、状態を導出できる (D8)

**誰が設定するか (レビュー 2 の問い)**: 依頼した人である。property の欄で選ぶ (既定は `linkedNode`)。
**本文に書いてもよい。**本文は、言語モデルの agent にとっては prompt に当たる。
conversensus はどちらも読まず、強制もしないので、食い違ったときにどうするかは答える側の判断である。
property は「選ぶだけで済む・人間にも一目で分かる」ために置き、本文は「それ以上の注文」を書く場所とする。

### D8. 状態は保存せず導出する — 決定

| 状態 | 導出の規則 |
| --- | --- |
| 下書き | `sent` が無い |
| 送った・未回答 | `sent` = n で、`answers` = n の edge が無い |
| 回答あり | `answers` = n の edge がある |
| 閉じた | `closed` が true (他より優先) |

「閉じた」と「送った」は依頼した人の**行為**なので、プロパティの op として残す。「回答あり」は導出する。

### D9. 依頼と相談の違い、答えの数と採否は conversensus は扱わない — 決定

宛先・期待する答え・採否は**意味論**であり、conversensus は何もしない。
依頼に複数の答えが来ても、その先は利用者がグラフとして書く。

### D10. 断る・答えられない — 決定

特別な仕組みは作らない。agent は答えとして「答えられない理由」を書けばよい。
どう振る舞ってほしいかは、依頼・相談 node を書く人がその都度本文に書く。
agent の側 (MCP の client や常駐の loop) が既定の指示を持つのは、operator の自由である。

### D11. 通知 — 決定

**送ったとき** (D12) に、`addressee` に入っている actor に、既存の通知 (step3 Phase 6) で知らせる。
**空 (不特定) なら File の参加者全員に知らせる。**人間にはベル、agent には firehose の合図 (D3) が届く。

### D12. 依頼は「評価」せず「送る」。送るのは依頼した人の行為である — 案 (Q1・Q2)

**依頼 node に「送る」ボタンと「閉じる」ボタンを付ける** (Q1)。開き直す (閉じたのを戻す) こともできる。

**いつ「実行」されるか (Q2)**: conversensus は依頼を**評価しない**。依頼した人が「送る」と、
宛先に知らせが届き、宛先の actor (人間でも agent でも) が自分で答える。
実行するのは宛先の actor であって、conversensus ではない。

- **作っただけでは送らない。**node は少しずつ書かれる (作る → 本文を打つ → 宛先を選ぶ)。
  作った瞬間に知らせると、書きかけの依頼に agent が答えてしまう
- **何度でも送れる。**本文を直して送り直すと `sent` が 1 増え、宛先は新しい送信に答える。
  前の答えは消えず、`answers` の値でどの送信への答えか分かる
- 二人が同時に送ると、同じ回数になって一つに畳まれる (LWW)。同じ依頼を二度出しても意味は同じなので、これで良い

**sheet 単位の eval・読み込み時の評価は採らない。**

- 言語モデルの答えは決定的でない。読み込むたびに評価すると、開くたびに新しい答えが増える
- 評価の順序 (依頼の答えを別の依頼が使う) を決める必要が出る。今は扱わない (レビュー 2 Q2)

**実行可能なグラフの先行事例として**: この設計は **actor model (メッセージを送り、受け手が自分で
動く)** である。「グラフを評価して値を出す」**dataflow** とは別の型である。将来、dataflow 型の
実行 (依頼の答えを次の依頼の入力にする、など) を入れるときは、順序と決定性が主題になる。
どちらも conversensus の op としては「誰かが書いた op」でしかない、という点は共通である。

### D13. agent に渡す文脈と指示 — 案 (Q3)

**文脈は押し込まず、agent が取りに行く。**MCP の道具 (D4) で、agent は必要な所を読む。
File の全グラフを毎回 prompt に入れると、大きな File では収まらない。

| 文脈 | 既定 | 指定の仕方 (案) |
| --- | --- | --- |
| 依頼のある File の全グラフ | 読める (agent はその File の参加者だから) | — |
| 他の File | agent がその File の**参加者なら**読める | template のプロパティ `context` に Deep Link を並べる |
| 一般の URL | agent の側の能力次第 (operator が決める) | 同じく `context` に URL を並べる |

- **依頼で読める範囲は広がらない。**agent が参加していない File を `context` に書いても、agent は読めない。
  依頼を通して、参加していない人にも非公開の File を読ませる抜け道を作らないためである

**指示 (system prompt に当たるもの) は三層になる**:

| 層 | 置き場所 | 書く人 |
| --- | --- | --- |
| agent 全体 | agent の側 (MCP の client・常駐の loop の設定) | operator |
| 種類ごと | **template graph の説明書きの node** (label の無い node。今もある) | template を書く人 |
| 依頼ごと | 依頼 node の本文 | 依頼する人 |

- 種類ごとの指示を template graph に置くのは、レビュー 2 Q3 の「template に書いておく」案である。
  template graph の説明書きの node は、今でも人間向けの使い方の説明に使える。これを
  agent への指示としても渡す。人間と agent が同じ説明を読む (§1.1)
- File 全体の指示が別に要るかは問 B10

## 4. 進め方 (案)

| 段 | 内容 | ここで得られるもの |
| --- | --- | --- |
| 1 | この設計を決める (§6 の問いに答える) | — |
| 2 | sync を headless で動かす (D3)。保存は bun の SQLite、認証は loopback OAuth | テストから PDS に読み書きできる |
| 3 | 完全な encoding (D4) と MCP server (#349)。agent 用の DID で読み書き | **Claude Code から人間が横で操作して**例題を作れる |
| 4 | 応答を求める node (D6〜D12): システム・プロパティ、送る・閉じる、状態、通知、依頼・相談の種 | 人間の間の依頼・相談 |
| 5 | 常駐の agent: 送られたら答える (D13)。認証を決める (A2') | 自律した agent |
| 別 | agent の宣言 (D2)、#354〜#357 | 誰が書いたかが見える など |

段 3 で当面の動機 (例題づくりの手伝い) の半分がかなう。**自律は最後に入れる。**
段 4 と「別」は段 2〜3 と独立なので、先にやってもよい。

## 5. 前の稿から外したもの

| 前の稿 | 外した理由 |
| --- | --- |
| D5 agent は branch にだけ書き、人間が merger で取り込む | agent と人間を対等に扱う (§1.1、A4)。branch 上で agent を呼ぶ場合とも噛み合わなかった |
| D6 agent が従うのは名簿にいる人からの依頼だけ (prompt injection) | node を書けるのは既に名簿にいる actor だけである (レビュー 1 D6)。グラフの中身をどう扱うかは agent の側の問題とする |
| 種別プロパティ `kind` | 種類は template の種別プロパティ `<templateId>.kind` が既に持つ (D6) |
| `answerTarget: self` | 使い道が少なく、依頼の本文が消える (B2) |
| 「core が知るのは宛先だけ」(第二稿) | 送る・閉じる・状態の導出にも core が読む値が要る。種類に依らない 4 つにした (D6) |

## 6. 問い (第三稿で残ったもの)

- **A2'.** 常駐の agent の認証 — 段 5 で考える (決定)
- **B9.** 「送る」を送った回数の整数で表し、答えの edge に何回目への答えかを付ける (D6・D12) で良いか
- **B10.** 指示の置き場所: 種類ごとの指示を template graph の説明書きの node に置く案 (D13) で良いか。
  File 全体の指示も別に要るか (要るなら置き場所の案: metagraph の node、または File のプロパティ)
- **B11.** 依頼の `context` で読める範囲は、agent が参加している File に限る (D13) で良いか
- **#350** の本文を、この設計 (`self` は無し、`linkedNode` で受ける、送る・閉じる) に合わせて書き換えてよいか
