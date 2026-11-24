# 種類の名前を言語ごとに表示するテスト

## 何を

`kindLocale.ts` — template の種類の名前・説明を言語ごとに持ち、見る人の言語で表示する (#356、計画
kind-i18n-356.md)。訳は template graph の種類の node・edge の property (`label:<言語>`・`description:<言語>`) に置く。

- `displayKindLabel` — 当てたシートの node・edge の label を、見る人の言語で表示する形にする
- `translationsIn` / `translationProperties` — property と言語ごとの訳の読み書き
- `kindLabelIn` / `kindDescriptionIn` — 種類の名前・説明をその言語で
- `templateFromSheet` が訳を種類の名前・説明として読み、既定値には入れないこと

## なぜ

- **データは変えずに表示だけを訳す。**当てたシートの label は、作ったときの種類の名前のまま書かれる。
  訳し漏れると、言語の違う参加者が読めない名前を見る (#356 の問題そのもの)
- **種類を持てば、保存された label によらず種類の今の名前を出す** (template-update D4)。template graph で
  種類の名前を変えて pull しても、既にある要素の label は古い名前のまま残る。前は「label が種類の名前か訳の
  ときだけ訳す」としていたので、名前を変えると古い label がそのまま出ていた。種類の label は書き換えられない
  (画面は固定、MCP の道具は断る) ので、利用者の言葉を消すおそれは無い
- **訳とも照らす。**#330 案 B では、種を作った人の言語の名前が焼き込まれた。英語の参加者が作った File の
  `Claim` を、日本語の参加者には `主張` で見せるため
- **訳を既定値に入れない。**template graph の property は当てた先の既定値になる。訳を外さないと、node を
  作るたびに訳が複製される

## どのように

- 性質 (fast-check):
  - 種類を持てば、保存された label によらず、見る人の言語の訳 (無ければ template graph の名前) になる
  - 訳は property にして読み戻すと同じになる
- 例:
  - template graph で種類の名前を変えたら、作ったときの label のままの要素も新しい名前で出る (D4)
  - 種類を持たない要素・知らない種類 (template graph で消された種類も) の要素は label のまま
  - edge は edge の種類で引く (node の種類と同じ id でも取り違えない)
  - 別の言語の名前で焼き込まれた label も訳す
  - 2 つの template の種類を持つときは先に当たった template で決める
  - 訳が無い言語では template graph の名前・説明
  - 読めない訳 (空の言語・空白だけ・文字列でない値) は落とす
  - `templateFromSheet` は訳の property を名前・説明にし、既定値には入れない
  - `kindPropertyLabels` (#384): 種別の property を、template の名前と、種類の名前 (見る人の言語、無ければ
    template graph の名前) にする。edge は edge の種類で引く。知らない template・知らない種類・文字列でない値は
    含めない — 読み取り専用の表示 (#357) は、そのとき id のまま出す

**生成器**: 言語は 3 つ、名前は 5 つの小さなプールから引く。名前のプールに訳と同じ綴りを入れておくのは、
「label が別の言語の訳と同じ」場合と「label が名前でも訳でもない」(名前が変わった) 場合の両方に当てるためである。見る人の言語は
訳の無いものも引く。

**変異で確かめた**: (D4 の前) 訳との照合を外すと性質 1 つと例 1 つが、node・edge の区別を外すと例 1 つが、既定値から訳を
除く所を外すと往復の性質 (`seed.test.ts`) が、訳を読む所を外すと往復の性質と例 1 つが落ちる。
