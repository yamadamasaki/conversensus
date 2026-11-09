# agentRequest.app-test.tsx — 依頼を人間と headless の agent の間で行き来する App 結合の仕様

## 何を

App (ブラウザの画面) の alice と、headless (`src/headless`) の agent が、依頼を行き来させることを確かめる。

- agent 段 4 完了基準 6: alice が送り、agent が MCP で答える。agent が送り、alice が画面で答える
- agent 段 5 完了基準 5: alice が送ると、常駐の agent が見つけて答える

もとは `src/client/src/headlessInterop.app-test.tsx` にあった。依頼を core から module へ切り出したとき
(計画 node-actions-request-module.md N3) に、依頼の module の側へ移した。

## なぜ

依頼は画面 (依頼の module の操作) と headless (MCP の道具・常駐の agent) の**両方**から読み書きされる。
片方だけを見る試験では、組み立ての食い違いが捕まらない。たとえば、画面が書く宛先の形と、MCP が数える
「自分宛て」の形の食い違いである。App と headless の間を一周させる理由は `headlessInterop.app-test.md` と同じ。

## どのように

App 結合の世界 (`testing/appWorld.ts`) の中で、App と headless を交互に動かす (`asAgent`)。
App は依頼の module を登録して描く (`testing/requestDriver.tsx`。アプリの入口 `main.tsx` と同じ)。
alice が依頼を送る手順は次のとおり (`aliceSendsToAgent`)。

1. 依頼の Sheet で依頼を作る
2. node のそばの「送る」を押す
3. dialog で宛先に agent だけを選んで実行する

- 🔴 **依頼を行き来する** (agent 段 4 完了基準 6)
  1. alice が File を作って agent を招き、agent が参加する
  2. alice が agent に送る
  3. agent (MCP) が `list_requests` で見つけ、`answer_request` で答える
  4. agent が依頼の種類で node を作る。種類の id は encoding の template の注釈から引く。宛先に alice を置いて送る
  5. alice が同期すると、agent の答えが描かれ、「agent.test から依頼が届きました」が出る
  6. alice が「開く」を押すと、その依頼が選ばれている。node のそばの「答える」で答える
  7. agent が読むと、**2 つの依頼がどちらも回答あり**
- 🔴 **常駐の agent** (agent 段 5 完了基準 5)
  1. alice が agent に送る
  2. **誰も MCP を操作せず**、常駐の agent (`startResident`) を始めるだけ。常駐は同期して依頼を見つけ、
     言語モデルを 1 回起動する
  3. alice が同期すると答えが描かれ、依頼の印が回答あり

  言語モデルは偽物で、本物の `claude -p` と同じく MCP の道具 (`answer_request`) で答える。
  HTTP の口と流れの合図は通さない。理由は移す前と同じ (`resident/httpMcp.test.md`・`resident/watch.test.ts`)。
