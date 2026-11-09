# claudeRunner.test.ts — 依頼ごとに `claude -p` を起動する (agent 段 5 S5)

## 何を

常駐の agent が依頼 1 つに `claude -p` を 1 回起動するときの、**引数** (使わせる道具・MCP の設定・prompt・指示)、
**MCP の設定 file**、**起動の結果** (成功・失敗・時間切れ) を見る。

## なぜ

- 依頼の本文は File の参加者なら誰でも書ける。起動した Claude Code が **Bash や Edit を使えると**、
  依頼の本文から常駐の機械を操作できてしまう。使える道具は conversensus の MCP だけにする (完了基準 4)
- MCP の設定には token が入る。引数で渡すと、同じ機械の誰でも `ps` で読める。持ち主だけが読める file で渡す
- 言語モデルが止まらないと、列の後ろの依頼がいつまでも答えられない。時間で止める

## どのように

本物の `claude` は起動しない (費用がかかり、結果も決まらない)。引数は組み立てる関数 (`claudeArgs`) を直に見る。
起動は `testing/fakeClaude.ts` を `bun` で起動して代える — 受けた引数と作業 directory を file に書き、
環境変数で決めた終わり方 (成功・失敗・終わらない) をする。環境変数は runner の `env` で渡す
(`process.env` を書き換えても、bun の `Bun.spawn` の既定の環境には効かなかった)。

- 🔴 使わせる道具を絞る: 組み込みの道具なし (`--tools ""`)、conversensus の MCP だけ (`--strict-mcp-config`)、
  許すのは `mcp__conversensus`、他は尋ねずに断る (`dontAsk`)
- prompt は依頼の File・Sheet・node・回数・本文を持ち、`read_file` で読んで `answer_request` で答えるよう求める
- operator の指示とモデルは、あるときだけ渡す
- 🔴 MCP の設定 file は URL と token を持ち、持ち主だけが読める (既にある file も絞り直す — `writeFileSync` の
  `mode` は新しい file にしか効かない)
- 組み立てた引数で、置き場所を作業 directory にして起動し、出力を渡す (repo の CLAUDE.md や設定を読ませない)
- 終了コードが 0 でなければ `AgentRunError`。理由に stderr を入れる
- 🔴 時間を過ぎたら止めて `AgentRunError`
