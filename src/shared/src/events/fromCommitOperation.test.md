# fromCommitOperation.test.ts — CommitOperation エンコーダのテスト仕様

## 何を

`fromCommitOperation.ts` の `commitOperationToOps` / `commitOperationsToBatch` を検証する。

## なぜ

step1 §4 の眼目は「二重定義の解消」。既存の同期語彙 `CommitOperation` (6 種) が統一語彙の **部分集合**であることを保証できて初めて、統一が「第三の表現の追加」ではなく「収れん」になる。この部分集合性を固定する。

## どのように

- **展開**: 1 つの `node.update` (content + properties + parentId) が setContent / setProperties / setParent の 3 op に展開されることを確認する。CommitOperation の update は複数の意味的変更を含みうるため。
- **写像の単純性**: `edge.remove` が `edge.remove` op へ 1 対 1 で写ることを確認する。
- **導出の一致**: CommitOperation 列を Batch 化して projection すると、期待どおりのグラフ状態 (最終 content・edge label 等) が得られることを確認する。同期語彙が統一語彙の中で正しく振る舞う証拠。
