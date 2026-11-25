# template graph

> [step3](../step3.md) の子文書。出所: Notion「template graph」(2026-09-30)。
> template graph は**種別プロパティが `template` の sheet** であり、専用の op は持たない
> ([step3 §3.3 D3](../step3.md))。適用先は `sheet.create` の `TemplateRef` で template sheet と
> その切断面を指す ([§3.4](../step3.md))。

template graph は, template を LPG で定義した, 特別な種類のグラフである.
以下のようにして, 定義される.

以下では,

- 単に node, edge と呼んだら, template graph に存在する node, edge を表す
- template を適用したグラフのことを「適用先グラフ」と呼ぶ

定義:

- node の label は, 適用先グラフにおいて, その label の名前を種類/label 名とする node が
  存在し得ることを意味する
  - UI 上では, node 生成時の選択肢として, その可能な種類が提示される. 生成された node は
    その種類を持つ
  - 種類は template ごとにまとまって表示されるとよい
    - 例えば, Toulmin model → data, claim, …
- edge の label は, 適用先グラフにおいて, その label の名前を種類/label 名とする edge が
  存在しうることを意味する
  - UI 上では, edge の接続時にその種類が一意に決まらない場合 (同じ source/target の種類を
    持つ異なる種類の edge が存在する) には, 接続時の選択肢として, その可能な種類が
    提示される. 接続された edge はその種類を持つ
    - 種類が一意に決まる場合には, 選択肢を提示するまでもなく, label/種類を決めてしまってよい
  - 種類は template ごとにまとまって表示されるとよい
- node/edge の property は, 適用先グラフでも同じ key の property を持つ
  - template 側では, 型と値を指定し, 値はその property の適用先グラフでのデフォルト値となる
  - 本当は read-only, read-write などが指定できるといい気もするけど, それは後々
- template graph は, それを適用しようとするグラフ (sheet) と同じ file に置く
  - グラフの種類は template
  - 名前は何でも構わないが, UI 上 (例えば選択肢の区分, シートの種類) ではその名前が使われる
    (例えば Toulmin model)
  - file の中に template graph があったら, それが「シートを追加」の選択肢となり, それを
    選択して作成された sheet は, その template graph の適用先グラフとなる
    - この UI では, template graph は一つに限られてしまうが, 複数適用可能にしたい
      - 例えば, 「シートを追加」で, ダイアログが popup し, そこに可能な template graph の
        チェックボックスが並ぶ
- template graph も更新可能だが, 適用する内容は適用先グラフの生成時に決まってしまう
  - template graph も metagraph と同様, branch は切れないことにする
- template graph にその使い方を記した通常の node/edge (適用先グラフで使われることを想定しない)
  を置くこともできる. 適用想定外の node/edge は
  - label のない node
  - label のない node 同士を接続する edge
    - この場合は edge に label があってもよい (適用要素とはならない)
    - 人間の認知的には edge の label が node の label を兼ねる感じになる
  - label のある node とない node を接続する edge は, 適用要素となる
    - 適用先グラフでは, label のない node は template にない種類の任意の node を意味する
- template graph も当然 metagraph に graph node として登場する
  - システムが勝手に template というようなラベルの edge で, 適用先グラフと接続することは
    ないが, 場合によっては, ユーザがそのような記述をするのも役に立つかもしれない

## template-update で決めたこと (2026-11)

> 追記。上の本文 (Notion からの移行) には手を入れず、[template-update](../step4/template-update.md) の
> 計画 ([plans/template-update.md](../../plans/template-update.md) §2 の K1〜K16) で決めたことを
> ここにまとめる。本文と食い違う所は、この節が新しい。

### 種類の定義 (K6・K11・K13〜K15)

