# mcpStdio.test.ts — MCP server を stdio で起動するテストの仕様

## 何を

`mcp.ts` を**本物の起動の形** (`bun run mcp.ts --data … --pds …`) で別のプロセスとして立て、SDK の
stdio client からつなぐ。

## なぜ

Claude Code は server を子プロセスとして起動し、標準入出力で話す。in-memory のテスト (`mcp.test.ts`)
では次のことが見えない:

- 起動の部分 (`import.meta.main`) が動くか — 引数・ログインの再開・transport の接続
- **標準出力が MCP の通信路として汚れていないか** (client の部品のログは標準エラーへ回す)。
  汚れれば client は応答を読めず、初期化や道具の呼び出しで落ちる
- **client が閉じたらプロセスが終わり、置き場所の lock を放すか**。残れば次の起動が lock で断られる

## どのように

ログインしていない置き場所で起動する (PDS には繋がらない番地を渡す。起動では触らない)。
説明 (`instructions`) と道具の一覧が届き、`whoami` が「ログインしていない」を返し、client を閉じると
プロセスが終わって lock の file が消える。
