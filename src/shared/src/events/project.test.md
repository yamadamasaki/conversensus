# project.test.ts — projection のテスト仕様

## 何を

`project.ts` の `projectBatches` (統一イベント → グラフ状態の fold) と `toSheet` を検証する。

## なぜ

projection は step1 §4 の「集約は projection (導出ビュー)」を実現する要。エディタ・エクスポート・拡張エンジンがすべてこの導出結果を読むため、畳み込みの意味論 (LWW・カスケード削除・layout の部分更新) を正確に固定する必要がある。

## どのように

- **状態構築**: node.add / edge.add から nodes / edges マップが構築されることを確認する。
- **LWW (投入順非依存)**: 同一ノードへの content 変更を、投入順を入れ替えて渡しても clock 昇順で解決され、clock 最大が勝つことを確認する。決定論的なマージの土台。
- **カスケード削除**: node.remove が接続エッジも削除する (現行 `applyEvent` の NODE_DELETED と同じ挙動) ことを確認する。
- **layout の部分更新**: 移動 (x/y) と リサイズ (width/height) を別々の setLayout で与えても合成されることを確認する。滑らかな移動・リサイズを独立イベントとして扱うため。
- **presentation の分離**: presentation op (edge.setStyle 等) は presentation マップに入り、意味的な状態 (edges の properties 等) に影響しないことを確認する (D7: presentation はローカル限定)。
- **toSheet**: projection が既存の `Sheet` 形式へ変換されることを確認する (現行資産との接続点)。
