# genesis.test.ts — genesis (snapshot → 初期 batch) のテスト仕様

## 何を

`genesis.ts` の `graphFileToBatches` (snapshot `GraphFile` → 初期 `Batch[]`) を検証する。`projectFile` との round-trip・べき等性・canonicalization・presentation 保全・batch の予約属性を固定する。

## なぜ

既存ファイルは snapshot が正典。読み取り経路を op-log へ移行する (D4) 際、snapshot を初期 batch へ変換して op-log を bootstrap する (§3.4)。この変換が

- 情報を取りこぼさない (特に presentation。取りこぼすと W3e の snapshot 退役でスタイルが永久消失する, H1)
- 同一端末で再実行してもべき等 (batch id が決定論的で `appendBatch` の重複排除に乗る, critic C1-new)
- fold 順が端末非依存 (予約 actor + 一意連番 clock で `orderBatches` の tiebreak が timestamp に昇格しない, critic M-2)

ことを保証しないと、cutover 時に状態が壊れる。これらを回帰させないため仕様として固定する。

## どのように

- **round-trip**: `projectFile(graphFileToBatches(file), file.id)` が元の `GraphFile` と等価 (ファイルメタ・シート順・ノード内容・properties・エッジ・pathType) を再構築することを確認する。genesis と読み取り経路が対になっていることの最重要保証。
- **presentation 保全 (H1)**: genesis が生成する ops に `edge.setStyle` / `edge.setLabelOffset` が含まれることを確認する。snapshot の `edgeLayouts` に格納された style / label offset を取りこぼさない。
- **空 ops 禁止 (critic L-3)**: 全 batch の ops が非空であることと、空シートは `sheet.create` batch は持つが content batch を生成しないことを確認する (`appendBatch` は空 ops を throw する)。
- **予約属性 (§3.4)**: 全 batch が `actor = "genesis"` / 固定 `timestamp` / 一意の昇順連番 clock を持つことを確認する。端末非依存な決定論の土台。
- **べき等性 (critic C1-new)**: 同一 snapshot からの再 genesis が同一 batch id 列を返すことを確認する。二重 genesis を `appendBatch` が吸収できる前提。
- **canonicalization (§3.4)**: snapshot のノード/エッジ順を入れ替えても batch id が変わらないことを確認する。配列順が不定でも id が決定論的であること。
- **UUID フォーマット**: 導出した batch id が Zod の `.uuid()` (version 1-5 / variant 8-b) を満たすことを確認する。`BatchIdSchema.parse` を通せることの保証。
