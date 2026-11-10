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

- 道具の一覧に、読む道具と書く道具がそろって並ぶ。module を渡さなければ module の道具 (依頼の道具など) は無い
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

### module の道具

`createMcpServer` は module (`HeadlessModule`) の説明・道具・注釈を足す。module を渡さなければ module の道具は
無い (上の「道具の一覧」)。依頼の道具の試験は依頼の module に移した (`src/modules/request/src/requestHeadless.test.ts`、
計画 node-actions-request-module.md B3)。stdio の入口 (`mcp.ts`) が依頼の module を渡す。
