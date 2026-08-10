# graphTransform.test.ts — テスト仕様

## 何をテストするか

`src/client/src/graphTransform.ts` の4つの純粋関数:

| 関数 | 責務 |
|---|---|
| `toFlowNodes` | GraphNode[] → React Flow Node[] |
| `toFlowEdges` | GraphEdge[] → React Flow Edge[] |
| `fromFlowNodes` | React Flow Node[] → GraphNode[] |
| `fromFlowEdges` | React Flow Edge[] → GraphEdge[] |
| `toFlowAndGhostNodes` | 生存ノード + 削除予定 (ghost) ノードの Node[] |

## なぜテストするか

- React Flow の内部型とアプリのデータモデルを相互変換する橋渡し層であり、変換ミスがグラフ表示やデータ保存の不整合に直結する
- 純粋関数なので副作用なしにテストでき、コストが低い割に効果が高い
- 特に `label` の型変換 (string 以外は undefined に落とす) はエッジケースを見落としやすい
- `toFlowAndGhostNodes` の ghost は「もう存在しないノード」なので、**そこを端点にエッジを
  引けてしまうと、存在しないノードを指すエッジ (孤児エッジ) が trunk へ載りうる** (ANA-121)。
  React Flow で接続を止めるのは `connectable` であって `selectable` ではないため、
  「見た目は操作できなさそうなのに実は繋げる」という取り違えが起きやすい

## どのようにテストするか

### 隔離

外部依存なし。`bun:test` のみ使用。

### ケース設計

| ケース | 観点 |
|---|---|
| 通常変換 | フィールドが正しくマッピングされる |
| 空配列入力 | 境界値 |
| label なし Edge | label が undefined になる |
| label が string でない | undefined にフォールバックする |
| label が undefined のノード | content が空文字になる |
| nodeType=group のノード | groupNode 型に変換される |
| nodeType=image のノード | imageNode 型に変換される |
| toFlowNodes → fromFlowNodes の往復 | 対称性 (データロスなし) |
| toFlowEdges → fromFlowEdges の往復 | 対称性 (label 保持) |
| imageNode 型の逆変換 | fromFlowNodes で nodeType=image が復元される |
| ghost ノードの `connectable` | `false` になる (エッジを引けない) |
| ghost ノードの `selectable` / `draggable` | `false` のまま (既存の振る舞いの回帰) |
| 通常ノードの `connectable` | `undefined` のまま — ghost の対策が生存ノードに漏れていない |
| ghost ノードの id / 位置 | `ghost-` 接頭辞が付き、位置は削除前のまま残る (ghost エッジの端点として要る) |
