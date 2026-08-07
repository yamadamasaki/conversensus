# step1 refinement ANA-107: グループ化の修正設計

> 対象: Linear ANA-107「グループ化の問題点」と、その sub-issue 5 件
> (ANA-108 / ANA-109 / ANA-110 / ANA-111 / ANA-112)。
> GitHub は #175。
>
> 位置づけ: step 0 の残課題である。step 0 では「グループ化」「バージョン管理」で修正を
> 繰り返し、interim report で「step1 に入る前に最初からやり直した方がいいのでは」と
> 判断する要因になった。本書は**個別の 5 件を潰す前に、なぜ繰り返したのかを構造として
> 特定し、直す単位を決める**ためのものである。

---

## 1. 結論

5 件の sub-issue は独立したバグではない。**2 つの構造的原因と、1 つの実装の二重化**に集約される。

| sub-issue | 症状 | 原因 |
|---|---|---|
| ANA-111 | グループ解除で中身が遠くに飛ぶ | **原因 A** |
| ANA-112 | 解除の undo でグループは戻るが中身が戻らない | **原因 A** |
| ANA-108 | 入れ子から上のレベルに出すと意図しない位置に飛ぶ | **原因 B** |
| ANA-109 | 入れ子グループに直接入れられない | **原因 B** |
| ANA-110 | グループ内のダブルクリックで種類選択が出ない | 実装の二重化 |

したがって修正も 5 件ではなく、**4 つのスライス** (§5) に分ける。

---

## 2. 診断

### 2.1 原因 A: 「グループ解除」という操作が存在しない

`NODES_UNGROUPED` イベント型は定義され、`applyEvent` / `invertEvent` / `toUnified` の
実装も揃っている。しかし**どこからも dispatch されていない**。
このイベントが生成される経路は `invertEvent(NODES_GROUPED)`、つまり
**グループ化の undo だけ**である。

一方で `../requirements/operation-manual-for-dev.md` §グループ解除 は
「グループを選択して delete キーを押すと、そのグループが削除される。
グループが削除されても、そのグループに含まれていたノードやエッジは削除されない」
と規定している。この経路は `handleDeleteKey` → `NODE_DELETED` であり、
その適用は `src/client/src/events/applyEvent.ts:24` —

```typescript
case 'NODE_DELETED':
  return {
    nodes: nodes.filter((n) => n.id !== event.nodeId),
    edges: edges.filter((e) => e.source !== event.nodeId && e.target !== event.nodeId),
  };
```

**子の `parentId` を一切触らない。** 結果、子は存在しない親を指す孤児になる。

React Flow は子の `position` を**親からの相対座標**として扱う (公式ドキュメント
"Sub Flows": *positioning them relative to their parent*)。親が消えたときの挙動は
ドキュメントに規定がない = **未定義動作**である。実測上は相対座標がそのまま
絶対座標として解釈され、元のグループの絶対位置ぶんだけずれて見える
(→ ANA-111。飛距離 = 解除したグループの絶対位置、という予測は §6 で実測確認する)。

undo は `NODE_ADDED` でグループ矩形を戻すだけで、子の位置も `parentId` も復元しない。
**そもそも「壊した」という記録がイベントに残っていない**ので復元しようがない (→ ANA-112)。

同じ穴が op-log 側にもある。`src/shared/src/events/project.ts:85` の `node.remove` は
接続エッジをカスケード削除するが、**子ノードの親は放置する**。
つまりローカル state とリモート projection の**両方で同じ孤児が生まれる**。
同期しても直らないし、他の端末でも同じ壊れ方をする。

### 2.2 原因 B: 親子座標系の扱いが場所ごとにバラバラ

**B-1. ドロップ先の探索が「配列で最初に一致したもの」を返す。**

`src/client/src/GraphEditor.tsx:514-535` (および `:461-466` のハイライト側) は

```typescript
allNodes.filter((n) => n.type === RF_GROUP_NODE_TYPE && ...).find((g) => pointInGroup(cx, cy, g))
```

`.find()` は**配列順の最初の一致**を返す。ここで React Flow は
「**親ノードは配列上で子より前になければならない**」ことを要求しており
(公式ドキュメント "Sub Flows": *Parent nodes must appear before their children in the
node array for correct processing*)、`applyEvent` の `NODES_GROUPED`
(`applyEvent.ts:113-122`) も親を子の直前に挿入してこれを守っている。

したがって**入れ子では外側グループが必ず内側より前に並ぶ**。内側に落としても
外側が選ばれる (→ ANA-109)。

重要なのは、**この配列順は React Flow の契約なので変えられない**という点である。
順序を入れ替えて直すことはできず、「どれが最も内側か」を明示的に計算するしかない。

**B-2. 絶対座標が親一段しか解決されていない。**