- **見た目 (K11)**: 種類の node の見た目 (markdown・group・image) が、その種類の見た目になる (`NodeKind.nodeType`、
  無ければ markdown)。node を作るメニューは、見た目を選んでからその見た目の種類を選ぶ形にする (#406・#412)
- **label の重複 (K6)**: 同じ label (前後の空白を除いて比べる) の種類が 2 つ以上あれば、**どれも種類にしない**。
  そこに繋がる edge も種類にしない。template graph の画面で警告する
- **本文 (K13)**: markdown の種類の content は適用先へ写さない。適用先の content が空のとき、placeholder として
  薄く見せる (#411)
- **group (K14)**: group による種類の範囲付けはしない。template 中で group の中に書くのは緩いガイドラインで、
  システムは気にしない
- **片端が「任意」の edge の種類 (K15)**: 本文の「label のある node とない node を接続する edge は, 適用要素となる」
  を受けて、候補に片端が任意の種類があるときは**自動で付けない**。接続のときに候補として選ばせ、その中に
  「ラベルなし」を含める。本文の「種類が一意に決まる場合には, … 決めてしまってよい」は、両端が種類の node の
  edge に限る。headless の `add_edge` も、種類を渡されない限りラベルなしで繋ぐ
- **既存オントロジとの接地 (K16)**: ラベルなし node の content に URI を書き、種類の node から慣習の label
  (`external`・`import` など) の edge で繋いで表す。K15 があるので、適用先の自由な接続を邪魔しない

### property (K7〜K10・K12)

本文の「template 側では, 型と値を指定し, 値はその property の適用先グラフでのデフォルト値となる」
「本当は read-only, read-write などが指定できるといい気もする」を、次の形で実現した。詳細は
[property editor](../../requirements/spec/propertyEditor.md) の「template が宣言する property」。

- **名前 (K7)**: template graph では prefix 無しで書き、適用先では `${templateId}.<名前>` とシステムが導く。
  表示は prefix を外し、template の名前を添える。本文の「適用先グラフでも同じ key の property を持つ」は、
  この意味で**同じ名前**である
- **型と editable (K9・K10)**: 種類の node/edge の付随 property `app.conversensus.propertySchema.<名前>` に
  `{ type, editable }` で宣言する
- **既定値 (K12)**: 適用先へ写さず、読むときに補う。既に写された値はそのまま残す
- **editable: false (K8)**: 値は常に template の既定値。書き込みの入口 (UI・MCP の道具) で守る

### 版と動的適用 (K1〜K5)

本文の「template graph も更新可能だが, 適用する内容は適用先グラフの生成時に決まってしまう」を、次のように改めた。

- **版 (K1)**: template graph は branch を切らない (本文どおり)。適用先が見る版は `at` (File の trunk の切断面)
  である。新しい版があることを通知する。「新しい版」とは、`at` で読んだ種類と trunk の先端で読んだ種類が
  違うことであって、template graph の op の有無ではない (node を動かしただけでは新しい版にならない)
- **pull (K2・K3)**: 適用先を新しい版にするのは、`at` を先端へ進めること。sheet の property
  `app.conversensus.appliedTemplate.<id>` に書き、読むときは property が `sheet.create` の `templateIds` より
  勝つ。読むときに導けるものは op を書かない。種類の名前の変更は、既にある要素の表示にも及ぶ
- **違反 (K2)**: pull の後に規則を満たさなくなった要素 (種類が消えた・端の組が許されない edge、型に合わない
  property) は、削除も置換もせず、違反として見せる
- **外す (K4)**: 後から当てた template は外せる (property を消す)。**作成時に当てた template は外せない**
  (作成の op に載っていて、取り消しの印は作らない)
- **削除 (K5)**: template graph が削除されたら、適用先は止めた版のまま動く。「削除された」と通知する
- **agent**: headless は pull しない。版を進めるのは sheet 全体に効く判断なので人間が行う (計画 Q5)

本文の「template graph は … 同じ file に置く」「複数適用可能にしたい」は、どちらもこのとおりになっている
(複数の template を当てられ、後からも当てられる — #355)。
