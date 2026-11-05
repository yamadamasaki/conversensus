# importTemplateRefs.test.ts — import での template への参照の付け替えのテスト仕様

## 何を

`remapKindProperties` (種別の property の名前と値) と `remapTemplateRefs` (Sheet の `templateIds`) を検証する (#327)。

## なぜ

import は Sheet・node・edge の id をすべて振り直す。template を当てた Sheet は template graph を **id で**
指している (property 名 `template.<Sheet の id>.kind`、値は template graph の node / edge の id、
`templateIds` の `{sheet, at}`) ので、付け替えないと template が黙って落ちる。`at` (切断面) も、元の File の
actor を指したままでは取り込んだ File の genesis を含まず、template graph の Sheet が「まだ無い」と読まれる。

## どのように

- **種別は名前も値も付け替える**
- **種別でない property、取り込んだ File に無い Sheet の種別、作り込みの template (逆順ドメイン) の種別は触らない。**
  template graph の Sheet を指すものだけが id の振り直しの影響を受ける
- **値が要素の id に当たらなければ名前だけ付け替える。**値を勝手に消すと、利用者が書いたものが失われる
- **`{sheet, at}` は新しい Sheet と genesis の切断面へ**
- **作り込みの id はそのまま。**解決はされない (Q1) が、書かれたものを import で消す理由は無い

File を丸ごと取り込んで template が解決できることは `localStore.test.ts` (importFile) が見る。
