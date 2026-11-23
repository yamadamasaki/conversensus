# template-update.md のレビュー (第一回目)

> 対象: [template-update.md](./template-update.md)。レビュアー: Claude (2026-11-22)。
> 今の実装 (`src/shared/src/template/`・`events/properties.ts`) と issue #401〜#412 を確かめたうえでの意見である。
> 項目ごとに番号 (R1〜) を振ったので、返答は番号で付けてほしい。

## 文書の問いへの答え (実装から分かること)

### R1: template と sheet の間の参照

> 今は template とそれを適用した sheet の間にはどういう参照があるんだっけ?

`TemplateSheetRef = { sheet, at }` である。`sheet` は template graph の sheet の id、`at` はその template graph の**切断面** (VersionVector)。

- 作るときに当てたもの: `sheet.create` の `templateIds` に載る
- 後から当てたもの (#355): sheet の property `app.conversensus.appliedTemplate.<template graph の sheet の id>` に `{ at }` として載る (`template/applied.ts`)
- 両方にあれば作るときのものが勝つ

### R2: template のバージョン化

> 今は, template はバージョン管理を行っていない (はず)

実は**もうできている**。template graph は branch を切れない (step3 [template-graph.md](../step3/template-graph.md)) ので、`at` (trunk の切断面) がそのまま版である。

- 「trunk のその時点での最新 merge か, ある branch のその時点での最新 commit」のうち、branch の側は存在しない
- 通常の graph のバージョン管理と別の仕組みを作る必要は無い。要るのは**`at` を trunk の最新へ進める操作** (= pull) だけである
- pull を推すことに賛成する。加えて、新しい版があることの通知があるとよい。古い `at` と trunk の両方が分かるので、template の差分も見せられる

### R3: property の型

> 今は型は入っている? あったとしても検証していないはず

- 語彙はある: `PropertyType` (`string | number | boolean | date | datetime | array | object`、`events/properties.ts`)
- **型を宣言して保存する場所も、検証も無い**。編集できる property は実質すべて文字列
- 仕様 ([propertyEditor.md](../../requirements/spec/propertyEditor.md)) の `|` ユニオン・リテラルは未実装 (値 1 つから推論できないので、宣言の語彙ができて初めて存在しうる、とコードの注釈にある)
- 値から型を推論する関数は意図して撤去済み (2026-09-20 の判断)

## 動的適用について

### R4: 再適用は「`at` を進めるだけ」に寄せる (一番大きな提案)

`resolveTemplates` (`template/fromSheet.ts`) は、表示するたびに template をその切断面から読み直している。適用先の node が持っているのは種別の **id** (template graph 側の NodeId、property `template.<sheetId>.kind`) であって label ではない。したがって `at` を進めるだけで、次のものは op を書かずに新しい版になる。

| 再適用の項目 | `at` を進めるだけで | 補足 |
| --- | --- | --- |
| node/edge の追加 | 反映される | 種類のメニューに出る |
| node/edge の削除 | 「template との関連だけなくす」になる | 知らない id は `kindIdIn` が `undefined` を返す = 普通の node として読まれる |
| label の変更 | 表示側の変更で反映できる | 表示用の口 `KindLabelOf` (#356) が既にある。種類の名前を template から引く形にする |
| edge の接続規則 | 反映される | 接続の可否・edge の種類の決定は template から毎回引いている |

op を書く必要が残るのは、**作成時に写したもの** (label・property の既定値・content) だけである。

そこで、文書の「再適用」の表の各行を

- **読むときに導く** (op を書かない)
- **op で書き換える**

に分け、なるべく前者に寄せることを勧める。理由は次の 3 つ。

1. 自動で削除や書き換えを入れると、pull した一人が**他の参加者が書いたもの**を書き換えることになる。共同編集ではこれが重い
2. 接続の制約違反や型の不一致は、削除や既定値への置換ではなく**違反として見せる**方が、元に戻せる。文書の「削除する」「default value に変更」は、この形にしてはどうか
3. editable が false になったときの「所有者以外の変更を undo」も、畳み込みのときに読み飛ばす規則にすれば、過去の分にも自動で効く。ただし、projection が template の切断面に依存するという複雑さが入る (R8 も参照)

### R5: 作るときに当てた template の `at` を進められるようにする

作るときに当てた template の `at` は `sheet.create` に載っていて、後から変えられない。pull を入れるには、後から当てる property (`appliedTemplate.<id>`) の `at` が作るときのものを上書きできるよう、R1 の優先規則を変える必要がある。

### R6: 再適用で見落としていると思われるケース

- 種類の見た目 (nodeType) の変更 (markdown → group など。R10 で見た目を種類に持たせた場合)
- edge の種類の端の変更 (from/to の付け替え)
- template graph そのものの削除
- 適用先 sheet の branch で `at` を進めてから merge したとき (`at` は property なので、trunk の値と branch の値が競合しうる)
- 一つの sheet に複数の template があるとき、一つだけを pull する場合

## 仕様の明確化について

### R7: template 内の label の一意性

> ➕️ template 中に同じ label を持つ別の node は存在しない

共同編集では、書き込む時点で一意を強制できない (2 人が同時に同じ label を付けられる)。**重複したときの規則を読み取り側で決めておく**必要がある (例: 重複した種類は両方とも無効にし、template graph の画面で警告を出す)。

### R8: editable の「所有者」が定まらない

> property の所有者は, 以下の三種類があり, 項目名のパタンで決まっている

template が配る property の名前はふつう custom (`.` を含まない。例: `期限`) である。名前のパタンで決めると、その所有者は「任意のユーザ」になり、editable を false にしても意味が無い。

- template が配る property の所有者を **template (の作者)** とみなすのか、決める必要がある
- P2P の op-log では書き込みそのものは止められない。効かせられるのは**畳み込みのときの読み飛ばし**だけである (system の property と同じ扱い)
- 動的適用 (R4 の 3) の設計に効くので、先に決めておくべき

### R9: type と editable をどこに書くか

今の template graph の property は key と value しか持たない。案は 2 つある。

- **案 A (推す)**: 種類の node/edge に付随 property を置く。例: `app.conversensus.propertySchema.<key>` に `{ type, editable }`。言語ごとの名前 (`label:<言語>`、#356) と同じ流儀で、op の語彙を増やさない (step3 の「op 語彙はコアが閉じる」に沿う)。既定値と同じく、適用先へは写さない
- **案 B**: value を `{ value, type, editable }` のような記述子にする。object 型の既定値と区別がつかなくなるので、推さない

なお、型の検証を「値の設定時」に行うだけでは足りない。他の参加者の op は、こちらの検証を通らずに届く。読み取り側でも不正な値を扱う必要がある (R4 の 2)。

### R10: 見た目 (nodeType) を種類の一部にする

`NodeKind` には今 nodeType (markdown / image / group) が無い。group node に label を付けても、適用先で markdown node になる #406 の原因はこれである。

- 種類に nodeType を持たせれば、「見た目を選んでから、その見た目に定義された種類を選ぶ」(#412) も nodeType での絞り込みで実現でき、両者が整合する
- 文書の「node の種類ごとの変異」(markdown・image・group で content の扱いが違う) も、種類が nodeType を知っていることが前提になる

### R11: 既定値は写すのか、読むときに補うのか

今は、作成時に既定値を node の property へ**写している**。もう一つの形は、property が無ければ template の値を見せる (**読むときに補う**) ものである。

- 補う形にすれば、property の追加・削除は op 無しで反映される (R4)
- その代わり、「template の default が変わると、値を設定していない既存の node の値も変わる」という意味になる。文書の「(default) value → そのまま」とは逆になる
- どちらを採るか決める必要がある。R8 と同じく、動的適用の設計に効く

### R12: content を placeholder として扱う

文書の「markdown の content は placeholder」と #411 (写された content を gray out したい) は同じことを言っている。今は content を値として写している。placeholder にするなら、**写さずに、content が空のとき template の content を薄く見せる**形が素直である (R11 の「読むときに補う」と同じ形)。

### R13: group の範囲付け

> template の content (group に属する node/edge) は, template の適用先の group 内で適用可能な node/edge として扱われる

「その group の中だけで使える種類」にするなら、次の問いが出る。

- その種類は group の外では使えないのか
- 入れ子の group はどう扱うか (group の種類の中に group の種類がある場合)
- group の境界をまたぐ edge は、どちらの規則で判定するか
- drop-in (#407) で外から入れた node や、外へ出した node の種類はどうなるか

## 既存オントロジとの接地

### R14: ラベルなし node に URI を書く案は、今の規則とぶつかる

> とりあえず, その場合は template のラベルなし node の content にそのオントロジの URI を記すことにしておくのはどうだろうか?

今の規則では、片方の端に label のある edge は edge の種類になり、ラベルなしの端は「この template の種別を持たない任意の node」を意味する ([template-graph.md](../step3/template-graph.md))。種類の node から URI を書いたラベルなし node へ `is-a` を引くと、**「その種類 → 任意の node」という適用可能な edge の種類**が生まれてしまう。

代わりに、**種類の node の property で表す**ことを勧める。例: `sameAs` や `subClassOf` に URI を値として置く。LPG として自然で、種類も edge の種類も生まない。名前空間を付けるなら、RDF の語彙を逆順ドメインで書く形 (例: `org.w3.rdfs.subClassOf`) が property の規約に合う。

## 進め方の提案

### R15: 3 段に分ける

1. **静的な仕様の補強**: 種類に nodeType を持たせる (R10、#406・#412)、型と editable の宣言 (R9)、label の一意性の規則 (R7)、content の placeholder (R12、#411)
2. **group の範囲付け** (R13)
3. **動的適用**: `at` を進める pull (R4・R5) と、新しい版の通知 (R2)

R8 (所有者の定義) と R11 (既定値を写すか補うか) は 3 の設計に効くので、1 に入る前に決めておくのがよい。
