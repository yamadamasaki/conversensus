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
- **異 snapshot 分岐の収束 (Phase 4e-0, 4e 設計 §3.1 / critic MED2)**: Phase 4e-0 の C1 見直しで genesis が remote に載るようになったため、同一ファイルを異なる内容の snapshot から genesis した 2 系統が混在するケースを固定する。(1) 内容が異なる snapshot は batch id が食い違う (分岐が実際に起きる前提の確認)。(2) 2 系統の genesis を混ぜても、入力順によらず `projectFile` が同一結果へ収束し (orderBatches の clock → actor → id 全順序)、entity ID (sheetId/nodeId/edgeId) が snapshot 経由で共有されるため同じ entity へ収斂し重複 entity を生まない。