`GraphEditor.tsx:78` の `getAbsPos` は `node.positionAbsolute ?? node.position` を
返すだけである。呼び出し側 (`GraphEditor.tsx:488-496`) は

```typescript
const parentInStore = oldParentId ? allNodes.find((n) => n.id === oldParentId) : undefined;
const absX = parentInStore ? getAbsPos(parentInStore).x + node.position.x : getAbsPos(node).x;
```

と**親を一段だけ**補正している。コメント自身が「`positionAbsolute` は非同期更新のため
stale の可能性がある」と認めており、その前提が正しいなら、
**親の親の `positionAbsolute` も同じく stale でありうる**。一段の補正では
2 段以上の入れ子で絶対座標が誤る (→ ANA-108)。

**B-3. 変換の実装が 4 箇所に散っている。**

絶対座標⇄相対座標の変換は `useGroupNodes` (`:70-81`)、`GraphEditor`
(`:488-496`, `:542-547`)、`applyEvent`、`recalculateParentBounds`
(`graphTransform.ts:252-277`) にそれぞれ別実装で存在する。

**step 0 で修正を繰り返した構造的な理由はここだと見ている。** 1 箇所直しても
残り 3 箇所が同じ前提を共有していないので、別の症状として再発する。

### 2.3 ANA-110 は実装の二重化

「ノードを作る」経路が 2 つある。

| 起点 | 実装 | 挙動 |
|---|---|---|
| pane のダブルクリック | `usePaneDoubleClick` → `NodeTypeMenu` → `addNode` | 種類を選べる |
| グループ本体のダブルクリック | `GroupNode.tsx:58-90` `onBodyDoubleClick` | **メニューを出さず直接 `NODE_ADDED`**、`nodeType` 未指定 = markdown 固定 |

構造的な問題ではなく、単に同じ操作が別実装で 2 つあるだけである。経路を 1 本にすれば消える。

---

## 3. 前提の確認

設計を書く前に、突き合わせた対象と結果を残す。

| 突き合わせ先 | 内容 | 結果 |
|---|---|---|
| React Flow 公式ドキュメント | 親は配列上で子より前 | **制約として受け入れる**。B-1 を配列順で直す案は却下 |
| React Flow 公式ドキュメント | 子の position は親からの相対座標 | 原因 A の説明と整合 |
| React Flow 公式ドキュメント | 親が存在しない子の扱い | **規定なし (未定義動作)**。→ 孤児を作らないこと自体を不変条件にする (§4 D1) |
| operation-manual §グループ解除 | delete でグループのみ削除、中身は残る | **D2 で変更を提案する** (§4) |
| operation-manual §182-183 | グループ自動リサイズは [未完成] | **本書の非目標** (§7) |
| `collectCopyData` (`graphTransform.ts:282`) | グループの copy は子孫を再帰的に含む | delete も子孫込みが対称。D2 の論拠 |
| `extent: 'parent'` の使用 | コードベースに無し | 子はグループ外へドラッグできる。現仕様を維持 |

---

## 4. 設計方針

### D1: グループ解除を一級の操作にする

「delete で代用する」のをやめ、**Ungroup を明示的な操作**にする。

- 起点: グループを選択して `Cmd/Ctrl + Shift + G` (2026-08-07 決定)、および右上の
  「グループ解除」ボタン
- `NODES_UNGROUPED` を dispatch する。受け皿 (`applyEvent` / `invertEvent` / `toUnified`)
  は既に実装済みなので、**配線とペイロード構築だけ**が新規である

**ペイロードは解除時点の実状態から構築する。** ここが現状の隠れた不具合の要でもある。
現在 `invertEvent(NODES_GROUPED)` は**グループ化した時点の** `originalPosition` を
そのまま使い回している。グループ化した後にグループを動かしていると、
undo でも子は元の (古い) 絶対位置に飛ぶ。既存テスト
(`applyEvent.test.ts:215-259`) は親を `(0, 0)` に置いているためこの欠陥を検出できない。

解除時に構築すべき値:

| フィールド | 値 |
|---|---|
| `originalParentId` | 解除されるグループの**現在の** `parentId` (= 一段上のレベル。トップレベルなら `undefined`) |
| `originalPosition` | 子の現在の絶対座標 − 新しい親の絶対座標 (新しい親が無ければ絶対座標そのもの) |

`originalParentId` / `originalPosition` という名前は「グループ化前の状態」を意味しており、
独立した解除操作では意味がずれる。**`newParentId` / `newPosition` 相当の命名に見直す**
(型は `src/client/src/events/GraphEvent.ts:90-102`)。

**不変条件**: どのイベントを適用した後も、**存在しない親を指すノードが残ってはならない**。
これを `applyEvent` のテストで固定する。

