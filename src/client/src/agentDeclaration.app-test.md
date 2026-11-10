# agentDeclaration.app-test.tsx — agent の宣言と operator の裏付けの App 結合 (設計 D2)

## 何を

agent の宣言から、参加者一覧の印と operator の「認める」までを、`<App />` を丸ごと描いて一周させる
(計画 agent-d2-declaration.md A3)。

## なぜ

判定の規則 (`agentDeclarationOf`)・record の置き場所 (`headless/agentDeclaration.test.ts`)・一覧の描き方
(`InvitationDialog.test.tsx`) はそれぞれ確かめてある。ここで見るのは**つなぎ**である。

- 参加者一覧を開くと、参加者の宣言が読まれて印になるか
- 「認める」がログインしている人の repo に裏付けを書くか
- 書いた後、覚えている宣言を忘れて読み直し、印が変わるか

## どのように

偽の PDS に alice と agent の 2 人を置き、端末を切り替える。

1. agent が App にログインし、自分の repo に宣言を書く (operator = alice、model = claude)。CLI の `profile` と同じ口
   (`agentRecords.putProfile`) を使う。App には agent が宣言を書く画面が無い (宣言は CLI で書く — 計画の決定)
2. alice が File を作って agent を招き、参加者一覧を開き直す。agent の行に「名乗りのみ」と model が出る
3. 「自分の agent と認める」を押すと「裏付けあり」になり、alice の repo に裏付けが 1 つ (rkey = agent の DID) 置かれる
4. 「認めるのをやめる」を押すと「名乗りのみ」に戻り、裏付けは消える
