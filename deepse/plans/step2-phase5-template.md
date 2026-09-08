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

> ⚠️ **ただし label だけでは「どれか」は決まらない** (2026-09-08 のレビュー)。label は
> オブジェクト指向のクラス名のような位置づけで、**一つの対話グラフに「反論」は複数ある**
> (人はノードを区別するために「反論 1」とは書かない)。したがって Phase 5 が通知にもたらすのは
> **絞り込み**であって**特定**ではない。「通知から実物のノードを指す」(参照を popover すると
> グラフ中の対応ノードが光る、など) は **step3** である。→ §7

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

### D1. 紐づけは sheet 作成時に持つ — 複数 template を前提に、変更は step3

**`sheet.create` に `templateIds?: TemplateId[]` を足す。**作成後に変える口は作らない。

> **当初は「全 sheet に作り込みで適用済」としていたが、レビューで却下された (2026-09-08)。**
> **toulmin を当てるのは DtR の dialogue graph だけである。**全 sheet に当てると、
> 普通のグラフを編集している人にも「主張 / データ / 論拠」のメニューが出る。意味的に誤りで、
> しかも共同作業では相手の画面にも出る。

- **仕様に一致する。**「sheet を (作成時ではなく) 作成後/変更後に template を追加/削除
  できるか (とりあえず不可)」。作成時だけなら**「後から変える」語彙を作らずに済む**
- **step3 への道が塞がらない。**変更を許すのは step3 の仕事で、そのとき必要な op を
  その時点で足せばよい。いま `sheet.setTemplate` を作ると、**外したときに既存ノードの
  種別をどう扱うか**を step2 で決めることになる (答える材料がまだ無い)
- **Phase 6 への依存は生まれない。**Phase 6 は dialogue graph を作るときに `templateIds` を
  渡すだけである。Phase 5 は「toulmin を当てた sheet を作れば種別が選べる」ところまでで測る
- ローカルの表示設定にする案は採らない。**同じ sheet を見ている二人で種別メニューの有無が
  食い違う** — 共同作業が主題の step2 では歪みが大きい

**複数を前提にする** (2026-09-08 のレビュー)。**当面は 1 つしか当てないが、器は複数で持つ。**
単数で作ると、複数にするときに op の形が変わって移行が要る。畳み方は §4 に書く。

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
- **template が当たっていない sheet では、種別の段を出さない** (D1)。2 段目が空になる
  のではなく、段そのものが無い

後から変える口は「あれば良い」ではなく**要る**。仕様が「既存のノードのラベルは空でよい」と
言う以上、**空のまま存在するノードに種別を与える道が無ければ、template を当てた sheet に
既存のノードを持ち込めない** (Phase 6 が dialogue graph を作るときにも通る道である)。

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

> **「同じ label のノードが複数ある」のは異常ではない** (2026-09-08 のレビュー)。label は
> **クラス名**の位置づけなので、一つの対話グラフに「反論」が 5 つあるのが普通である。
> したがって **label は種別を決めるが、ノードは決めない**。当初「手で同じ文字列を書いた
> ノードが同じ種別になる」を穴として挙げていたが、**それは穴ではなく仕様どおり**である。
>
> 残る本当の穴は逆向きで、**template 側で種別名を変えると、既存ノードが孤児になる**
> (op に載った古い label はどの `NodeKind` にも対応しなくなる)。→ §7

### 複数 template の畳み方

`templateIds` は複数を許す。**当面は 1 つしか当てないが、畳み方は先に決めておく** —
後から決めると、1 つのときだけ通る実装が固定される。

- **種別の一覧は和である。**適用された template の `nodeKinds` / `edgeKinds` をすべて並べる。
  template は語彙を**足す**ものであって、狭めるものではない
- **接続の警告も和である。**「**どの template の規則にも合わない**」ときだけ警告する。
  片方が許していれば警告しない
- **label の衝突は step3。**2 つの template が同じ label の種別を定義したら、いまの
  「label で種別を決める」形は破れる。1 つしか当てない間は起こらない。→ §7

**プロパティの定義は宣言だけ置く** (事実 D)。食うのは Phase 4 の property editor である。

