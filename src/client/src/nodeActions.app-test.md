# nodeActions.app-test.tsx — node の操作の App 結合のテスト仕様

## 何を

node の操作 (計画 node-actions-request-module.md N2) を、`<App />` を丸ごと描いて確かめる。
次の流れを一周させる。

1. module を登録する (`NodeActionsProvider`)
2. node を選ぶと、node のそばに操作が出る (`NodeToolbar`)
3. 押す、または dialog で引数を決める
4. GraphEvent が dispatch され、op-log に載る
5. 画面が変わる (使えなくなった操作が消える)
6. undo で戻る

## なぜ

判断 (`registry.ts`) と dialog は単体で確かめてある。ここで見るのは**つなぎ**である。

- 選択から操作が出るか
- 押した結果が正典まで届くか
- 届いた結果で操作の出方が変わるか
- 1 回の undo で戻るか
- 右クリックのメニューからも同じことができるか

依頼の module はまだ移していない (N3) ので、**試験用の module** を登録する。依頼に依らない拡張点の約束として確かめる。

## どのように

試験の module は 2 つの操作を持つ。

- **印を付ける**: 引数なし。印が付いた node には出ない
- **札を書く**: 引数あり (必須の本文)。dialog の初めの値は node の property から読む

例で確かめる。

- 選ぶ前は何も出ない。選ぶと「印を付ける」「札を書く」が登録の順に出る。「印を付ける」を押すと op-log の
  property に印が付き、その操作は消える。ヘッダの「元に戻す」1 回で印が消える
  (GraphEvent 1 つ = undo 1 回)
- 「札を書く」は dialog で書いて実行すると op-log に載り、dialog は閉じる。次に開くと前の値が入っている
- 右クリックのメニューに同じ操作が同じ順に出て、そこからも実行できる。実行するとメニューは閉じる
- module が登録されていなければ、選んでも右クリックしても何も出ない

見るだけの所 (`readOnly`) で出ないことは、判断の性質 (`registry.test.ts`) で確かめている。

操作は canvas の拡大縮小の領域の中にあるので、押すと canvas が動き出していた。happy-dom では d3 の
例外として見えた。React Flow の印 (`nodrag`・`nopan`) を付けて止めた。
