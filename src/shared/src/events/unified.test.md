# unified.test.ts — 統一イベント語彙のテスト仕様

## 何を

`unified.ts` が定義する統一イベント語彙 (Op / Batch / カテゴリ分類 / Lamport clock) の不変条件を検証する。

## なぜ

統一語彙は step1 の正典データモデル (D4) の中核であり、同期対象の振り分け (D7) と undo/redo の単位 (バッチ) を規定する。ここが崩れると projection・マージ・同期すべてが破綻するため、語彙の健全性を単体で固定する。

## どのように

- **OP_CATEGORY 網羅性**: `OpSchema` の全 kind に対しカテゴリが 1 対 1 で定義されていることを検証する。op を追加してカテゴリ付けを忘れると失敗する「番人」テスト。file 構造 op 7 種を追加した後もこの網羅性が保たれる (critic M2-new)。
- **同期対象の振り分け (D7)**: `isSyncable` が presentation のみ false、structure/content/layout/file は true を返すことを確認する。file カテゴリ (シート/ファイル構造) が同期対象であることを固定する (§3.2)。
- **isFileOp**: `FILE_OP_KINDS` の op のみ file と判定し、グラフ内容 op は false を返すことを確認する。projection の content/構造 routing (`projectBatches` は file op を無視、`projectFile` が畳み込む) が正しく分岐する前提。あわせて `FILE_OP_KINDS` が `OP_CATEGORY` で漏れなく `file` に揃っていることを確認する。
- **LamportClock**: `tick` の単調増加と、`observe` がリモート時刻に `max + 1` で追随することを確認する (並行編集の順序付けの基礎)。さらに `seed` は下限を取り込むが `observe` と違い `+1` しない (次の `tick` が `floor+1`)・現在値より小さい `floor` は無視することを確認する (再起動後に永続ログの max(clock) から発番を再開する復元用)。
- **BatchSchema**: 空 ops の Batch を拒否し、妥当な Batch を受理する (バッチは必ず 1 つ以上の op を持つ)。`sheetId` は optional で、指定すれば受理する (content batch のシート scope, §3.1)。
