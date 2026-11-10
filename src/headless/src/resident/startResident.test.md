# startResident.test.ts — 常駐の agent の loop (agent 段 5 S6、計画 node-actions-request-module.md B4)

## 何を

`startResident` が、ログイン (S1) と同期し続ける (S2) を組み立て、同期し終えるたびに module の常駐の振る舞い
(`ResidentWorker`) に知らせること。何をするか (依頼に答える、など) は module が決め、loop は知らない。

## なぜ

- 部品 (`watch`・`ensureSignedIn`) はそれぞれ試してある。組み立ての誤り、たとえば同期し終えた知らせが worker に
  届かない、ログインを確かめない、などは部品の試験では見えない
- loop は module を知らないので、**どの worker にも同じように知らせる**ことを、依頼に依らない worker で確かめる

## どのように

偽の PDS (`headlessWorld`) の上で、alice が File を作って node を 1 つ書き、agent を招く。agent は参加だけしておく。
常駐は流れの合図なし・ポーリングなし (試験の間には来ない) で始め、始めたときの同期を回し終えたら止める。
worker の代わりは、知らされた File を覚えるだけの偽物にする。

- 参加している File を同期し終えると、どの worker にも知らせる。知らせる前に同期している
  (alice の node が手元にある)
- セッションが失効していても、始めるときに app password で入り直して続ける
- `idle` は worker の仕事が終わるまで待つ
