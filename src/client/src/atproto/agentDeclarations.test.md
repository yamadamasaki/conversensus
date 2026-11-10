# agentDeclarations.test.ts — agent の宣言を覚えておく (設計 D2)

## 何を

`createAgentDeclarationCache` を検証する。参加者一覧が DID ごとの宣言を読むときに、覚えておく入れ物である。
PDS から読む `readAgentDeclaration` は偽の PDS の上の `src/headless/src/agentDeclaration.test.ts` が見る。

## なぜ

参加者一覧は開くたび・描き直すたびに参加者全員の宣言を引く。宣言 1 つに PDS へ 2 回 (宣言と裏付け) 問い合わせるので、
覚えておかないと数十人の File で問い合わせが重なる。逆に、認めた・取り消した後に古い値を出し続けてはいけない。

## どのように

- 同じ DID は 1 度だけ読む。読んでいる最中に重ねて頼んでも重ねない
- 忘れると、次は読み直す (認めた・取り消した後)
- すべて忘れると、どの DID も読み直す。参加者一覧は閉じるたびにすべて忘れる (`useAgentDeclarations`)。開き直したときに、
  その間に agent が書いた宣言を拾うためである (覚えたままだと、再読み込みするまで「agent ではない」と出続けた)
