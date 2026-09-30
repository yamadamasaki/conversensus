# metagraph

> [step3](../step3.md) の子文書。出所: Notion「metagraph」(2026-09-30)。
> **graph node は op として積まず、sheet の一覧から導出する** ([step3 §3.2 D2](../step3.md))。

metagraph は、同じ file 内の sheet (グラフ) の間の関係を記述するグラフである。file の目次
(toc, index) の役割も果たす。いくつかの点を除いて、基本的には通常のグラフと同じものである。

- File を作ると、その中の sheet の一つとして metagraph が作られる
- その名前はデフォルトで "index" とする。変更可能である
- metagraph は、その file の中のすべての sheet を node (種類は graph node。markdown node
  などと同じレベル) とするグラフ (特殊な sheet。種類は metagraph) である
- file を作ると、デフォルトで "Sheet 1" というグラフが作られるが、その時点で metagraph には
  "Sheet 1" というラベルを持つ、graph node という種類の node が存在する
- file に sheet を追加するたびに file 内のすべての metagraph にその sheet が graph node として
  追加され、sheet が削除されるたびに file 内のすべての metagraph からその sheet に対応する
  graph node が削除される
  - この場合の node の配置は、システムに任せる。当然後から作業者が移動することはあり得る
  - metagraph 自身も特殊な sheet として metagraph に登場する
- metagraph に対して、以下の操作が可能である
  - graph node 以外の node を追加、編集、削除できる
  - graph node を追加すると、それは file 内の sheet としても追加される
  - graph node を削除すると、それに対応する sheet は file から削除される
  - (graph node を含む) 任意の node の間に、任意の edge を作成できる
  - graph node の label を変更すると、それは sheet の名前に反映される。逆も同じ
- graph node の content は、対応する sheet の内容である。graph view では label 以外は
  当初は表示しなくてよい
- metagraph によって、file 内の sheet の間の関係を明示的に記述することができる
- metagraph は branch を作ることはできない (versioning 対象ではない)
- metagraph も、file の共同作業者には共有される
- metagraph に対する操作も、通常のグラフと同様に op-log に載る
- 複数の metagraph が存在しても構わない。それぞれの metagraph は file に対するそれぞれの
  視点を表している
- 課題: metagraph を metagraph template から作れるか?
  - 少なくとも内部的に実装された、特殊な template として扱うことはできるだろう
  - それを template graph の仕様定義に反映させたい
