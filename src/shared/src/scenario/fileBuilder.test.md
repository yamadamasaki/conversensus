# fileBuilder.test.ts — 場面の組み立て (step4)

## 何を

`FileBuilder` / `SheetBuilder` が、短く書いた場面 (Sheet・node・edge・画像・metagraph の graph node)
から `.conversensus` を作り、それを import すると書いたとおりの姿になること。

## なぜ

入門の図は、写らない下ごしらえをこれで作って import し、画面を撮る
(`deepse/architecture/step4/intro-guide-figures.md` §2)。**組み立てが静かに間違えると、図が静かに違う**。
画面で気づけるとは限らない (label が 1 つ欠けても、図は図に見える)。

確かめる相手は「組み立てた JSON」ではなく **import して op-log から畳み込んだ姿**である。画面が見るのは
後者で、import は id を振り直し、metagraph の graph node を導出し直す。JSON だけを見ても、
その 2 つを通った後の姿は分からない (実際、このテストを書く途中で import の 2 つの壊れ方が見つかった:
node の label が落ちる、graph node が二重になる)。

## どのように

| テスト | 固定すること |
| --- | --- |
| `.conversensus` の形をしている | import の入口と同じ schema (`ConversensusFileSchema`) を通る |
| 同じ場面からは同じものができる | id を名前から決める (`deterministicUuid`)。撮り直しで `.conversensus` に差分が出ない |
| 同じ名前の Sheet は足せない | id が名前から決まるので、同じ名前は同じ id になってぶつかる。黙って重ねず、組み立ての時点で断る |
| import すると、書いたとおりになる | node の本文・label・property、edge の向きと label、置き場所 |
| 画像は実体ごと同梱される | 同梱しないと、import した先で「画像を読み込めません」になる (ANA-116 D1) |
| 🔴 metagraph の graph node は、import した先の Sheet の graph node になる | graph node は保存せず導出する。置き場所と edge が新しい Sheet の graph node に付く。index 自身も graph node として出る。label は `graph` |

場面は 1 つ (`scene()`) を使い回す。入門の場面と同じ題材 (『自由論』) にしてあるが、入門の中身とは独立している。
