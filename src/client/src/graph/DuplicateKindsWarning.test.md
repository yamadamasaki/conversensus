# DuplicateKindsWarning のテスト仕様

## 何を

template graph の画面で、名前の重なった種類を知らせる表示 (template-update K6)。

## なぜ

名前の重なった種類は、読み替え (`templateFromSheet`) で両方とも無効になる。共同編集では書き込みの時点で
一意を強制できないので、読む側で無効にしている。知らせなければ、定義した人は「種類を足したのに当てた Sheet の
メニューに出ない」理由が分からない。

重なりの判定そのもの (空白を除いて比べる・並び) は `duplicateKindLabels` の性質で見ている
(`shared/src/template/fromSheet.test.md`)。ここは表示だけを見る。

## どのように

- 名前の重なった種類があれば、その名前を挙げる。重なっていない種類の名前は挙げない
- 重なりが無ければ何も描かない。label の無い node (説明書き) は何個あっても重なりではない
