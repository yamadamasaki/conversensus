# step2 Phase 5: template (toulmin) + node label

仕様: [template](../requirements/spec/template.md) /
関連: [propertyEditor](../requirements/spec/propertyEditor.md), [merging](../requirements/spec/merging.md)

## 1. なぜ Phase 3 T7 より先に来たか

順序を入れ替えた理由は語彙の共有ではない (**op を足すのにマイグレーションは要らない**ことが
Phase 3 で判明した)。**通知の実機観察**である。

T4 の競合通知と T8 の上書きの報告は、どちらも「**どれのことか**」を対象の名前で伝える。
その名前を引いているのは `labelsOfConflicts` で、**node については `content` の先頭**を
使っている — node が名前を持たないからである。markdown の本文が名前として出るので、
長い本文のノードは通知の中で識別できない。**通知は「どれのことか」が伝わらないと機能
しない**ので、node label はここに直接効く。

通知が 2 系列になった (T4 / T8) 分、効きは前より大きい。

## 2. コードを読んで判明した事実

計画の形を決めた 4 つ。仕様からは読めない。

### 事実 A: 「label」という語は、既に node の**本文**の意味で使われている

- `GraphEvent` の **`NODE_RELABELED` は `node.setContent` に写される** (`toUnified.ts`)。
  名前は「ラベルを変えた」だが、実体は本文の編集である
- React Flow のノード data も **`data.label` に本文が入っている** (`graphTransform.ts` が
  `n.content → data.label` に写す)

つまり**新しく label を足すと、既存の「label」と正面から衝突する**。
一方 **edge 側の `label` は正しい** — `edge.setLabel` は本当にラベルで、しかも
**template が言う「edge の種類」はまさにこの label である**。node だけが食い違っている。

### 事実 B: ドメイン模型は既に正しい

`ProjectedGraph` の node は `content` を持ち、`label` は持たない。**嘘は React Flow の
アダプタ層に閉じている** (`graphTransform.ts` が境界)。`data.label` を持つのは 7 ファイルで、
すべて client 内部である。**`GraphEvent` は永続化されない** (undo/redo 用) ので、
名前を直しても移行は要らない。

### 事実 C: `NodeTypeMenu` は既に別の軸で埋まっている

いまの「ノードの種類」は **markdown / グループ / 画像** — *見た目*の種類である
(`node.add` の `nodeType`)。template が言う「種類」は*意味*の種類 (主張 / データ / …) で、
**直交する 2 つの軸**である。同じ言葉が 2 つの意味を持つので、画面の文言を分ける必要がある。

### 事実 D: property editor (Phase 4) が無い

仕様は template 実行の一部として「プロパティの追加時に**名前を選択するメニュー**」を挙げるが、
**その menu を置く property editor がまだ無い**。したがって Phase 5 でできるのは
**template 側の宣言**までで、それを食う画面は Phase 4 が作る。

## 3. 決めたこと

### D1. 適用は作り込み — op 語彙を増やさない

toulmin template は**全 sheet に最初から適用されている**ものとして作り込む。
`sheet.setTemplate` のような op は足さない。

- 仕様が「最初は, 作り込まれた特定の template が最初から適用されていても良い」と
  明示的に許している
- Exit の「**通常の** sheet に toulmin を当てて種別が選べる」は、常に当たっていれば満たす
- 「sheet 作成時に適用する template を指定」は仕様が step3 送りにしている。**step3 が
  作り直すものを step2 で同期語彙にすると、移行が要る**
- ローカルの表示設定にする案は採らない。**同じ sheet を見ている二人で種別メニューの有無が
  食い違う** — 共同作業が主題の step2 では歪みが大きい

**同期する状態は label だけ**になる。

### D2. 語を直す — node の label は本当に label にする

**`node.setLabel` op を足し、既存の「label = 本文」の嘘を消す。**

| | いま | Phase 5 の後 |
| --- | --- | --- |
| node の本文 | `content` (模型) / `data.label` (React Flow) / `NODE_RELABELED` (event) | `content` に統一 |
| node の種別名 | 無い | `label` (`node.setLabel`) |
| edge の種別名 | `label` (`edge.setLabel`) | そのまま |

**edge に揃える**のが決め手である。template から見れば node の種別と edge の種別は同じ
概念で、edge 側は既に `label` という正しい名前を持っている。node だけ別の語 (`kind` /
`type`) にすると、**template を書くときに 2 つの語彙を行き来する**ことになる。

⚠️ **T0 の教訓を適用する。**「分かれた規則は放っておくと固定されるのではなく、既にずれる」。
label という語が 2 つの意味を持ったまま template を載せると、**どちらの意味で書かれた
コードかを読むたびに判断する**ことになる。直すなら足す前である。

### D3. 種別は作成時に選び、後からも変えられる

- `NodeTypeMenu` を **2 段**にする。「**見た目**」(markdown / グループ / 画像) と
  「**種別**」(主張 / データ / 論拠 / 反論 / 裏付け)。事実 C の 2 軸をそのまま画面に出す
- 加えて、**ノードを選んで後から種別を変える**口を作る

