# template graph

> [step3](../step3.md) の子文書。出所: Notion「template graph」(2026-09-30)。
> template graph は**種別プロパティが `template` の sheet** であり、専用の op は持たない
> ([step3 §3.3 D3](../step3.md))。適用先は `sheet.create` の `TemplateRef` で template sheet と
> その切断面を指す ([§3.4](../step3.md))。

template graph は、template を LPG で定義した、特別な種類のグラフである。
以下のようにして、定義される。

以下では、

- 単に node, edge と呼んだら、template graph に存在する node, edge を表す
- template を適用したグラフのことを「適用先グラフ」と呼ぶ

定義:

- node の label は、適用先グラフにおいて、その label の名前を種類/label 名とする node が
  存在し得ることを意味する
  - UI 上では、node 生成時の選択肢として、その可能な種類が提示される。生成された node は
    その種類を持つ
  - 種類は template ごとにまとまって表示されるとよい
    - 例えば、Toulmin model → data, claim, …
- edge の label は、適用先グラフにおいて、その label の名前を種類/label 名とする edge が
  存在しうることを意味する
  - UI 上では、edge の接続時にその種類が一意に決まらない場合 (同じ source/target の種類を
    持つ異なる種類の edge が存在する) には、接続時の選択肢として、その可能な種類が
    提示される。接続された edge はその種類を持つ
    - 種類が一意に決まる場合には、選択肢を提示するまでもなく、label/種類を決めてしまってよい
  - 種類は template ごとにまとまって表示されるとよい
- node/edge の property は、適用先グラフでも同じ key の property を持つ
  - template 側では、型と値を指定し、値はその property の適用先グラフでのデフォルト値となる
  - 本当は read-only, read-write などが指定できるといい気もするけど、それは後々
- template graph は、それを適用しようとするグラフ (sheet) と同じ file に置く
  - グラフの種類は template
  - 名前は何でも構わないが、UI 上 (例えば選択肢の区分、シートの種類) ではその名前が使われる
    (例えば Toulmin model)
  - file の中に template graph があったら、それが「シートを追加」の選択肢となり、それを
    選択して作成された sheet は、その template graph の適用先グラフとなる
    - この UI では、template graph は一つに限られてしまうが、複数適用可能にしたい
      - 例えば、「シートを追加」で、ダイアログが popup し、そこに可能な template graph の
        チェックボックスが並ぶ
- template graph も更新可能だが、適用する内容は適用先グラフの生成時に決まってしまう
  - template graph も metagraph と同様、branch は切れないことにする
- template graph にその使い方を記した通常の node/edge (適用先グラフで使われることを想定しない)
  を置くこともできる。適用想定外の node/edge は
  - label のない node
  - label のない node 同士を接続する edge
    - この場合は edge に label があってもよい (適用要素とはならない)
    - 人間の認知的には edge の label が node の label を兼ねる感じになる
  - label のある node とない node を接続する edge は、適用要素となる
    - 適用先グラフでは、label のない node は template にない種類の任意の node を意味する
- template graph も当然 metagraph に graph node として登場する
  - システムが勝手に template というようなラベルの edge で、適用先グラフと接続することは
    ないが、場合によっては、ユーザがそのような記述をするのも役に立つかもしれない