## 5. スライス

| | 内容 | 検証 |
| --- | --- | --- |
| **P0** | **語を直す**。`data.label` → `data.content`、`NODE_RELABELED` → `NODE_CONTENT_CHANGED`。**振舞いは変えない** | 単体 (既存が全部緑のまま) |
| **P1** | `node.setLabel` op の追加 (schema / `OP_CATEGORY` = content / projection)。`applicability` と cascade は無関係 | 単体 |
| **P2** | template の型と toulmin の直書き (`shared/template/`) + 畳み方 (`kindsOf` / `isConnectionAllowed`) | 単体 + 性質 |
| **P3** | **紐づけ**。`sheet.create` に `templateIds` + シート作成時に選ぶ | 単体 |
| **P4** | node の種別を出す・選ぶ。`NodeTypeMenu` を 2 段 + 後から変える口 | 単体 |
| **P5** | edge の種別メニュー (`edge.setLabel` を自由入力から選択に) | 単体 |
| **P6** | 接続の警告 (拒否しない) | 単体 + 実機 |
| **P7** | **通知の名前に種別を足す** (`labelsOfConflicts`)。**Phase 5 を前倒した理由の回収** | 単体 |

**P0 が最初なのは順序の問題ではなく正しさの問題である** (T0 と同じ形)。label が 2 つの
意味を持ったまま P1 を入れると、`node.setLabel` と `data.label` が別のものを指す状態が
固定される。

**P3 が P4/P5 より前**なのは、メニューが「この sheet に当たっている template」を訊く先を
必要とするからである。先に UI を作ると、その問い合わせ先が「常に toulmin」に固定される。

**P7 は忘れやすいが、これが前倒しの理由そのものである。**出す形は
**「種別名 + 本文の先頭」** (`反論: 気温の記録は…`) にする。**種別名だけでは足りない** —
「反論」は複数あるので絞り込みにしかならない (§1 の ⚠️)。本文だけの現状より狭まる、
というのが Phase 5 の効きの正確な大きさである。

## 6. Exit

1. **toulmin を当てた sheet を作る**と、ノード作成時にその種別が選べる
2. **template を当てていない sheet では種別メニューが出ない** (普通のグラフを侵さない)
3. **既に在るノード**に後から種別を与えられる (label が空のノードが出発点)
4. edge の種別が選べ、template に反する接続では**警告が出る** (繋がりはする)
5. **競合の通知と上書きの報告に、種別名が本文と並んで出る**

1・2・3・5 は単体で測れる。4 は警告の出方を実機で見る。

**Phase 6 に依存しない。**dialogue graph が無くても、template を当てた sheet を作れば
全部測れる。Phase 6 は同じ紐づけに toulmin を渡すだけである。

## 7. 未決

- **⚠️ 通知から実物のノードを指せない。**label はクラス名なので「反論」は複数あり、
  **絞り込みはできても特定はできない** (§1)。参照を popover するとグラフ中の対応ノードが
  光る、といった仕組みが要る。**step3**
- **template 側で種別名を変えると、既存ノードが孤児になる。**op に載るのは label なので、
  `NodeKind.label` を変えると古い label がどの種別にも対応しなくなる。template が
  ユーザ定義になる step3 で、種別を id で持つか label で持つかごと決め直す
- **2 つの template が同じ label の種別を定義したときの扱い** (§4)。1 つしか当てない間は
  起こらない。step3
- **プロパティの定義を食う画面が無い** (事実 D)。Phase 4 の property editor が入るまで、
  `EdgeKind.properties` は宣言されているだけである
- **型チェックは行わない。**仕様が 1 点矛盾している (`template.md` は step2 に置き、
  `propertyEditor.md` は step3 送り) が、**propertyEditor 側を採る** — template の制約の
  仕組み一般が step3 送りである以上、その一部だけを step2 に置く理由が無い。
  **仕様側を直すべき論点である**
- **作成後の適用変更**は step3 (仕様の指定)。**外したときに既存ノードの種別をどう扱うか**を
  そこで決める。器は複数 template を前提に作ってあるので、増やす側は形を変えずに済む