後から変える口は「あれば良い」ではなく**要る**。仕様が「既存のノードのラベルは空でよい」と
言う以上、**空のまま存在するノードに種別を与える道が無ければ、既存のグラフに template を
当てられない**。Exit の「通常の sheet に当てて」がまさにこれである。

### D4. 種別は content カテゴリに置く

`node.setLabel` は `OP_CATEGORY` の **content** にする (`edge.setLabel` と同じ)。

- **人が決めた意味**であって、位置でも構造でもない
- 二人が同じノードに別の種別を付けたら、それは**合意形成の機会**である。content の競合は
  DtR graph を起動する段なので、扱いとして正しい
- layout に置くと通知だけで流れ、structure に置くと削除依存の判定に混ざる

### D5. 接続の警告は拒否しない

仕様どおり **警告のみ**。`onConnect` は今までどおり `EDGE_ADDED` を出し、
**template に反する組み合わせだったことを後から知らせる**。

拒否しない理由は仕様の指定だけではない。**片方の端点の種別が空のとき**、その接続が
違反かどうかは決まらない。既存グラフに template を当てる途中では空が普通にあるので、
拒否は「まだ種別を付けていないから繋げない」を生む。

## 4. template の形

```
NodeKind = { id, label, description? }
EdgeKind = { id, label, from: NodeKindId[], to: NodeKindId[], properties: PropertyName[] }
Template = { id, name, nodeKinds: NodeKind[], edgeKinds: EdgeKind[] }
```

toulmin (仕様の例そのまま):

| node の種別 | |
| --- | --- |
| 主張 (Claim) / データ (Data) / 論拠 (Warrant) / 反論 (Rebuttal) / 裏付け (Backing) | |

| edge の種別 | から | へ |
| --- | --- | --- |
| 支える | データ | 主張 |
| 正当化する | 論拠 | 主張 |
| 強化する | 裏付け | 論拠 |
| 切り崩す | 反論 | 主張 |
| 疑問を呈する | 反論 | 論拠 |

**種別の同一性は `id` であって label ではない。**op に載るのは label (人が読む文字列) だが、
template の中で接続規則を書くときに label で照合すると、表示名を変えた瞬間に規則が
外れる。**op の値は label、template 内部の参照は id** に分ける。

> ⚠️ この分離には穴がある。op には label しか載らないので、**手で同じ文字列を書いたノードは
> 同じ種別になる**。step3 で template がユーザ定義になったとき、種別を id で持つか
> label で持つかは決め直しになる。**step2 では label 一本で足りる** (template が 1 つしか
> 無いので衝突しない)。→ 未決

**プロパティの定義は宣言だけ置く** (事実 D)。食うのは Phase 4 の property editor である。

## 5. スライス

| | 内容 | 検証 |
| --- | --- | --- |
| **P0** | **語を直す**。`data.label` → `data.content`、`NODE_RELABELED` → `NODE_CONTENT_CHANGED`。**振舞いは変えない** | 単体 (既存が全部緑のまま) |
| **P1** | `node.setLabel` op の追加 (schema / `OP_CATEGORY` = content / projection / `applicability` / cascade は無関係) | 単体 |
| **P2** | toulmin template を直書き (`shared/template/toulmin.ts`) と照合の述語 (`isConnectionAllowed`) | 単体 + 性質 |
| **P3** | node の種別を出す・選ぶ。`NodeTypeMenu` を 2 段 + 後から変える口 | 単体 |
| **P4** | edge の種別メニュー (`edge.setLabel` を自由入力から選択に) | 単体 |
| **P5** | 接続の警告 (拒否しない) | 単体 |
| **P6** | **通知の名前を label 優先にする** (`labelsOfConflicts`)。**Phase 5 を前倒した理由の回収** | 単体 |

**P0 が最初なのは順序の問題ではなく正しさの問題である** (T0 と同じ形)。label が 2 つの
意味を持ったまま P1 を入れると、`node.setLabel` と `data.label` が別のものを指す状態が
固定される。

**P6 は忘れやすいが、これが前倒しの理由そのものである。**ここまで来て通知の名前が
content のままなら、Phase 5 を先にやった意味が無い。

## 6. Exit

1. **通常の sheet** で、ノード作成時に toulmin の種別が選べる
2. **既に在るノード**に後から種別を与えられる (label が空のノードが出発点)
3. edge の種別が選べ、template に反する接続では**警告が出る** (繋がりはする)
4. **競合の通知と上書きの報告に、種別名が出る** (content の先頭ではなく)

1・2・4 は単体で測れる。3 は警告の出方を実機で見る。

## 7. 未決

- **種別の同一性を label に載せていること** (§4 の穴)。step3 で template がユーザ定義に
  なるとき、id で持つか label で持つかは決め直しになる
- **プロパティの定義を食う画面が無い** (事実 D)。Phase 4 の property editor が入るまで、
  `EdgeKind.properties` は宣言されているだけである
- **型チェックは行わない。**仕様が 1 点矛盾している (`template.md` は step2 に置き、
  `propertyEditor.md` は step3 送り) が、**propertyEditor 側を採る** — template の制約の
  仕組み一般が step3 送りである以上、その一部だけを step2 に置く理由が無い。
  **仕様側を直すべき論点である**
- **1 つの sheet に複数 template / 作成後の適用変更**はどちらも step3 (仕様の指定)
