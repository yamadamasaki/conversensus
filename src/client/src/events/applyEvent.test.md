# applyEvent.test.ts — テスト仕様

## 何をテストするか

`applyEvent.ts` の `applyEvent(event, nodes, edges)` 関数。
GraphEvent を React Flow のノード/エッジ配列に適用した結果を返す。

## なぜテストするか

- undo/redo の中核であり、誤ったイベント適用はグラフ状態の破壊につながる
- structure/content/layout/presentation の4カテゴリにまたがる多様なイベント型が存在する
- 純粋関数なのでテストが容易

## どのようにテストするか

| カテゴリ | テスト内容 |
|---------|-----------|
| NODE_ADDED | ノード追加・座標反映・エッジ非影響 |
| NODE_DELETED | ノード削除・接続エッジ同時削除・無関係エッジ維持 |
| EDGE_ADDED | エッジ追加・markerEnd 自動付与 |
| EDGE_DELETED | エッジ削除・ノード非影響 |
| EDGE_RECONNECTED | source/target 変更・labelOffset リセット |
| NODES_GROUPED | 親ノード挿入・子ノード parentId/position 更新 |
| NODES_UNGROUPED | 親削除・子ノード位置復元・parentId 解除・**孤児を残さない不変条件** |
| NODE_REPARENTED | グループへの追加・グループからの離脱・グループ間移動と配列順序保証 |
| NODES_DELETED | 選択ノードと子孫・巻き込むエッジの一括削除 |
| NODES_RESTORED | 削除したノード/エッジの復元 (undo で親子関係と位置が戻る) |
| NODES_PASTED | 既存選択解除・新規追加 |
| NODES_PASTED_UNDO | 指定 ID のノード/エッジ一括削除 |
| NODE_RELABELED | data.label 更新 |
| EDGE_RELABELED | label 更新 |
| NODE_PROPERTIES_CHANGED | data.properties を `to` で**置き換える** (併合しない)。`to` が空ならすべて消える |
| NODE_MOVED | position 更新 |
| NODE_RESIZED | style.width/height 更新 |
| EDGE_STYLE_CHANGED | data に style マージ・既存 data 保持 |
| NODE_STYLE_CHANGED | style にマージ・既存 style 保持 |
| EDGE_LABEL_MOVED | labelOffsetX/Y 更新 |
| round-trip | apply → invert → apply で元の状態に戻ること |

## 不変条件: 孤児を残さない (ANA-107 S3)

`NODES_UNGROUPED` は「存在しなくなった親を指すノードを残さない」ことを追加で検証する。
React Flow は親が居ない子の相対座標の扱いを規定していない (未定義動作) ため、
孤児は「中身が別の場所に飛ぶ」形で表面化する — ANA-111 / ANA-112 の原因である。

イベントの `children` に載っている子だけを直す実装では、**載っていない子**が
孤児になる。リモートから届いたイベントや、イベント生成後に増えた子がこれに当たる。
そこで `applyEvent` 側でも、消えるグループを指したままのノードをグループの位置ぶん
ずらして一段上へ移す。テストは「適用後、全ノードの `parentId` が実在する」ことを
直接主張しており、実装の手順ではなく結果を固定している。

解除 → undo → redo の往復も見る。グループの位置を `(0,0)` にしないのは、
相対座標と絶対座標を取り違える実装が `(0,0)` では両者一致ですり抜けるためである
(既存テストが見逃していた条件)。

グループ化 → 解除の座標が正しいこと自体は `graph/grouping.test.ts` が担当する
(こちらはイベントの組み立て側)。

## 一括削除と復元 (ANA-107 S3b)

`NODES_DELETED` / `NODES_RESTORED` は「選択したノードとその子孫をまとめて消す /
戻す」対。1 ノード 1 イベントにしていないのは undo のためである。グループと子を
別々のイベントで消すと、undo の途中で**親がまだ復元されていないのに子だけ居る**
状態が現れる。React Flow はその状態の相対座標を規定していない (未定義動作)。

テストは削除そのものより **undo の結果** に重きを置いている。子の `parentId` と
`position`、グループ自身の位置、巻き込んだエッジが 1 回の undo で戻ること、そして
復元後も「全ノードの `parentId` が実在する」不変条件が成り立つことを見る。

適用側は `NODES_PASTED` / `NODES_PASTED_UNDO` と同じ分岐を共有している
(「まとめて足す / まとめて消す」という操作が同じであるため)。
何を消すかを決めるのは `graph/deletion.ts` で、そちらでテストする。
