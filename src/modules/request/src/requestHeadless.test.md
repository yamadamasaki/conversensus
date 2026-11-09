# requestHeadless.test.ts — 依頼の module の headless の側のテスト仕様

## 何を

依頼の module が headless に足すもの (`REQUEST_HEADLESS_MODULE`、計画 node-actions-request-module.md B3) を検証する。

- MCP の依頼の道具: `list_requests`・`answer_request`・`send_request`・`close_request`・`reopen_request`・`set_addressee`
- `read_file` の注釈 (`requestNote`)
- 自分宛ての未回答の依頼 (`requestsForMe`)

道具は **SDK の本物の client** から in-memory の transport で呼ぶ (`connectMcp` に依頼の module を渡す)。
PDS は偽 (`headlessWorld`)。もとは `src/headless/src/mcp.test.ts` にあった。

## なぜ

agent が依頼を見つけて答える入口はここである (agent 段 4 完了基準 5)。headless の MCP server は依頼を知らず、
道具を足すのは module なので、**module を渡したときに道具がそろい、正しく配線されている**ことを確かめる。

## どのように

- 依頼の module を渡すと、依頼の道具が足される (渡さないときに無いことは `mcp.test.ts` が見る)
- **注釈**: 応答を求める node には、状態・回数・宛先を注釈する。情報は property と答えの edge にある。
  前の送信への答えしか無ければ未回答 (2 回目で、答えは 1 回目へのもの)。`encodeFile` に `requestNote` を
  渡して見る (注釈の配線そのものは `encoding.test.ts`)

### 依頼の道具 (agent 段 4 R6)


alice (headless) が宛先つきの依頼 node を作って送り (種別プロパティは持たせない — 状態と通知は種類に
依らない)、agent が MCP で参加する。

- 🔴 `list_requests` が自分宛ての未回答の依頼を、何回目か・送った人・本文つきで出す。`read_file` の
  encoding にも状態の注釈が出る → `answer_request` で答えると一覧から消え、alice が同期すると回答あり
  (完了基準 5)
- 宛先が不特定 (空) なら届く。他の人宛ての依頼は一覧に出ない
- agent も依頼を送れる: `list_participants` で DID を引き、`set_addressee` で宛先を置き換え、`send_request`
  で送る。**最後に送ったのが自分なら、宛先に自分が入っていても自分の一覧に出さない**
- 閉じた依頼には答えられず、理由を `isError` で返す。開き直せば答えられる