### D2: delete の意味論を「グループと中身をまとめて削除」に変える 〔2026-08-07 決定〕

現マニュアルは「delete でグループのみ削除、中身は残る」だが、これを
**「グループを delete したら子孫も一緒に消える」に変更する**。

論拠:

1. **delete キーの意味が他のノードと揃う。** 「選択したものが消える」で一貫する
2. **copy と対称になる。** `collectCopyData` は既にグループ選択時に子孫を再帰的に含める。
   copy は子孫込み・delete は子孫を置き去り、という現状の非対称は説明しにくい
3. **「中身を残したい」は Ungroup してから delete で表現できる。** D1 で Ungroup が
   一級操作になるので、機能は失われない
4. delete 一つのキーに「解除」と「削除」の 2 つの意味を持たせるのをやめられる。
   ANA-111 / ANA-112 が「解除のバグ」なのか「削除のバグ」なのか判然としなかった
   のは、この曖昧さに由来する

`NODE_DELETED` をグループに対して発行するときは**子孫のカスケード削除**を含む必要がある。
`node.remove` (`project.ts:85`) も同様にカスケードさせ、
ローカルと op-log で同じ結果になるようにする。

これは現マニュアルからの**仕様変更**である。S3 では
`../requirements/operation-manual-for-dev.md` §グループ解除 の書き換えを成果物に含める
(「delete = グループと中身を削除」「グループ解除 = `Cmd/Ctrl + Shift + G` またはボタン」、
`[バグ]` 2 行の削除)。

検討した代替案 (不採用): 「delete = 中身を残す」を維持し、`NODE_DELETED`(group) を
**子の reparent を伴う複合イベント**に変更する (実質 Ungroup + グループノード削除の合成)。
ANA-111 / ANA-112 はこちらでも解けるが、delete 一つに 2 つの意味が残る点で採らない。

### D3: ドロップ先は「最も内側」を選ぶ

`.find()` (最初の一致) をやめ、一致した候補すべてから選ぶ。

- 第 1 基準: **深さが最大** (= 最も内側)。深さは `parentId` チェーンを辿って算出する
- 第 2 基準 (同深度の重なり): **面積が最小**
- 除外条件は自分自身と**自分の子孫** (子孫を親にすると親子関係が循環する)

  実装時に判明した訂正: 旧実装の `isAncestorOf(g.id, node.id)` は「候補が自分の
  **祖先**か」を見ており、循環の防止になっていなかった (グループを自分の子グループへ
  ドロップできてしまう) 上に、内側のグループから外側のグループへ移す正当な操作まで
  弾いていた。S2 では意図どおり子孫を除外し、祖先の除外はやめる。

- 親に留まるヒステリシス (ノード幅・高さの半分のバッファ) は、**どのグループにも
  入っていないときだけ**見る。旧実装は親の判定を先に行っていたため、外側グループの
  中で内側グループへドラッグしても外側のバッファ判定が先に成立し、内側に入れなかった

配列順に依存しないことが要点である (§2.2 B-1 のとおり配列順は React Flow の制約に
縛られていて使えない)。`onNodeDrag` のハイライト側と `onNodeDragStop` の確定側で
**同じ関数を使う**。現在は同じロジックが 2 箇所に複製されており、
ハイライトと実際のドロップ先がずれうる。

### D4: 座標変換を 1 モジュールに集約する

`src/client/src/graph/coords.ts` (新規) に以下を置き、**他の実装を全て置き換える**。

```typescript
export type NodeDepth = number;

// 祖先チェーンを再帰的に畳んで絶対座標を求める (positionAbsolute には依存しない)
export function absolutePositionOf(node: Node, nodes: Node[]): Position;

// 絶対座標を、指定した親から見た相対座標へ変換する (親が undefined なら絶対座標のまま)
export function toParentRelative(abs: Position, parentId: NodeId | undefined, nodes: Node[]): Position;

export function depthOf(node: Node, nodes: Node[]): NodeDepth;

// 点を含むグループのうち最も内側のものを返す (D3)
export function innermostGroupAt(
  point: Position, nodes: Node[], excludeIds: ReadonlySet<string>,
): Node | undefined;
```

`positionAbsolute` には依存しない。stale でありうる値 (§2.2 B-2) を信頼しないことで、
一段補正のような場当たりが不要になる。

置き換え対象: `GraphEditor.getAbsPos` / `getGroupBounds` / `pointInGroup` /
`isAncestorOf`、`useGroupNodes` の相対座標計算、`recalculateParentBounds`。

### D5: ノード生成経路を 1 本化する

`GroupNode.onBodyDoubleClick` が直接 `NODE_ADDED` を dispatch するのをやめ、
pane と同じ `NodeTypeMenu` を経由させる。

