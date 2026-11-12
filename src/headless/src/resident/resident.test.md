# resident.test.ts — 常駐の agent の入口の引数 (agent 段 5 S6)

## 何を

常駐の agent の入口 (`resident.ts`) の引数の読み (`parseResidentArgs`)。

常駐の loop (`startResident`) の試験は `startResident.test.ts`、依頼に答える振る舞いの試験は依頼の module の
`requestResident.test.ts` にある (計画 node-actions-request-module.md B4 で分けた)。

## なぜ

常駐は operator が手で起動する。引数の誤りは起動のときに理由つきで止まらないと、間違った間隔や置き場所で
動き続ける。

## どのように

- `--handle` が要り、他は既定を持つ
- 秒は正の数だけ受け、ミリ秒にする
- 使いすぎない上限 (#387): `--max-turns` は正の整数、`--max-budget` は正の数だけ受ける
- `--answer-agents` は値を取らない (どこに置いても、後ろの引数の組を崩さない)。既定は答えない (#387)
- 🔴 `--pds` が要り、https だけを受ける。http は `--allow-insecure-pds` (開発用) のときだけ。URL でないもの・他の scheme は
  断る (#391)。常駐は app password を PDS に送るので、既定の開発用の PDS (http) に黙って送らない
- 知らない引数・値の無い引数は断る
