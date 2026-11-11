# property の欄で読み取り専用の property を表示する (#357、実装計画)

> 設計: [agent-actor.md](../architecture/step4/agent-actor.md) D6 から切り出し。issue: #357。
> branch: `feature/readonly-properties-357`。

## 1. 目標と完了基準

**透明性のため**に、アプリ (system、`app.conversensus.*`) や template (種別、`<templateId>.kind`) が要素に付けた
読み取り専用の property を、利用者が選べば property の欄に出す。

1. property の欄の見出しにトグル「読み取り専用も表示」を置く。既定は off
2. off では system と種別を出さない (種別はこれまで出していたが、値が種類の node の id で読みにくいので、
   トグルの側に移す。利用者 2026-11-11)。on では両方を読み取り専用で、編集できない理由を添えて出す
3. オン/オフは端末に覚える (localStorage)。ほかの参加者には関わらない。同じ画面の 2 つの欄は揃う
4. 検索は変えない (on でも system は探さない)

## 2. 決定 (利用者 2026-11-11)

- off では種別も隠す
- トグルは欄の見出しに置き、端末で覚える

## 3. 進捗

| | 状態 | メモ |
| --- | --- | --- |
| 実装 | 済 | `property/readOnlyToggle.ts` (端末に覚える 1 か所の状態)、`propertyRows` の第 2 引数、`PropertyEditor` の見出しのトグル。system の型は値の形から出す |
| 確認 | 済 | `user-test-environment.md` §5.13。利用者が確認した (2026-11-11) |