`usePaneDoubleClick` を「**生成先コンテナ** (pane または特定のグループ) を持つ」形に
一般化し、種類が選ばれた時点で `addNode(parentId, relativePosition, nodeType)` を呼ぶ。
座標の親相対への変換は D4 の `toParentRelative` を使う。

これによりマニュアル `:172` の「[未実装] 現状では markdown ノードしか作成できない」が
解消する。

---

## 5. 実装スライス

各スライスは独立に commit でき、それぞれの時点で lint / typecheck / test が通ること。

| # | 内容 | 解消する issue | 備考 |
|---|---|---|---|
| **S1** | D4: 座標モジュール新設 + 既存 4 箇所の置き換え | ANA-108 | **振る舞いを変えない**リファクタが主。単体テストで座標変換を固定してから置き換える |
| **S2** | D3: 最深一致のドロップ先解決、ハイライトと確定で共用 | ANA-109 | S1 の `innermostGroupAt` に依存 |
| **S3** | D1 + D2: Ungroup の一級操作化、delete を子孫カスケード削除に変更、op-log 側の整合 | ANA-111, ANA-112 | `GraphEvent` のフィールド名見直しと operation-manual の書き換えを含む |
| **S4** | D5: ノード生成経路の一本化 | ANA-110 | 他スライスから独立。先に入れてもよい |

S1 → S2 → S3 の順に依存する。S4 はいつでもよい。

## 6. 受入基準

### 共通

- `bun test` / lint / typecheck が通る
- 変更した各モジュールに `.test.ts` と `.test.md` が揃っている (プロジェクト規約)

### S1 (ANA-108)

- `absolutePositionOf` が 3 段以上の入れ子で正しい絶対座標を返す単体テスト
- `positionAbsolute` が欠落している / 古い値を持つノードでも結果が変わらないテスト
- 手動: 2 段の入れ子から中のノードを最上位へドラッグして出し、**掴んだ位置に留まる**

### S2 (ANA-109)

- `innermostGroupAt` が入れ子で内側を返す単体テスト (外側が配列で先に来る配置で)
- 同深度で重なる 2 グループでは面積が小さい方を返すテスト
- 自分自身・自分の子孫は候補から除外されるテスト
- 手動: 内側グループにドラッグして落とすと**内側の子になる**。ハイライトされた
  グループと実際に入るグループが一致する

### S3 (ANA-111, ANA-112)

- **不変条件テスト**: 任意のイベント適用後、存在しない親を指すノードが残らない
- グループの delete で子孫が再帰的に消え、undo で子孫とその位置・`parentId` が戻る
- `operation-manual-for-dev.md` §グループ解除 が新しい仕様に更新されている
- Ungroup: **グループ化した後にグループを移動してから**解除しても、子が
  画面上の同じ位置に留まる (既存テストが親 `(0,0)` で見逃していた条件を明示的に張る)
- Ungroup → undo → redo で、子の `parentId` と位置が往復して一致する
- `projectBatches` (op-log) 経由の結果が `applyEvent` 経由の結果と一致する
  (ローカルとリモートで壊れ方が違わないこと)
- 手動: 実測で §2.1 の予測「飛距離 = 解除したグループの絶対位置」を確認してから直す

### S4 (ANA-110)

- グループ本体のダブルクリックで `NodeTypeMenu` が出るテスト
- 選んだ種類のノードが、**そのグループの子として**、ダブルクリックした位置に作られるテスト
- 手動: グループ内で image ノードを作れる

## 7. 非目標

本書では扱わない。混同しないよう明記する。

- **グループの自動リサイズの仕様確定** — `recalculateParentBounds` の挙動と、
  マニュアル `:180-183` の「[未判断] これでいいのか?」「[未完成] いったんグループの
  大きさを変更するとこの機能はオフになる」。S1 で座標モジュールを使うよう置き換えるが、
  **仕様は現状のまま**とする
- **`extent: 'parent'` の導入** — 子をグループ外へドラッグできる現仕様を維持する
- **グループのバージョン管理・差分表示** — ANA-119 側の課題
- **グループの copy/paste** — 現状で子孫を含めて動作しており、報告も無い

## 8. 未決事項

なし。§4 の D1〜D5 をもって実装に入れる。

## 9. 決定記録

- 2026-08-07: 本書作成。5 件の sub-issue を 2 つの構造的原因 + 1 つの二重化に整理し、
  4 スライスに分割した。React Flow の「親は配列上で子より前」制約を確認し、
  B-1 を配列順で直す案を却下した。
- 2026-08-07: **D2 を「グループの delete は子孫ごと削除」に決定**。マニュアルの
  仕様変更を伴う。「中身を残す」は Ungroup → delete の合成で表現する。
- 2026-08-07: **Ungroup のキーバインドを `Cmd/Ctrl + Shift + G` に決定** (ボタンも併設)。
