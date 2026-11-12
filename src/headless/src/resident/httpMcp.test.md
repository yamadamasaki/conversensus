# httpMcp.test.ts / httpMcp.domfree-test.ts — MCP を HTTP で出す (agent 段 5 S4)

## 何を

常駐のプロセスが `Headless` の上の MCP の道具を、Streamable HTTP で 127.0.0.1 に出すこと。
token を持つ client だけが使えること。

## なぜ

- 常駐の agent は、起動する言語モデル (`claude -p`) に MCP を渡す。stdio の server を渡すと、
  それが自分で `Headless` を開いて**同じ置き場所を取り合う** (計画 F1)。HTTP なら `Headless` は 1 つのまま
- この口は agent の DID で書ける。**同じ機械の他のプロセスにも使わせない** — 127.0.0.1 だけで受け、token を要る

## どのように

**本体は `httpMcp.domfree-test.ts` で、`httpMcp.test.ts` が DOM の無い子のプロセスで走らせる。**
repo の根で走る `bun test` は preload で happy-dom を入れ、happy-dom は `Response` を差し替える。
`Bun.serve` は差し替えた `Response` を読めず、自前の既定の応答を返してしまう (実際に起きた)。
headless の workspace の根 (`src/headless`) で走らせると preload が効かない。名前を `*.test.ts` にしないのは、
根の `bun test` に拾わせないためである。

偽の PDS (`headlessWorld`) の上で agent の `Headless` を開き、HTTP の口を立てる。client は SDK の本物
(`StreamableHTTPClientTransport`) で、言語モデルと同じく URL と token でつなぐ (`testing/mcpClient.ts` の
`connectMcpHttp`)。`headlessWorld` の `fetch` の差し替えは、127.0.0.1 を本物に通す。

- 127.0.0.1 の URL で出す
- 🔴 token を持つ client は、同じ `Headless` の上の道具で読み書きできる。書いたものは常駐のプロセスの手元にも入る
- token が無い・違う要求は 401。SDK の client もつながらない
- MCP の path の外は 404
- 🔴 範囲つきの token (`grant`、#386): 範囲の道具だけが見え (`listTools`)、範囲の File は読め、範囲の外の File は
  理由つきで断られる。`list_files` も範囲の File だけを出す。取り消すと、その token ではつながらない
