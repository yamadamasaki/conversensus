# 当てた template の版のテスト

## 何を

`version.ts` の `templateVersionOf`。当てた template (`{ sheet, at }`) について、template graph を切断面 `at` で
読んだ種類と、trunk の先端で読んだ種類を比べ、`current` (同じ)・`newer` (先端に新しい版がある)・`deleted`
(先端で template graph が無い) を返す (計画 template-update.md 段 2 D2・D3、K1・K5)。

## なぜ

- **これが「最新の版にする」の入口 (D2) と、新しい版・削除の通知 (D3) の判定そのもの**である。外れると、
  何も変わっていないのに通知が出続けるか、変わったのに誰も気付かない
- **op の有無では決められない。**`at` は File 全体の trunk の切断面なので、ほかの Sheet を編集しても先へ進む。
  template graph の op に限っても、node を動かしただけでは適用先から見て何も変わらない。だから
  **template graph から読んだ種類** (`templateFromSheet`) を比べる
- **キーの並びで差を作らない。**既定値などのオブジェクトのキーの順は畳み込みで書いた順に依る。消して同じ値で
  書き直しただけで「新しい版」になると、何も変わらない pull を求めることになる

## どのように

例で書く。歴史は、template graph (種類「主張」1 つ) とほかの Sheet を作り、その時点の手元の vector を `at` にして
当て、その後に op を足して判定する。

- 何も足さなければ `current`
- 種類が変われば `newer`: 名前の変更・種類の追加・既定値の追加・本文 (説明と placeholder) の変更
- 種類が変わらなければ `current`: node を動かしただけ・label の無い node を足しただけ・ほかの Sheet の編集
- 既定値を消して同じ値で書き直しただけなら `current` (キーの並びが変わる)
- template graph が無くなれば `deleted`: Sheet の削除・種別のプロパティを消したとき

**変異で確かめた**: 比べる所を常に等しいにすると `newer` の例が、キーを並べずに比べると「書き直しただけ」の例が
落ちる。
