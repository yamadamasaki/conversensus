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
- 知らない引数・値の無い引数は断る
