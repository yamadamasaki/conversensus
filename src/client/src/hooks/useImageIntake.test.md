# useImageIntake.test.ts — 画像の受け入れ

step3 Phase 0 S0-2 で `GraphEditor` から切り出したフック。

## 何を

drop / paste イベント / Cmd+V の 3 経路が、同じ「保存して画像ノードにする」に正しく合流すること。

## なぜ

`GraphEditor` の中にあった間はテストが無かった (1268 行のコンポーネントにテストが無かった)。
3 経路の合流には、実機でしか見えなかった細部がある — Cmd+V の代替パスと paste イベントの
二重処理、1 項目が複数の画像表現を持つ場合、保存失敗の握り潰し (ANA-116 / ANA-117)。
切り出したことで、これらを単体で固定できるようになった。

## どのように

- 保存先 (`saveImage`) を差し替える。本物はローカルサーバの blob ストアに書く
- `ClipboardEvent` の `clipboardData` は happy-dom が組めないので、形だけ与える
- `navigator.clipboard.read` を stub にし、解決を遅らせることで実機の順序
  (keydown が read() を待つ間に paste が届く) を作る
- 選択中の画像ノードの差し替え (`replaceNodeImage`) の経路は、ここでは通さない。
  振り分けは `images/pasteImage.test.ts`、差し替えは `images/replaceNodeImage` 側で見ている

| テスト | 固定すること |
| --- | --- |
| paste: 画像を保存して画像ノードを作る | 基本の経路 |
| paste: 入力欄への貼り付けは扱わない | テキストの貼り付けを奪わない |
| paste: 画像でないものは無視する | |
| paste: 保存に失敗したら理由を知らせる | **握り潰さない** (ANA-116 設計 D7)。ノードも作らない |
| Cmd+V: clipboard.read() から画像を取る | paste イベントが来ないブラウザ向けの経路 |
| Cmd+V: paste が受け取っていたら二重に作らない | `pasteHandledAtRef` の譲り合い |
| Cmd+V: 複数の画像表現でも 1 枚 | 最初の 1 枚で抜ける |
| drop: 落とした位置 (canvas 座標) に作る | 画面座標 → canvas 座標の変換を通す |
| drop: 画像以外を無視し、最初の 1 枚だけ | |
| drop: 保存した参照を properties で渡す | `imagePropertiesOf` の形 |
