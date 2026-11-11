# 後から当てられる template graph のテスト

## 何を

`applicableTemplateGraphs(sheets, target)` — 既にあるシート `target` に後から当てられる template graph (#355、
計画 apply-template-355.md)。sheet の「…」に入口を出すかどうかと、開くダイアログに並べるものが、同じ答えを使う。

## なぜ

- **既に当たっている template graph を出さない** (issue の望む振舞い)。作るときに当てたもの (`templateIds`) と
  後から当てたもの (Sheet のプロパティ) の両方を見なければならない。片方だけでは、二重に当てられる
- **template graph・metagraph のシートには当てない。**template graph の node は種類の定義そのもので、metagraph の
  node は Sheet の一覧から導くもの。どちらも種類を持つ node を置く所ではない
- 並びは File の中の順にする。シートを足すときのダイアログと同じ

## どのように

- 当たっていない template graph を File の中の順で返し、ふつうのシートは並べない
- 作るときに当てたものも、後から当てたものも除く
- template graph と metagraph のシートには何も返さない (自分自身を当てることもない)

画面の入口が消えること・当てると種類のメニューが出ることは `App.app-test.tsx` が見る。
