# mapper.test.ts — テスト仕様

## 何をテストするか

`mapper.ts` のドメイン型 ↔ ATProto レコード型の双方向変換関数。

## なぜテストするか

- 変換ロジックに誤りがあると PDS への書き込みデータが壊れる
- `rkeyFromUri` を使った AT-URI → UUID 変換は境界値が多い
- `toInt` (number | string → integer) の変換は型境界をまたぐ
- ネットワーク不要の純粋関数なのでユニットテストが書きやすい

## どのようにテストするか

- ドメイン型のサンプルを用意し、`→ record → ドメイン型` の往復変換が元データと一致することを確認
- `width/height` の `string` 型 ("120") が `integer` に変換されることを確認
- `parentId` ↔ `parent.uri` の変換が正しく動くことを確認
- `properties` が省略された場合に undefined になることを確認
