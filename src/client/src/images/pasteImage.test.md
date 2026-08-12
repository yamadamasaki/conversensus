# pasteImage のテスト仕様

## 何をテストするか

貼り付けた画像の**振り分け** (`pasteImage`) —
「選択中の画像ノードへ差し替える」か「新規ノードを作る」かの分岐と, そのときに
差し替え先へ何を渡すか (`deepse/plans/step1-refinement-ana116-image.md` §4 D6)。

## なぜテストするか

分岐の両端 — 行き先の規則 (`pasteTarget.ts`) と差し替えの手続き
(`replaceNodeImage.ts`) — はそれぞれテスト済だが, **繋ぎ方を間違えると両端が
正しくても壊れる**。倒れ方の違いは利用者からこう見える:

- 差し替えるべきときに新規を作る → 「勝手にノードが増えた」
- 新規を作るべきときに差し替える → **別のノードの画像が消える**

`GraphEditor` の中に残しておくと React Flow を描画しないと確かめられないので,
振り分けだけを取り出した (レビュー記録 T2 / N3)。

## どのようにテストするか

依存 (`pickTarget` / `addImageNode` / `replaceImage`) を引数で差し込み,
**どちらがどう呼ばれたか**を観測する。React Flow も blob ストアも要らない。
ノードは振り分けに要る形 (`id` / `data.properties`) だけで作る。

- **貼り付け先が無ければ `addImageNode`** — `replaceImage` は呼ばれない
- **貼り付け先があれば `replaceImage`** — `addImageNode` は呼ばれない。
  ノード id と画像がそのまま渡る
- **差し替え先の `properties` をそのまま渡す** — op は置換意味論なので,
  渡し損ねると画像以外の properties が消える (`replaceNodeImage.test.md` 参照)
- **`properties` を持たないノードでも渡せる** — `undefined` が通ること
- **行き先は貼り付けた時点で決める** — `pickTarget` を呼ぶのは貼り付けのとき。
  Cmd+V の経路は `clipboard.read()` を await するので, 選択の読みが早いと
  古い選択で振り分けられる
- **振り分けた先の完了を待つ** — 呼び出し元は await してから二重処理の印を付ける

## ここでテストしないこと

- **どのノードを選ぶかの規則**: `pasteTarget.test.ts` の領分 (複数選択・別種の選択)
- **保存と op の組み立て**: `replaceNodeImage.test.ts` / `imageBlob.test.ts` の領分
- **新規ノードの位置決めとクリップボード API の吸収**: `GraphEditor` 側の配線で,
  ブラウザ差を含むので単体では観測できない
