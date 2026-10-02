# グラフ view のアドレスのテスト

## 何を

`projectAddress` — アドレス `(file, sheet, branch, 切断面, highlight)` が指す Sheet を op-log から
求める関数 (step3 Phase 3 S3-1)。あわせて `isReadOnlyCut`。

## なぜ

タブ・multiple モードの pane・merger の元/先/後・timeline・検索結果は、すべてアドレスの上に載る。
画面の中身は**アドレスから projection した結果**になるので、ここが間違えると、どの view も
**静かに違う姿**を見せる (例外も出ず、見た目ではそれと分からない)。

主張は全称命題なので性質として書く。

## どのように

### 生成器: 歴史を 1 本の時間で再生する

2 人 (alice / bob) が交互に、trunk か branch に node の追加・書き換え・削除を積む。途中の
`branchAt` 手目の直前に branch を切り、以後の `onBranch` の手は branch へ積む。

- **発番器は actor ごとに 1 つで、trunk と branch で共有する** — 本物と同じ (seq は File の中で
  actor ごとに 1 系列)。だから 1 つの vector が trunk と branch の両方に効く
- **2 人の発番器は互いを観測しない。**clock が重なり、追い越す。clock で切ると「その時点には
  無かったのに clock が小さい batch」が紛れ込む場面 (Phase 1 が分岐点で直したずれ) を引かせるため
- **node は 3 つ、内容は 2 種類のプール。**広いと同じ node を引かず、「後から消す」「別の人が
  書き換える」という、切断面によって結果が変わる場面に当たらない
- 各手の後の「その時点の trunk / branch」を残し、比べる相手 (実物) にする

### 性質

| 性質 | 固定すること |
| --- | --- |
| head の trunk = いまの projection | アドレスに置き換えても、いまの画面と同じものが出る (S3-2 で画面をアドレスへ載せ替える前提) |
| head の branch = いまの branch の projection (`branchSheet`) | 同上 (branch) |
| **切断面で切った姿 = その時点に実際にあった姿** (trunk と branch) | 切断面の中心の主張。後から積まれた batch は、誰のものでも clock がいくつでも入らない |
| 全部を覆う切断面 = head | vector の境界の取り違え (覆う範囲の off-by-one) を拾う |
| 分岐点より前の切断面では、branch = 分岐する前の trunk | branch でも trunk を切断面で切っている (分岐点だけで切ると、分岐前の時点で分岐後の trunk が見える) |

### 例

- シートがまだ無い切断面 (空の vector) では `undefined`
- branch のアドレスに別の branch の op-log を渡すと投げる — 呼び出し側の解決の誤りを、黙って
  違う branch を見せる形で隠さない
- 過去の切断面は読み取り専用、head は編集できる

### 変異で確認したこと

- 切断面を無視する → 「その時点の姿」「分岐する前」「シートがまだ無い」の 3 件が落ちる
- branch 側を切断面で切らない → 「その時点の姿」「分岐する前」の 2 件が落ちる
