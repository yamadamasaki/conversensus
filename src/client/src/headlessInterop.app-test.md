# headlessInterop.app-test.tsx — ブラウザの人間と headless の agent の App 結合の仕様

## 何を

App (ブラウザの画面) の alice と、headless (`src/headless`) の agent が、同じ偽の PDS の上で
招待・参加・読み書きを一周すること (agent 段 2 の完了基準 1〜4)。agent が MCP の道具で読み書きする
場合も同じ一周をする (agent 段 3 の完了基準 4)。

## なぜ

headless は client の部品を**別に組み立てる** (ブラウザでは hooks が組み立てる)。部品は同じでも、
組み立ての食い違い (名簿の読み方、送る batch の選び方、発番器の戻し方) は、**片方だけを見るテストでは
捕まらない**。App 結合が「フックと子の間を一周する値」を見るのと同じ理由で、App と headless の間を
一周させる。

## どのように

App 結合の世界 (`testing/appWorld.ts`) の中で、端末の切り替えと同じように App と headless を
交互に動かす。headless は 1 プロセスに 1 つで、開くと正典・認証の口・`localStorage` を差し替え、
閉じると戻す。閉じたときに外れる認証の口は、App 結合の口 (パスワード) を入れ直す。

- 🔴 App の alice が File を作って node を 1 つ置き、agent を招待する → headless の agent が
  参加コードで参加し、alice の File と node を読み、node を 1 つ書いて送る → alice が同期すると、
  **agent の node が alice の画面に描かれる**
- agent の書き込みは agent の repo にあり、agent の actor で書かれている (由来, 設計 D1)
- 🔴 **MCP の道具で** (agent 段 3): agent の headless に MCP server を載せ、SDK の client を in-memory で
  つなぐ (`headless/src/testing/mcpClient.ts`。client の workspace は SDK を持たないので、SDK の import は
  headless の側に閉じる)。参加 (`accept_invitation`) → 一覧 (`list_files`) → 読む (`read_file`、alice の
  node は本文が空なので、encoding の `content ""` の node として引く) → alice の node の本文を書き換え、
  node と edge を足す → alice が同期すると、**agent の node と書き換えた本文が alice の画面に描かれる**。
  edge は描かれたかを画面で見ない (React Flow の edge は happy-dom で測れない)。edge が届くことは
  `mcp.test.ts` が見ている
依頼を人間と agent の間で行き来する試験 (agent 段 4 完了基準 6・段 5 完了基準 5) は、依頼の module に移した
(`src/modules/request/src/agentRequest.app-test.tsx`)。依頼は core から切り出したので (計画
node-actions-request-module.md N3)、依頼の操作を使う試験は module の側に置く。
