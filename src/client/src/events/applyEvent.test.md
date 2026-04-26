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
| NODES_UNGROUPED | 親削除・子ノード位置復元・parentId 解除 |
| NODES_PASTED | 既存選択解除・新規追加 |
| NODES_PASTED_UNDO | 指定 ID のノード/エッジ一括削除 |
| NODE_RELABELED | data.label 更新 |
| EDGE_RELABELED | label 更新 |
| NODE_PROPERTIES_CHANGED | 未実装のため無変更確認 |
| NODE_MOVED | position 更新 |
| NODE_RESIZED | style.width/height 更新 |
| EDGE_STYLE_CHANGED | data に style マージ・既存 data 保持 |
| NODE_STYLE_CHANGED | style にマージ・既存 style 保持 |
| EDGE_LABEL_MOVED | labelOffsetX/Y 更新 |
| round-trip | apply → invert → apply で元の状態に戻ること |
