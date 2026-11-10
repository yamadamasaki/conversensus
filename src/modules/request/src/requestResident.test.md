# requestResident.test.ts — 依頼に答える常駐の agent (agent 段 5 S6、計画 node-actions-request-module.md B4)

## 何を

依頼の module の常駐の振る舞い (`createRequestWorker`) が、常駐の loop (`startResident`) の上で、
送られた依頼を見つけて言語モデルを起動し、**人の手なしに**答えること。言語モデルへの頼み方 (`promptFor`)。

もとは `src/headless/src/resident/resident.test.ts` にあった。依頼を core から module へ切り出したときに移した。

## なぜ

- 部品はそれぞれ試してある。組み立ての誤り (同期し終えた知らせが依頼の列に届かない、印を置く所が
  置き場所でない、ログインを確かめない) は、部品の試験では見えない
- 常駐は何度も止めて始め直される。**再起動のたびに同じ依頼に答える**と、依頼した人のグラフに
  同じ答えが積もる

## どのように

偽の PDS (`headlessWorld`) の上で、alice の `Headless` が File を作り、agent を招いて依頼を送る。
agent は参加だけしておく。常駐は流れの合図なし・ポーリングなし (試験の間には来ない) で始め、
始めたときの同期と依頼を回し終えたら止める。依頼の振る舞いは `createRequestWorker` で作り、常駐の loop
(`startResident`) に worker として渡す (常駐の入口が渡すのと同じ形)。言語モデルの代わりは、**MCP の道具 (`answer_request`) で答える**
偽物にする — 本物の `claude -p` が HTTP の口でするのと同じ道具である。

- 🔴 送られた依頼を見つけて言語モデルを 1 回起動し (起動の中身: File・Sheet・node・回数・本文)、
  その答えが **alice の手元で「回答あり」** になる
- 🔴 再起動しても同じ送信には起動しない。alice が送り直せば (2 回目) 起動し、また回答ありになる
- セッションが失効していても、始めるときに app password で入り直す
- **prompt** (`promptFor`): 依頼の File・Sheet・node・回数・本文を持ち、`read_file` で読んで
  `answer_request` で答えるよう求める (もとは `claudeRunner.test.ts`。起動そのものは headless の汎用の口)
