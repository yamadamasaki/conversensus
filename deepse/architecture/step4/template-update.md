# template update

ドキュメントを準備するために, (それまでおもにユースケース例としていたメモ的あるいは対話的なグラフではなく) より構造的で複雑なグラフやその template を記述しているうちに, 以下の問題が明らかになった.

- いくつかの不具合や改善が必要な点がある
- template について, 仕様をより明確にし, 機能を拡張する必要がある

ドキュメントの記述をいったん中断し, 上の二点への対応を優先して実施する.

`➕️` は, 従来の仕様からの追加/変更部分.

## template

より構造的な (well-defined な) グラフを扱うには, 現在の template では難しい.

この conversensus では, そのようなグラフは対象としないという選択肢もあり得る. しかし, conversensus が, 小規模な共同体の間でのデータの交換にも使われ得るということを考慮すると, 少なくともその基盤はある程度作っておきたい.

また, 構造的と言っても, 厳密な形式化をトップダウンで入れることはしたくない.

あくまで, 必要なグラフを描きながら, そのグラフのパタンを並行して (グラフ) 言語化する発達過程を自然に実現する仕組みを入れたい (bottom-up の, 親和的な domain (あるいは problem) -specific ontology).

(ただし, グラフの grounding (接地) という観点から, 既存の上位/中位オントロジとの接続も裏側では可能としたい)

そのために, 以下の二点を行う.

- template の仕様を明確にする
- template の適用を動的にする

### 仕様の明確化

template が定義するのは, 以下のものである. 位置は対象外である (装飾は, property を経由して適用されるかもしれない).

#### 対象

- node
    - label
        - template の適用先で, 同じ label を持つ node を作成可能
        - いったん作成したら label は変更不可
        - ➕️ template 中に同じ label  を持つ別の node は存在しない
        - ➕️ template 中に label を持たない node があってもよい
            - template の適用先には (直接には) 影響しない
    - property → 後述
    - content
        - template の適用先で, placeholder として用いられることがある
            - ➕️ node の種類 (markdown, image, group など) によって異なる → 後述
- edge
    - label
        - template の適用先で, 同じ label を持つ edge を作成可能
        - いったん作成したら label は変更不可
        - template 中に同じ label  を持つ複数の edge があってもよい
        - ➕️ template 中に label を持たない edge があってもよい
            - template の適用先には影響しない
    - property → 後述
    - source
        - template の適用先で, 同じ label を持つ node を source とする
        - ➕️ node が label を持たない場合は, 適用先では任意の node を source とすることが可能
    - target
        - template の適用先で, 同じ label を持つ node を target とする
        - ➕️ node が label を持たない場合は, 適用先では任意の node を target とすることが可能

#### property

property は以下の項目を持つ.

- key
- value
    - 空でない場合, template の適用先で default value として使われる
- ➕️ type
    - 型. 以前, どんな型を許すか検討したはず
    - 今は型は入っている? あったとしても検証していないはず
    - 値の設定時に検証する
- ➕️ editable
    - property の所有者は, 以下の三種類があり, 項目名のパタンで決まっている
        - system
        - (個々の) 拡張機能
        - (任意の) ユーザ
    - false の場合には, 所有者だけが変更できる
    - true の場合には, 誰でも変更できる
    - すべての property はだれでも見ることができる
        - ユーザは, ユーザ自身が UI 上で「すべての property を見る」をチェックすれば

#### node の種類ごとの変異

- markdown
    - ➕️ template の content は, template の適用先の content の placeholder として使われる
- ➕️ image
    - template の content は, template の適用先では使われない
- ➕️ group
    - template の content (group に属する node/edge) は, template の適用先の group 内で適用可能な node/edge として扱われる

### 動的適用

今の実装では, template の適用は sheet の作成時, あるいはその後の任意のタイミングで行われ, その後は template を変更してもそれが適用先に反映されることはない.

template を変更して, それを適用先に反映させるためには, もう一度その sheet を破棄して, 書き直す必要がある.

これでは, 対象のグラフを書きながら, その本質 (パタン) を抽象化した template も並行して, 段階的に洗練させていくというプロセスは実現できない.

そこで, 動的/継続的に template を適用するために, 以下のような機能が必要になると考えられる.

- どの時点での template を使っているかを明確にするために, template をバージョン化可能にする
    - 今は, template はバージョン管理を行っていない (はず)
    - 通常の graph のバージョン管理と同じでよいか?
        - 通常の graph のバージョン管理は, (branch を消さずに残しておくこともできるが) 基本的には trank に merge されることを暗黙の前提としている
        - ただし, バージョン管理の方法が graph によって複数あるというのも問題がある
- 何らかのタイミングで, 既存の適用先の graph に新しい template を再適用する
    - push
        - template がある file の中で, その template が適用されている sheet すべてに再適用する
        - ユーザから見ると, 知らないうちに sheet が変化していることになり得る
    - pull
        - sheet 側から, template の特定の version (あるいは trunk) を再適用させる
    - pull するのが妥当なように思える
- 適用できる version は, trunk のその時点での最新 merge か, ある branch のその時点での最新 commit という程度の粒度が妥当か?
- 今は template とそれを適用した sheet の間にはどういう参照があるんだっけ?

#### 再適用

再適用は, 以下のことを行うことになるだろう.

- node/edge の追加
    - 特にすることはない
    - label が重複するかもしれないが, それは許すとする
        - 今の時点でも, template の label との重複は特に問題にしていない
- node/edge の削除
    - 以下の選択肢がある
        - 適用先の node/edge も削除する
        - template との関連だけをなくす
            - label が変更可能になる
            - 関連する property は削除する
            - node/edge 接続の制約を満たさない場合には削除する
- node/edge  の label の変更
    - 反映する
- node/edge  の property の追加/削除
    - 追加/削除する
- node/edge  の property の変更
    - (default) value → そのまま
    - type → 合わなければ, default value に変更
    - editable → 反映
        - false になったら, それまでの所有者以外の変更を undo すべき? 大変そう
- node の content
    - node の種類によって異なるだろうが, 多分そのままでよい
- edge の source/target
    - node/edge 接続の制約を満たさない場合には削除する

まだ見落としている場合があるかもしれない.

### 既存オントロジとの接地

既存の上位オントロジを node/edge として  import したくなる/する必要がある場合もあるだろう.

とりあえず, その場合は template のラベルなし node の content にそのオントロジの URI を記すことにしておくのはどうだろうか?

(edge はどうする?)

必要最小限の edge (例えば, `is-a`, `is-part-of` などを template に入れておくのもありだろう.

owl import node を作る? → とりあえず普通の node でよい

## 改善点

issues に `TemplateUpdate` tag を付けて, 入れておく (#401 - #412).
