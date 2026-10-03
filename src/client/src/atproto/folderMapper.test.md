# folderMapper.test.ts — Folder と File の置き場のマッピングのテスト仕様

## 何を

`Folder` / `FilePlacement` と PDS レコードの相互変換を検証する (step3 Phase 6 S6-0)。

## なぜ

- **同一性は rkey にだけ持つ。**PDS の後勝ちは rkey の単位で起きるので、Folder の id と
  置き場の fileId は rkey が権威である。本文にも持つと、食い違ったときにどちらが正かという
  問いが生まれる。往復で id が rkey から戻ることを見る
- **トップ・レベルは「parent が無い」で表す。**`parent: undefined` のキーを送らない
  (lexicon の optional と同じ意味にする)
- 他の端末が書いたレコードを読むので、境界で検証して壊れたものを落とす

## どのように

- **Folder の往復は性質で書く**: 任意の Folder (parent はあったり無かったり、名前は任意の
  1 文字以上、日時は ISO 8601) を `(id, 本文)` に割って戻すと元に戻る。
  生成器は `requiredKeys` で parent を省くことがあるので、トップ・レベルも引く
- トップ・レベルの本文に `parent` のキーが無い (例)
- 壊れたレコードは `null`: rkey が UUID でない・名前が空・parent が UUID でない・createdAt が無い
- 置き場は値が 1 つなので例で書く: 往復、rkey / Folder が UUID でなければ `null`
