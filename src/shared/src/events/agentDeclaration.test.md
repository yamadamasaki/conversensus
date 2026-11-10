# agentDeclaration.test.ts — agent の宣言と裏付けのテスト仕様

## 何を

`agentDeclarationOf` を検証する。agent の repo の宣言 (`agentProfile`) と、operator の repo の裏付け (`operatedAgent`)
から、DID が agent であるかの状態 (`none`・`claimed`・`verified`) を導く関数である (設計 agent-actor.md D2)。

## なぜ

「裏付けあり」は表示で人に信頼を与える。**互いを指していないのに裏付けありと出す**と、誰かが他人の agent を
騙れる。逆に、**名乗っていない DID を agent と呼べる**と、人間を勝手に agent 扱いできる。どちらも全称命題なので
性質で書く。record は他の人の repo から来るので、形が違っても落ちないことも確かめる。

## どのように

- (例) 宣言が無ければ agent ではない (裏付けだけがあっても)
- (例) 宣言だけなら名乗りのみ。operator・model・説明を持つ
- (例) operator の裏付けがこの agent を指していれば裏付けあり。別の agent を指していれば名乗りのみ
- (例) 形の違う record は無いのと同じ
- (性質) 裏付けあり ⇔ 宣言が読め、裏付けが読め、裏付けがこの DID を指す。名乗りのみ ⇔ 宣言だけが成り立つ。
  それ以外は none
  - 生成器: DID は 3 つの小さなプールから引く。調べる DID・operator・裏付けの指す DID が一致したりしなかったりする
    組をよく引くためである。record は「正しい形・形の違うもの・無い」を混ぜる
  - 裏付けが**どの repo から来たか**はこの関数の外 (呼ぶ側が宣言の operator の repo から読む) なので、ここでは見ない
