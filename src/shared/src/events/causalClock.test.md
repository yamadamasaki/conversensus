# causalClock.test.ts — 因果の発番器

step3 Phase 1 S1-3 ([設計](../../../../deepse/plans/step3-phase1-oplog-v2.md) D1)。

## 何を

`CausalClock` が、batch に押す印 (clock・seq・deps) を正しく振り、復元・受信で追随すること。

## なぜ

発番器は trunk・branch・判断ログで**共有される 1 つの状態**である。ここが間違うと、同じ点
`(actor, seq)` を 2 回使ったり、知っているはずの相手の操作を `deps` に載せ損ねたりして、
因果の判定 (`causality.ts`) の前提が崩れる。判定の正しさそのものは `causality.test.ts` が
性質で見ているので、ここは発番器の振る舞いを例で固定する。

## どのように

| テスト | 固定すること |
| --- | --- |
| issue は clock を進め seq を 1 から振り、deps に自分を載せない | 点の振り方 |
| 振った点は前の点の後 | 同じ actor の因果 |
| observe した batch とその依存が次の deps に入る。clock は受信分を追い越す | 受信規則 (Lamport と因果の知識の両方) |
| restore は自分の最大 seq の続きから振り、他人の点を知識に入れる | 再起動をまたいだ連続性 |
| restore は何度呼んでもよい | trunk と branch の tap がそれぞれのログから呼ぶ |
| 渡した LamportClock を使う | 既存の clock を共有する経路 |

共有されたときの振る舞い (trunk と branch が同じ連番から振る) は `sync/eventSyncTap.test.ts` と
App 結合 (`App.app-test.tsx`) が見ている。
