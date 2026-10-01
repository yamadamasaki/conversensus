# localChanges.test.ts — タブ間の知らせ (step3 Phase 2 D3)

## 何を

- `broadcastingBackend`: ローカル正典に書けたら、他のタブへ「この File が動いた」と知らせる
- `subscribeLocalChanges`: 他のタブの知らせを受ける

## なぜ

タブはそれぞれ Worker を立て、同じ OPFS の DB に書く。あるタブの書き込みは DB に入るが、**他の
タブの画面は知らない**。知らせを受けたタブは、因果の知識に取り込み、画面を測り直す
(`useEventSyncTap` / `useFileSheetOperations`)。

知らせ方を誤ると 2 方向に壊れる。

- **自分に届く**: 自分の書き込みのたびに自分を測り直し、無駄な差し替えが走る
- **何も書いていないのに届く**: 既知の batch の再送 (受信のたびに起きる) で、全タブが測り直す

## どのように

BroadcastChannel は偽物で与える (`bus()`)。本物と同じく、**送った channel 自身には届かない**。

| テスト | 固定すること |
| --- | --- |
| 🔴 追記が他のタブに届き、自分には届かない | |
| 何も追記されなければ知らせない | 既知の batch の再送 |
| File の作成も知らせる | 他のタブの一覧に出すため |
| 購読をやめたら届かない | タブが File を閉じたとき |

## テストしていないこと

- **本物の BroadcastChannel と画面の差し替え** — E2E (`tests/multiTab.spec.ts`) と App 結合
  (`App.app-test.tsx` の「同じブラウザの別のタブの書き込み」)
