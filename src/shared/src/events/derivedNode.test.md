# derivedNode.test.ts — metagraph の導出 node (step3 Phase 1 D8)

## 何を

- `derivedNodeIdOf`: SheetId から導出 node の id を決定的に作る
- `derivedNodesFor`: いま在る sheet から導出 node を、消えた sheet から `vanished` を求める
- `projectFile` / `projectBatches`: 種別が metagraph の sheet で、導出 node を出し、それへの
  layout と edge を受け付けること

## なぜ

metagraph の graph node は op として積まず、**File の sheet の一覧から導出する**
(architecture step3 §3.2 D2)。名前と在否の正は sheet 側の 1 つだけになり、「全 metagraph に
op を積む」並行性の問題が構造上起きない。代わりに畳み込みは、`node.add` の無い node への
`node.setLayout` と、それを端点にする edge を受け付けなければならない。

**間違えても静かに違う答えを出す側**である (architecture §3.4)。名前が sheet と食い違う、
消えた sheet への edge が残る、といった壊れ方は画面を見ても気づきにくい。

## どのように

### 例

| テスト | 固定すること |
| --- | --- |
| id は決定的で、NodeId として有効 | 誰の手元でも同じ id。edge の端点の型を変えずに済む (U4 の決定) |
| 在る sheet は node、消えた sheet は vanished | `derivedNodesFor` の出力の形 |
| File の sheet が node として出る。metagraph 自身は出ない | metagraph はグラフの一覧を見せる view であって、一覧の中のグラフではない |
| ふつうの sheet には出ない | 種別が metagraph の sheet だけ |
| sheet.setName が content になる | 名前の正は sheet 側 |
| 🔴 導出 node への setContent / remove は効かない | edge を張っておく — remove が効くとカスケードで edge が消える。導出 node 自体は畳み込みの最後に足すので、node だけを見ても変化が見えない |
| 🔴 add の無い導出 node への layout と edge を受け付ける | D8 の本体 |
| 🔴 sheet が消えれば layout と edge も消え、作り直せば戻る | 畳み直しで戻る (sheet.create の add-wins) |
| 🔴 まだ作られていない sheet の導出 node への edge は live にしない | 性質テストが見つけた反例 (下) |
| ふつうの node と edge も置ける | 保存するのは graph node 以外の node/edge |

### 性質

「導出 node への op は sheet が在る限り受け付け、無ければ捨てる」を全称で書いた。履歴は
sheet の作成・削除・改名、導出 node への layout・edge・setContent・remove を任意の clock と
actor で並べたもの。畳んだ後に次の 3 つを確かめる:

1. 導出 node は、いま在る sheet (projection の sheet の一覧が正) とちょうど対応し、
   content は sheet の名前である
2. edge は、両端の sheet が在る ⇔ live
3. 導出 node の layout は、sheet が在り、位置を置いたことがある ⇔ live

生成器の判断:

- **sheet のプールは 3 つ**。作る・消す・作り直すが同じ sheet に重なり、「消えた後」
  「作り直した後」を引く
- **edge の id は操作ごとに別**にする。同じ id の付け替えは導出 node の問いではなく、
  畳み込みの LWW の問いだからである
- clock は 3〜12 の狭い範囲から引いて同値を出す (同じ clock は actor で順序が決まる)
- 導出 node への setContent / remove を混ぜる — 効かないことが命題 1 の一部である

**性質テストが反例を見つけた**: まだ作られていない sheet の導出 node への edge が live に
残っていた。導出 node の id は SheetId から一方向に作るので、届いていない sheet の導出 node は
見分けられない。受信の順が前後して edge が sheet より先に届くと起きる。metagraph では
**「端点が live な node である edge・layout だけを live にする」**規則に改めた
(ふつうの sheet の「孤児 layout は live に残す」は変えていない)。

変異で確かめたこと: 端点を問わないようにすると例 2 件と性質が、導出 node への
`node.remove` を効かせると例 1 件と性質が落ちる。

## テストしていないこと

- **metagraph 上の操作から op への翻訳** (graph node の追加 = `sheet.create` など) — UI の側で、
  後の Phase
- **配送順に依らないこと** — 畳み込みは全順序で並べ直すので、`project.test.ts` の既存の性質が
  担保する
