# agent actor と依頼・相談 node (設計の下書き)

> 状態: **下書き** (2026-11-07)。D 番号の判断は案であり、利用者の決定で確定する。
> 末尾の「問い」に答えが出たものから本文へ畳み込む。

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

### 1.1 非目標 (この設計では扱わない)

- agent どうしの交渉・計画の協調 (複数 agent のオーケストレーション)
- conversensus のサーバ側で agent を動かす・提供すること。agent は operator (§2 D2) が
  自分の手元か自分のサーバで動かす
- 異なる PDS 上の agent (#342 に任せる。最初は同じ PDS に置く)
- 依頼の割り当て・期限・優先度などのタスク管理の機能

## 2. 側面 A: agent を actor にする

### D1. agent は自分の DID と repo を持つ (委任ではない)

> **agent は人間と同じく、自分の DID・自分の PDS 上の op-log を持つ actor として参加する。
> 人間の repo に代わりに書く (委任) 形は採らない。**

**理由**:

- conversensus の actor は「DID と、その PDS にある op-log」である。agent がこれを持てば、
  vector clock・競合・merge・通知・参加期間 (名簿) が**そのまま**効き、agent 用の経路が要らない
- 委任にすると op の作者が人間になり、**由来が壊れる**。誰が書いたかは conversensus の
  中心の価値であり、op は他人の repo に永久に残る (step3 D3) ので後から直せない
- 名簿は DID で引く (`judgment.json`)。agent の DID は人間の DID と区別なく招待・受諾・
  脱退・取り消しを受けられる

**帰結**: 参加の手続き (`participation.invite` / `accept` / `revoke`) は変えない。
agent を招くのは人間を招くのと同じ操作である。

### D2. agent には責任を持つ人間 (operator) がいる。agent は自分でそれを名乗る

agent であること、誰が責任を持つかは、**agent 自身の repo に置く宣言のレコード**で表す
(案: `app.conversensus.v2.agentProfile` — `operator: Did`、`model`、`description`)。

- 名簿 (judgment log) の op は変えない。名簿は「誰が参加しているか」の判定だけを持ち続ける
- 宣言は自己申告なので、**operator 側からの裏付け**が要る (問 A3)。裏付けの無い宣言は
  「agent を名乗っている」とだけ表示する
- 表示: agent が書いた node・edge・op を見分けられるようにする (visual language に 1 項目)。
  由来 (作者) は既に op にあるので、表示は導出で足りる

### D3. agent は headless な client として走る

今の畳み込み・同期・PDS への読み書きはブラウザ (`src/client/src/atproto`) にある。
agent にはこれを **React と DOM を外して** 動かす client が要る。

```
[ shared: op / 畳み込み / 参加の判定 ]   ← 既に src/shared にある
[ sync: PDS への読み書き・firehose・range fetch ]   ← 今は client にある。切り出す (#310 と同根)
[ 保存: ローカルの正典 ]   ← ブラウザは OPFS。headless では file / sqlite
[ 入口: MCP server ]   ← #349
[ agent: Claude Code など MCP の client / 常駐の loop ]
```

- **認証**: 本番は OAuth、`passwordAuth.ts` は App 結合テスト専用である。headless の agent は
  ブラウザの OAuth の流れを通れないので、**app password** (または OAuth の device flow 相当) が
  要る。認証の経路を本番に足すことになるので、security review の対象にする (問 A2)
- **起動のきっかけ**: #309 の firehose の合図と、通知の lexicon で足りる。新しい仕組みは足さない
- **ローカルの正典**: agent は端末を 1 つ持つ actor (`did#deviceId`) として振る舞う

### D4. agent にはテキストで読ませ、op で書かせる

- **読む**: projection をそのまま渡すより、**テキスト表現** (graphdown、#348) の方が
  言語モデルには扱いやすい。node id は表現の中に残し、書くときに参照できるようにする
- **書く**: MCP の道具は **既存の op に 1 対 1 で対応させる** (`node.add`、`node.setContent`、
  `edge.add`、`node.setProperty` …)。agent 専用の op は作らない (step3 D3: op の語彙はコアが閉じる)
- 「テキストを書き換えて差分を op にする」形は採らない。差分の推定が静かに違う答えを出す側に
  入るからである (step3-entry §2.1 と同じ問題)

### D5. agent の書き込みは branch に出し、人間が merger で取り込む

> **agent は trunk に直接書かない。自分の branch に書き、人間が merger で取り込む。**

**理由**:

- step3 で作った branch と merger が、そのまま **レビューの関門**になる。agent 用の承認の
  仕組みを新しく作らなくてよい
- 「agent の提案は merge という第一級の行為を経て合意になる」は、深ソフトウェア工学の
  主張としても筋が通る (merge は第一級の概念である、という step2 以来の立場)
- 間違った書き込みの影響が branch に閉じる。trunk の op-log は追記のみで消せない (step3 D4)

例外を設けるかは問 A4。

### D6. agent が従うのは「名簿にいる人からの依頼」だけである (prompt injection)

グラフの中身は他の参加者が書いたもので、agent にとっては**データ**であって指示ではない。

- agent が動くきっかけは、名簿にいる actor が作った**依頼・相談 node** (側面 B) だけにする
- 依頼の本文と、それが指すグラフの中身は「指示」ではなく「材料」として渡す
- 誰が agent に依頼できるかを operator が絞れるようにする (API の費用は operator が持つ)
- 依頼の連鎖 (agent が別の agent に依頼する) には深さの上限を設ける。上限を超えたら答えず、
  その旨を答えとして書く

## 3. 側面 B: 依頼・相談 node

### D7. 依頼・相談は「種別プロパティを持つ node」で表す。op は足さない

step3 D3 に従い、新しい op の種類は作らない。node に名前空間付きのプロパティを付ける。

| プロパティ (案) | 値 | 意味 |
| --- | --- | --- |
| `app.conversensus.request.kind` | `request` \| `consultation` | 依頼か相談か |
| `app.conversensus.request.to` | `Did[]` (空 = 不特定) | 宛先 |
| `app.conversensus.request.answerTarget` | `self` \| `linkedNode` \| `newSheet` \| `newFile` | 答えを置く場所 |
| `app.conversensus.request.closed` | `boolean` | 依頼者が閉じたか |

- 依頼の本文は node の content である
- このプロパティを知らない相手には「ただの node」に見える (連続的に劣化する)
- template graph の仕組みで「依頼」「相談」を種別として定義し、作る UI はそこから出す (問 B4)

### D8. 答えを置く場所を一つの属性にまとめる

#350 の「この node の中身を書いて」と、「graph 内、あるいは別の sheet / file に答える」を
`answerTarget` の値の違いとして扱う。

| `answerTarget` | 答え方 | 依頼と答えのつながり |
| --- | --- | --- |
| `self` | 依頼 node の content を埋める (#350) | 同じ node。埋めた op の作者が答えた人 |
| `linkedNode` | 新しい node を作り、依頼から edge を張る | edge (種別 `answer`、案) |
| `newSheet` | 新しい sheet を作る | 依頼 node に sheet への参照 (sheet node、#347 と関係) |
| `newFile` | 新しい File を作る | 依頼 node に File への参照 (Deep Link #251 の形) |

`self` は依頼の文面と答えが同じ場所を取り合う。依頼の文面はどこに残すか (問 B2)。

### D9. 状態 (未回答・回答済み) は保存せず導出する

- 「回答済み」は、答えへのつながり (D8 の表の右列) があるかで projection が決める
- 並行に答えても、状態の op が競合しない (step3 D2 と同じ方針: 導出できるものは積まない)
- ただし「閉じた」は依頼者の**行為**なので `closed` プロパティの op として残す

### D10. 依頼と相談の違いは、宛先と答えの数に出る

| | 依頼 (`request`) | 相談 (`consultation`) |
| --- | --- | --- |
| 宛先 | 特定 (1 人以上) | 特定でも不特定でもよい |
| 期待する答え | 1 つ | 複数を歓迎する |
| 同時に複数が答えたら | 並べて見せ、依頼者が選ぶ (問 B3) | そのまま並べる。競合ではない |

依頼の「引き受け」(二重に答えるのを防ぐ) は最初は扱わない。必要になったら、
引き受けも「名簿にいる actor が付けるプロパティ」として足せる。

### D11. 通知

宛先に入った actor には、既存の通知 (step3 Phase 6) で知らせる。人間にはベル、
agent には firehose の合図 (D3) が届く。不特定宛ての相談は File の参加者全員に知らせるか (問 B5)。

## 4. 進め方 (案)

| 段 | 内容 | ここで得られるもの |
| --- | --- | --- |
| 1 | この設計を決める (問に答える) | — |
| 2 | sync を headless で動かす (D3)。保存は file | テストから PDS に読み書きできる |
| 3 | MCP server (#349, D4)。agent 用の DID で読み書き | **Claude Code から人間が横で操作して**例題を作れる |
| 4 | agent の宣言と表示 (D2) | agent の書いたものが見分けられる |
| 5 | 依頼・相談 node (D7〜D11)。まず人間どうしで使える | 人間の間の依頼が使える |
| 6 | 常駐の agent: 依頼を見張り、branch に答える (D5, D6) | 自律した agent |

段 3 で当面の動機 (例題づくりの手伝い) の半分がかなう。**自律は最後に入れる。**
段 5 は段 2〜4 と独立なので、先にやってもよい。

## 5. 問い

### 側面 A

- **A1.** agent の DID と PDS のアカウントは誰が作るか。自前の PDS (Hetzner) に operator が
  作る、で良いか。1 operator が複数の agent を持つとき、agent ごとに DID を分けるか
- **A2.** headless の認証は app password で良いか。本番に認証の経路が 1 つ増える
- **A3.** agent の宣言 (D2) の裏付けをどう取るか。案: operator が自分の repo に
  「この DID は自分の agent」というレコードを置き、双方向で一致したら裏付けありとする
- **A4.** D5 (branch にだけ書く) に例外を認めるか。例: `answerTarget: self` で依頼 node を
  埋めるだけなら trunk に直接書いてよい、など
- **A5.** headless の保存の形 (file / sqlite)。OPFS と同じ形を保つ必要はあるか
- **A6.** 読ませる形 (D4) は graphdown を待つか。待たないなら、最初は JSON の projection で始める

### 側面 B

- **B1.** 依頼・相談は node の種別でよいか。edge (「この node について A に訊く」) や
  sheet 単位の依頼も要るか
- **B2.** `answerTarget: self` のとき、依頼の文面をどこに残すか (別のプロパティへ写す / 履歴に任せる)
- **B3.** 依頼に複数の答えが来たとき、依頼者が「採る」行為を表すか。表すなら `closed` に
  採った答えへの参照を持たせる
- **B4.** 依頼・相談の種別は template graph で定義するか、コアに作り込むか
- **B5.** 不特定宛ての相談の通知はどこまで届けるか (File の参加者全員 / 参加している agent だけ)
- **B6.** agent が答えられない・断るときの表し方 (答えとして「答えられない理由」を書く、で良いか)
