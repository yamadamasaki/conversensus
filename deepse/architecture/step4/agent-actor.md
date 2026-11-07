# agent actor と依頼・相談 node (設計)

> 状態: **第二稿** (2026-11-07)。[レビュー 1](./agent-actor-review-1.md) の回答を畳み込んだ。
> 「決定」と書いたものは利用者の回答で決まったもの。「案」と書いたものは §6 の問いへの回答待ち。

関連 issue: #350 (「依頼」node)、#349 (MCP)、#342 (異なる PDS 間の共同作業)、
#348 (markdown との相互運用)、#310 (同期のライブラリ化)

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

### D2. 「誰が入れたか」は名簿から導出する。agent であることは自分で名乗る — 案

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
  変えない (§1.1)。**要るかどうか自体が問 A7**

宣言の形 (A3 決定、問 A7 次第で作る):

- agent の repo に `app.conversensus.v2.agentProfile` (`operator: Did`、`model`、`description`)
- operator の repo に `app.conversensus.v2.operatedAgent` (`agent: Did`)
- **両方がそろい、互いを指していれば**「裏付けあり」。片方だけなら「agent を名乗っている」とだけ表示する

### D2a. node・edge に書いた人を表示する — 案 (agent に限らない)

誰が書いた node・edge かを、avatar の icon で表示する。agent だけでなく人間にも同じく効く。
**別の issue に分けて進めてよい** (問 A8)。

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

案: **段 3 は loopback OAuth で始める。**段 5 で 2 週間の上限が問題になったら、
そのとき app password か confidential client (鍵を operator が持つ) を決める (問 A2')。
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

### D6. 依頼・相談は template で定義する。core が知るのは「宛先」だけ — 案 (B4)

> **依頼・相談の種類は core に入れず、template graph で定義する。**
> 他の actor への言語行為の種類はこれから増えるかもしれないからである (レビュー 1 B4)。

template graph では **node の label が種類になる** (step3 template-graph)。
「依頼」「相談」を label に持つ template を、Toulmin model と同じく**作り込みの種**として持つ
(`src/shared/src/template/`)。種類 (kind) をプロパティで持つ必要はなくなる。

ただし通知 (D11、B5) は conversensus が「この node は誰に宛てたものか」を知らないとできない。
そこで core が知るのは**種類に依らない 1 つのシステム・プロパティ**だけにする:

| プロパティ (案) | 値 | 意味 |
| --- | --- | --- |
| `app.conversensus.addressee` | `Did[]` (空 = 不特定) | この node が応答を求めている相手 |

- 依頼・相談の template は、このプロパティを既定値 (空) 付きで持つ
- 将来どんな言語行為の種類が増えても、通知の仕組みは変わらない
- agent と人間を区別しない (レビュー 1 D7)

### D7. 答えを置く場所 — 案

| `app.conversensus.answerTarget` (案) | 答え方 | 依頼と答えのつながり |
| --- | --- | --- |
| `linkedNode` (既定) | 新しい node を作り、依頼から edge を張る | edge |
| `newSheet` | 新しい sheet を作る | 依頼 node から sheet への参照 (#347) |
| `newFile` | 新しい File を作る | 依頼 node から File への参照 (Deep Link #251 の形) |

- **`self` (依頼 node を答えで置き換える) は無し** (B2)。#350 の「この node の中身を書いて」は
  `linkedNode` で受ける。#350 の本文はこれに合わせて直す
- これは宛先と同じく **意味論だけ**で、conversensus は答え方を強制しない。agent に答え方を
  伝える手がかりである。core が読まないなら、システム・プロパティではなく template の
  ふつうのプロパティでよい (問 B7)

### D8. 状態 (未回答・回答済み) は保存せず導出する — 決定

- 「回答済み」は、答えへのつながりがあるかで projection が決める
- 「閉じた」は依頼者の行為なので、プロパティの op として残す

### D9. 依頼と相談の違い、答えの数と採否は conversensus は扱わない — 決定 (D10, B3)

宛先・期待する答え・採否は**意味論**であり、conversensus は何もしない。
依頼に複数の答えが来ても、その先は利用者がグラフとして書く。

### D10. 断る・答えられない — 決定 (B6)

特別な仕組みは作らない。agent は答えとして「答えられない理由」を書けばよい。
どう振る舞ってほしいかは、依頼・相談 node を書く人がその都度本文に書く。
agent の側 (MCP の client や常駐の loop) が既定の指示を持つのは、operator の自由である。

### D11. 通知 — 決定 (B5)

`app.conversensus.addressee` に入っている actor に、既存の通知 (step3 Phase 6) で知らせる。
**空 (不特定) なら File の参加者全員に知らせる。**人間にはベル、agent には firehose の合図 (D3) が届く。

## 4. 進め方 (案)

| 段 | 内容 | ここで得られるもの |
| --- | --- | --- |
| 1 | この設計を決める (§6 の問いに答える) | — |
| 2 | sync を headless で動かす (D3)。保存は bun の SQLite、認証は loopback OAuth | テストから PDS に読み書きできる |
| 3 | 完全な encoding (D4) と MCP server (#349)。agent 用の DID で読み書き | **Claude Code から人間が横で操作して**例題を作れる |
| 4 | 依頼・相談の template と宛先・通知 (D6〜D11)。まず人間どうしで使える | 人間の間の依頼・相談 |
| 5 | 常駐の agent: 宛先に入ったら答える | 自律した agent |
| 別 | 書いた人の表示 (D2a)・agent の宣言 (D2) | 誰が書いたかが見える |

段 3 で当面の動機 (例題づくりの手伝い) の半分がかなう。**自律は最後に入れる。**
段 4 と「別」は段 2〜3 と独立なので、先にやってもよい。

## 5. 第一稿から外したもの

| 第一稿 | 外した理由 |
| --- | --- |
| D5 agent は branch にだけ書き、人間が merger で取り込む | agent と人間を対等に扱う (§1.1、A4)。branch 上で agent を呼ぶ場合とも噛み合わなかった |
| D6 agent が従うのは名簿にいる人からの依頼だけ (prompt injection) | node を書けるのは既に名簿にいる actor だけである (レビュー 1 D6)。グラフの中身をどう扱うかは agent の側の問題とする |
| 種別プロパティ `kind` | template の node の label が種類になる (D6) |
| `answerTarget: self` | 使い道が少なく、依頼の本文が消える (B2) |

## 6. 問い (第二稿で残ったもの)

- **A2'.** 段 5 (常駐) の認証: loopback OAuth の 2 週間の上限で困ったら、app password と
  confidential client のどちらにするか。**段 5 に着くまで決めなくてよい**
- **A7.** agent であることの宣言 (D2 の後者) は要るか。conversensus の振舞いを変えないなら、
  表示 (「この actor は agent」) のためだけに 2 種のレコードを足すことになる。
  要らなければ、A1 の「作った人が operator」は運用上の約束に留める
- **A8.** 書いた人の表示 (D2a) を、agent とは別の issue に起こしてよいか。定義の案 (位置と見た目を数えない) で良いか
- **B7.** `answerTarget` を core が読まない意味論とするなら、template のふつうのプロパティ
  (`.` を含まない名前) で良いか
- **B8.** template は sheet を**作るときに**適用するので、既存の sheet には依頼・相談 node を
  置けない。これで良いか。それとも依頼・相談は template ではなく、どの sheet にも置ける種類にするか
  (その場合 core に入る)
