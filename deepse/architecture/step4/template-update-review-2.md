# template-update.md のレビュー (第二回目)

> [template-update-response-1.md](./template-update-response-1.md) への返答。レビュアー: Claude (2026-11-23)。
> 番号は第一回目 ([template-update-review-1.md](./template-update-review-1.md)) の R1〜R15 に揃えた。
> 決着したものは「合意」として要約だけ置き、問いへの答えと、まだ決める必要のあるもの (**決定待ち**) を中心に書く。

## 合意したもの

| 番号 | 合意の内容 |
| --- | --- |
| R2 | template graph は branch を切れないまま、`at` (trunk の切断面) を版とする。新しい版があることを通知する |
| R4 | 再適用は「`at` を進める」ことに寄せる。読むときに導けるものは op を書かない |
| R7 | template 中で label が重複したら、その種類は両方とも無効にし、template graph の画面で警告する |
| R9 | 案 A: 種類の node/edge に付随 property (`app.conversensus.propertySchema.<key>` など) を置き、`{ type, editable }` を書く。型の検証は読み取り側でも行う |
| R10 | `NodeKind` に nodeType を持たせる (#406・#412) |
| R11 | 既定値は写さず、読むときに補う |
| R12 | content は写さず、適用先の content が空のとき template の content を placeholder として薄く見せる (#411) |
| R13 | group による範囲付けはしない。template 中で group の中に書くのは (緩い) ガイドラインであり、システムは気にしない。ユーザ向けガイドに書く |

## 問いへの答え

### R1: 「両方にあれば作るときのものが勝つ」

その通りである。後から当てる入口 (`applicableTemplateGraphs`) は、既に当たっている template を候補から除いている。したがって、両方に同じ template が載るのは、2 人が同時に当てた場合だけである。

### R5: 「作る」とは何を作るときか

**sheet の作成**のことである (node ではない)。

- sheet を作るときに選んだ template は `sheet.create` の op の `templateIds` に載る。op なので後から書き換えられない
- 作った後に当てた template (#355) は、sheet の property `app.conversensus.appliedTemplate.<id>` に `{ at }` として載る

どちらの `at` も進められるようにしたい (R5 の趣旨)。案は次の通り。

- **pull は常に property に書く。**作成時に当てた template を pull するときも、同じ名前の property に新しい `at` を書く
- **読むときは property が `sheet.create` より勝つ。**R1 の優先規則を逆にする。同時に当てた場合 (R1) も、property の方を採れば困らない

後から当てた template を外す件:

- 外す仕組みは既にある。property を消せば外れる形になっている (`template/applied.ts` の注釈)。**無いのは UI の入口だけ**である
- 外した後も、node には種別 property (`template.<id>.kind`) が残る。しかし読むときにはどの template にも解決されないので、普通の node として振る舞う (R4 の「関連だけなくす」と同じ)
- 作成時の template を外せないのは、op の作りの制約ではない。property に「外した」印を書けば外せる。ただ、捨てられないとする方針でよければ、その印は作らない

### R6: 見落としていると思われるケース

- **nodeType の変更**: 了解。template graph の node の見た目を変える手段が無いなら、R10 の後も「種類を消して別の種類を足す」と同じになる。項目として不要
- **edge の種類の端の変更**: template-update.md の 142 行目 (edge の source/target) と同じことだった。重複なので取り下げる
- **template graph そのものの削除**: 今の実装では、適用先は template を `at` の切断面で読む。その時点では template graph の sheet がまだあるので、**削除した後も、適用先は止めた版の template のまま動く**。新しく当てる候補には出ない。pull では trunk に sheet が無いので進める先が無い。通知は「この template は削除された」と出すのがよい
- **branch で `at` を進めてから merge したとき**: 強制的に trunk の先端を当てる必要は無いと考える。2 つの `at` は**同じ template graph の trunk の切断面**なので、要素ごとに大きい方を採る (join) ことができる。その結果もまた trunk の切断面である。property の merge のときに、この 1 キーだけ join で解けばよい。通知は sheet に (trunk/branch を問わず) 出す
- **複数の template のうち一つだけを pull する場合**: A と B を当てた sheet で、A だけを新しい版にする、という意味だった。template ごとに property のキーが分かれているので、自然にできる。問題にならないので取り下げる

## 決定待ち

### R3: ユニオン・リテラルと optional — 大変ではない

型は、定義するとき (template graph の `propertySchema`) に文字列で書く。小さな文法と、型で値を検証する関数があれば足りる。

```
string | number | boolean | date | datetime    基本の型
T[]                                            配列
'高' | '中' | '低'                              リテラルのユニオン (列挙)
T?                                             optional (無くてもよい)
```

- 値からの推論はしないので、パーサと検証器だけで済む。規模は小さい
- **ユニオンは、まずリテラルのユニオン (列挙) に限る**ことを提案する。`string | number` のような型のユニオンは、編集 UI (どちらの入力欄を出すか) が重い割に使い道が少ない
- **optional の意味**: `?` が無い property は必須である。値が無ければ、読むときに「欠けている」と警告する。ただし R11 (既定値を読むときに補う) により、既定値のある必須 property は常に満たされる。既定値の無い必須 property だけが警告の対象になる

**決めること**: ユニオンをリテラルに限ってよいか。

### R8: template が配る property の名前と、editable: false の意味

prefix を付ける件、了解した。名前の衝突を避けるにはそれが正しい。具体的には次の形を提案する。

- **template graph の側では prefix 無しで書く** (`期限`)。適用先での名前は `${templateId}.期限` とシステムが導く (種別 property `${templateId}.kind` と同じ規則)
  - 利用者が作った template の id は `template.<sheet の id>` (uuid を含む) なので、手で書かせるのは無理がある
  - 表示は prefix を外し、template の名前を添える (「期限 (Toulmin model)」など)

「管理レベル」(system / 拡張 / 任意のユーザ) の件。

- **template は「拡張」の枠に入る**と考える。拡張機能 (plugin) と違い、実行コードを持たない
- すると、template の property の editable: false は「**値は常に template の既定値**」という意味になる。誰も個別に変えられず、R11 の「読むときに補う」がそのまま定数として働く。種類ごとの定数 (例: `重み` = 1.0) が書ける
- **効かせる場所の限界**: op には書いた actor しか載らず、「どのコード (system / plugin / UI) が書いたか」は載らない。したがって管理レベルは、**書き込みの入口** (UI・MCP の道具・module の API) で守るしかない。op-log の畳み込みで弾くのは、template の editable: false (= 既定値しか読まない) だけである。今の system property (「system の property は書き換えられません」) も同じ守り方をしている

**決めること**: template の editable: false を「値は常に template の既定値」とする解釈でよいか。

### R14: 慣習の label で「一見して分かる」案 — 副作用が一つある

「一見して分かる」ことを優先する判断に賛成する。ただ、今の規則のままだと次の副作用が出る。

- 種類 `claim` からラベルなし node (URI) へ `external` の edge を引くと、edge の種類「claim → 任意の node」ができる
- 適用先で `claim` を普通の node へ繋ぐと、候補が `external` 一つなので、**自動で `external` という label が付く** (`edgeKindFor`: 候補がちょうど 1 つなら自動)

これは接地に限った話ではない。片端が「任意」の edge の種類を一つでも定義すると、いつでも起きる。そこで規則を一つ足すことを提案する。

- **片端が「任意」の edge の種類は自動では付けない。**候補として選ばせ、その中に「種類なし」を含める
- 両端が種類を持つ edge (template の制約の内側) は今のまま、候補が 1 つなら自動で付ける

こうすれば、`external` や `import` を慣習として使っても、適用先の自由な接続を邪魔しない。また、「引けるが引かなくてもよい」という返答の趣旨とも合う。

**決めること**: この規則を足してよいか。

## 次に進める形

決定待ちの 3 件 (R3・R8・R14) が決まれば、第一回目の R15 の段に沿って計画 (`deepse/plans/`) を書ける。R13 で group の範囲付けをやめたので、段は 2 つになる。

1. **静的な仕様の補強**
   - `NodeKind` に nodeType を持たせる (R10、#406・#412)
   - `propertySchema` で型と editable を宣言し、読み取り側で検証する (R3・R8・R9)
   - 既定値と content を、写さずに読むときに補う (R11・R12、#411)
   - label の重複を無効にして警告する (R7)
   - 片端が「任意」の edge の種類を自動で付けない (R14)
   - group の書き方のガイドをユーザ向けガイドに書く (R13)
2. **動的適用**
   - pull を property に書き、property が `sheet.create` より勝つようにする (R5)
   - `at` を join で merge する (R6)
   - 新しい版と、template graph の削除を通知する (R2・R6)
   - 後から当てた template を外す入口を作る (R5)

R11 (既定値を補う) は、1 で写すのをやめた時点で、既に写した既存の node をどう扱うかの問題が出る。既存の値は、利用者が書いた値と区別できない。そのまま残すのが無難だと考えるが、計画を書くときに確かめる。
