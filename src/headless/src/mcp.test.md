# mcp.test.ts — MCP server のテスト仕様

## 何を

`createMcpServer` (Headless の上に読む道具と書く道具を載せた MCP server) を、**SDK の本物の client**
から in-memory の transport で呼んで検証する。PDS は偽 (`headlessWorld`)。あわせて起動の引数
(`parseServerArgs`)。

## なぜ

agent (Claude Code など) が conversensus に触れる入口はここだけになる (計画 `agent-stage3-mcp.md`
完了基準 2・4)。道具単体 (`tools.test.ts`) が正しくても、**道具の配線** — 引数の受け渡し、書く前に
正典が落ち着くのを待つ、書いたら送る、失敗を agent に読める形で返す — が壊れていれば agent は
書けない。

## どのように

- 道具の一覧に、読む道具と書く道具がそろって並ぶ
- **一周**: alice (headless) が File を作って招待 → agent が MCP で参加 (`accept_invitation`) →
  一覧 (`list_files`) → 読む (`read_file` の encoding に alice の node が出る) → node と edge を足す →
  alice が同期すると、agent の node と edge が見える
- 書いた後に読むと、本文の書き換えと property が encoding に出る (書く道具が前の書き込みの後の
  状態を見ていること)
- 道具が断ると、理由を `isError` で返し、server はそのまま使える
- metagraph (`index`) の Sheet には書けない (画面は metagraph の編集を読み替えていて、道具には
  その読み替えが無い)
- ログインしていなければ、道具はそう返す
- 起動の引数: `--data`・`--pds` を読み、無ければ既定。知らない引数・値の無い引数は断る

### 依頼 (agent 段 4 R6)

alice (headless) が宛先つきの依頼 node を作って送り (種別プロパティは持たせない — 状態と通知は種類に
依らない)、agent が MCP で参加する。

- 🔴 `list_requests` が自分宛ての未回答の依頼を、何回目か・送った人・本文つきで出す。`read_file` の
  encoding にも状態の注釈が出る → `answer_request` で答えると一覧から消え、alice が同期すると回答あり
  (完了基準 5)
- 宛先が不特定 (空) なら届く。他の人宛ての依頼は一覧に出ない
- agent も依頼を送れる: `list_participants` で DID を引き、`set_addressee` で宛先を置き換え、`send_request`
  で送る。**最後に送ったのが自分なら、宛先に自分が入っていても自分の一覧に出さない**
- 閉じた依頼には答えられず、理由を `isError` で返す。開き直せば答えられる
