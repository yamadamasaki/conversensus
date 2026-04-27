# collections.test.ts — テスト仕様

## 何をテストするか

`collections.ts` の rkey (Record Key) 操作ユーティリティ関数:

- `makeRkey(prefix, id)` — prefix と id から `prefix_id` 形式の rkey を生成
- `idFromRkey(rkey)` — rkey から id 部分を抽出
- `prefixFromRkey(rkey)` — rkey から prefix 部分を抽出

## なぜテストするか

- rkey フォーマットのバグは PDS レコードの読み書き全体に波及する
- `idFromRkey` / `prefixFromRkey` は旧形式 (prefix なし) の後方互換ロジックを持つ
- シンプルだがクリティカルな関数のため、テストで仕様を明確化する価値がある

## どのようにテストするか

| カテゴリ | テスト内容 |
|---------|-----------|
| makeRkey | trunk/branch prefix での rkey 生成 |
| idFromRkey | 通常形式・旧形式・複数アンダースコアの抽出 |
| prefixFromRkey | 通常形式・旧形式・複数アンダースコアの抽出 |
| 往復変換 | makeRkey → idFromRkey / prefixFromRkey が元の値を復元すること |
