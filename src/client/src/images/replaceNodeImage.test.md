# `replaceNodeImage` のテスト仕様

## 何をテストするか

既存の画像ノードの画像を差し替える**手続き**。「画像を保存する → 置き換え後の
properties を載せた op を投げる → 失敗を伝える」の 3 段が, 順序と形のとおりに
起きることを見る。

## なぜテストするか

**この手続きが 2 箇所に散っていたことが, レビューで見付かった穴の原因**である
(`deepse/reports/review_2026-08-11_ana116-image.md` R3)。`ImageNode` の drop と
`GraphEditor` の貼り付けが同じことを別々に書いていたため, 「op に何を載せるか」の
判断が片方だけ直る状態になっていた。

1 箇所に集めた以上, **ここが op の形の唯一の番人**である。とくに次の 2 点は
projection の意味論に直結するので, 壊れても型では気付けない:

- `to` が**置き換え後の全体**であること (`node.setProperties` は置換意味論なので,
  差分を載せると他の properties が消える)
- `from` が**差し替え前の全体**であること (`invertEvent` は from と to を入れ替える
  だけなので, 差分だと undo で properties が欠ける)

また **失敗を投げ返さないこと**も仕様である。呼び出し元はどちらもイベント
ハンドラで, 例外を投げても拾う相手がいない。握り潰さずに `reportError` へ渡す
(設計 D7) ところまでが手続きの責務になる。

## どのようにテストするか

`save` を差し込んで PDS もローカル daemon も触らずに動かす。`dispatch` と
`reportError` は呼ばれ方を記録するだけのスタブにし, **何が渡ったか**を見る。

| ケース | 見るところ |
|---|---|
| 保存に成功する | `dispatch` が `NODE_PROPERTIES_CHANGED` を 1 回, 渡した `nodeId` で投げる |
| 同上 | `to` に新しい blob ref が入り, 画像以外の properties が残っている |
| 同上 | `from` が差し替え前の全体である (undo で欠けない) |
| 同上 | `reportError` は呼ばれない |
| 旧形式の base64 を持つノード | `from` / `to` のどちらにも base64 が残らず, `from` は**移行後の参照**になる |
| 保存が失敗する (上限超過など) | `dispatch` は呼ばれず, `reportError` にそのメッセージが渡る |
| `Error` 以外が投げられる | 文字列化して `reportError` へ渡す (`imageErrorMessage` の責務) |
| いずれの失敗でも | `replaceNodeImage` 自体は reject しない |

properties が `undefined` のノード (プロパティを一度も持ったことがない) でも
落ちないことを, 成功ケースの一種として併せて見る。

旧形式のケースでは `save` が **2 回**呼ばれる (落とした画像の保存と, 旧 base64 の
blob への移行) ので, 呼ばれた順に別の参照を返すスタブにして **どちらがどちらに
載るか**を見分けられるようにする。移行そのものの規則は
`imageBlob.test.ts` の `migrateLegacyImageProperties` が持つので, ここでは
**`replaceNodeImage` が移行を通していること**だけを確かめる。
