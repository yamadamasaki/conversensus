# agentDeclaration.test.ts — agent の宣言を偽の PDS で書いて読む (設計 D2)

## 何を

`Headless.declareAgent` (agent が自分の repo に宣言を書く) と `Headless.agentDeclaration` (宣言と operator の裏付けを
読んで状態を導く) を、偽の PDS (`headlessWorld`) の上で一周させる (計画 agent-d2-declaration.md A2)。

## なぜ

判定の規則は `agentDeclarationOf` の性質で見てある。ここで見るのは **record の置き場所**である:
宣言は agent の repo、裏付けは operator の repo (rkey = agent の DID) で、読むときは宣言が指す operator の repo から
裏付けを読む。置き場所を取り違えると、規則が正しくても「裏付けあり」にならない (あるいは他人の repo で成り立つ)。

## どのように

- 🔴 agent が operator をハンドル名で宣言すると、DID に引いて書き、名乗りのみになる → operator (alice) が自分の repo に
  裏付けを書くと裏付けあり → 裏付けを消すと名乗りのみに戻る。alice 自身は、裏付けを書いても agent ではない
- operator は DID でも受ける。見つからないハンドル名は理由つきで断る
