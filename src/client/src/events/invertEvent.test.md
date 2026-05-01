# invertEvent.test.ts — テスト仕様

## 何をテストするか

`invertEvent.ts` の `invertEvent(event)` 関数。
GraphEvent をその逆操作（undo用）に変換する。

## なぜテストするか

- undo 機能の正しさは invert → apply のラウンドトリップで保証される
- すべてのイベント型に逆操作が定義されている必要がある
- 二重反転対称性 `invertEvent(invertEvent(e)).type === e.type` が成立することは undo/redo スタックの健全性に直結する

## どのようにテストするか

| カテゴリ | テスト内容 |
|---------|-----------|
| NODE_ADDED ↔ NODE_DELETED | 相互変換・二重反転 |
| EDGE_ADDED ↔ EDGE_DELETED | 相互変換・data 保持 |
| EDGE_RECONNECTED | from/to 入れ替え |
| NODES_GROUPED ↔ NODES_UNGROUPED | 相互変換・children 保持 |
| NODE_REPARENTED | oldParentId ↔ newParentId / oldPosition ↔ newPosition の入れ替え |
| NODES_PASTED ↔ NODES_PASTED_UNDO | 相互変換・nodeIds/edgeIds 収集・redo 用 data 保持 |
| NODE_RELABELED / EDGE_RELABELED | from/to 入れ替え |
| NODE_MOVED / NODE_RESIZED | from/to 入れ替え |
| EDGE_STYLE_CHANGED / NODE_STYLE_CHANGED | from/to 入れ替え |
| EDGE_LABEL_MOVED | from/to 入れ替え |
| 二重反転対称性 | 全イベント型で type が保存されることの網羅テスト |
