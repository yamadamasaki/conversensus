# propertySchema のテスト仕様

## 何を

template の property の宣言 (型と editable、template-update K9・計画 T5) を、template graph の種類の node/edge の
付随 property (`app.conversensus.propertySchema.<名前>` に `{ type?, editable? }`) として読み書きする関数。

## なぜ

宣言は op の語彙を増やさずに property として置く (K9 の案 A)。書き (`propertySchemaProperties`、種の複製と
template graph の画面) と読み (`propertySchemaIn`、`templateFromSheet`) がずれると、型を付けたのに効かない・
editable を外したのに戻る、が起こる。読みは他の参加者が書いた値を読むので、形の違う値で落ちてはいけない。

## どのように

### 生成器

- 名前は小さなプール (`.` を含むものも)。型は読める文字列・前後に空白のある文字列・空文字・読めない文字列。
  editable は両方
- **「何も宣言しない」形 (型が無いか空、かつ editable) にも当たる** — それは置かない (消してよい) ので、
  往復の比較は「置く値の形にそろえた宣言」と行う

### 性質

| 性質 | 固定すること |
| --- | --- |
| property にして読み直すと、置く値の形にそろえた宣言に戻る | 書きと読みが互いの逆。型の前後の空白は除かれ、何も宣言しない形は残らない |

### 例

- 宣言の property の名前 (前置きだけの名前は宣言ではない)
- 読めない値 (editable が真偽でない・値が object でない) は黙って落とす。前置きの無い同じ名前は見ない
- 何も宣言しない形は置かない (`undefined`)。editable: false だけの宣言は置く
- **読めない型の文字列も捨てずに持つ** — 捨てると、template graph の画面で誤りを見せて直させられない
