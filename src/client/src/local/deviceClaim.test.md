# deviceClaim.test.ts — タブごとの deviceId (step3 Phase 2 D4)

## 何を

`claimDeviceId` が、localStorage の deviceId の溜まりから、Web Locks で空いている 1 つを借りること。

## なぜ

deviceId は actor (`<did>#<deviceId>`) の後半で、因果の点 (actor, seq) を発番する単位である。
同じ origin のタブが同じ deviceId を使うと、2 つのタブが同じ点を発番し、PDS の rkey (点で決まる) で
互いを上書きする (設計 F4)。PWA ではタブを 2 つ開くのは普通のことである。

同時に、actor を増やしすぎたくない (vector が伸び続ける)。だから「タブごとに毎回新しい id」
ではなく、**閉じたタブの id を次のタブが使う**溜まりにした (Q1 で確定)。

## どのように

Web Locks と localStorage は偽物で与える。偽の Web Locks は `ifAvailable` の排他と、
callback の Promise が解けるまで lock を持ち続けることだけを持つ (`claimDeviceId` が頼るのは
この 2 つ)。「端末」= localStorage と Web Locks を共有するタブの集まりとして、`open()` が
タブを 1 つ開く。

| テスト | 固定すること |
| --- | --- |
| 1 つ目のタブは従来の deviceId を引き継ぐ | 既存の端末の actor が変わらない |
| 🔴 同時に開いたタブは別々の id | F4 の解そのもの |
| 🔴 閉じたタブの id を次のタブが使い、溜まりは増えない | actor の数が「同時に開いたタブの最大数」で頭打ちになる |
| 何も無ければ新しく作る | |
| 溜まりが壊れていても開ける | 作り直す (id が 1 つ増えるだけで正しさは失われない) |

## テストしていないこと

- **本物の Web Locks** — E2E (`tests/multiTab.spec.ts`) が 2 つの page で見る
- **溜まりへの同時の追記** — read-modify-write なので、2 つのタブが同時に新しい id を足すと片方が
  漏れうる。漏れた id は lock を持つタブだけが使い、閉じれば使われなくなるので正しさは失われない
  (モジュール冒頭の注)
