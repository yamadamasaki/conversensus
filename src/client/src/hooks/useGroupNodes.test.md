# useGroupNodes.test.ts

## 何を

`groupAbilityOf` — ヘッダの「グループ化」「グループ解除」を押せるかの判定 (#269)。

- 何も選んでいない → どちらも押せない
- node を 1 つ以上選んだ → まとめられる
- group を選んだ → 解ける。選ばれていない group は数えない

## なぜ

v1.0.0 ではこの 2 つが常に青く、押せそうに見えて何も起きなかった (UI/UX review §2.2)。
visual language §5「使えない操作は無効にして見せる」。判定は `groupSelectedNodes` /
`ungroupSelectedNodes` の前提と同じ関数を使うので、**押せる見た目と、押して何か起きることがずれない**。

## どのように

React Flow の `Node` を最小の形で作り、純粋な関数として呼ぶ。ヘッダまでの配線
(`GraphEditor` → `useGraphPanels` → `GraphHeader`) は App 結合のヘッダのテストが通す。
