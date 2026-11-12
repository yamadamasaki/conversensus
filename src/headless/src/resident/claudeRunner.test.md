# claudeRunner.test.ts — 仕事ごとに `claude -p` を起動する (agent 段 5 S5)

## 何を

常駐の agent が仕事 1 つ (依頼に答える、など) に `claude -p` を 1 回起動するときの、**引数** (使わせる道具・
MCP の設定・prompt・指示)、**MCP の設定 file**、**起動の結果** (成功・失敗・時間切れ) を見る。何を頼むか (prompt) は
module が決める (`AgentTask`、計画 node-actions-request-module.md B4)。依頼の prompt は依頼の module の
`requestResident.test.ts` が見る。

## なぜ

- 依頼の本文は File の参加者なら誰でも書ける。起動した Claude Code が **Bash や Edit を使えると**、
  依頼の本文から常駐の機械を操作できてしまう。使える道具は conversensus の MCP だけにする (完了基準 4)
- MCP の設定には token が入る。引数で渡すと、同じ機械の誰でも `ps` で読める。持ち主だけが読める file で渡す
- 言語モデルが止まらないと、列の後ろの依頼がいつまでも答えられない。時間で止める
- **起動の権限は答えに要るだけにする** (#386)。MCP の中でも、その起動の依頼の File と答えに要る道具だけを許す
  token を起動ごとに出し、終われば取り消す。設定 file も消す (失敗しても)
- **operator の設定と秘密を渡さない** (#390)。常駐の環境には app password がある。hooks・plugin・CLAUDE.md は
  operator のもので、依頼に答える起動に要らない。依頼の本文は `ps` で見える引数に載せない
- **使いすぎない** (#387)。turn の上限を常に渡し、費用の上限は operator が決めたときだけ渡す

## どのように

本物の `claude` は起動しない (費用がかかり、結果も決まらない)。引数は組み立てる関数 (`claudeArgs`) を直に見る。
起動は `testing/fakeClaude.ts` を `bun` で起動して代える — 受けたもの (引数・作業 directory・stdin・環境変数の名前・
`--mcp-config` の中身) を file に書き、決めた終わり方 (成功・失敗・終わらない) をする。偽物への指定は**コマンドの
先頭の引数** (`--fake-out=`・`--fake-mode=`) で渡す — 環境変数は runner が決めたものしか渡らない (#390)。
MCP の口も偽物にし、出した token と範囲・取り消した token を控える。

- 🔴 使わせる道具を絞る: 組み込みの道具なし (`--tools ""`)、conversensus の MCP だけ (`--strict-mcp-config`)、
  許すのは `mcp__conversensus`、他は尋ねずに断る (`dontAsk`)
- 🔴 operator の設定を読まない (`--setting-sources ""`、#390)。`--bare` は Claude Code のログイン (OAuth) を読まないので
  使わない
- 🔴 prompt は引数に載せない (`-p` の直後は別の引数、#390)
- turn の上限は常に渡し、費用の上限はあるときだけ (#387)
- operator の指示 (file、`--append-system-prompt-file`) とモデルは、あるときだけ渡す
- 🔴 `agentEnv`: 決めたものと前置きの合うものだけを渡す。app password や他の token は渡さない (#390)
- 🔴 MCP の設定 file は URL と token を持ち、持ち主だけが読める (既にある file も絞り直す — `writeFileSync` の
  `mode` は新しい file にしか効かない)
- 組み立てた引数で、置き場所を作業 directory にして起動し、prompt を stdin で渡し、出力を渡す (repo の CLAUDE.md や
  設定を読ませない)
- 🔴 起動ごとに範囲つきの token を出し (範囲は仕事の `scope`)、起動されたものが見る設定はその token を持つ。
  終われば取り消し、設定の file も消す (#386)
- 🔴 失敗しても token を取り消し、設定の file を消す
- 🔴 起動されたものの環境に app password が無い (#390)
- 終了コードが 0 でなければ `AgentRunError`。理由に stderr を入れる
- 🔴 時間を過ぎたら止めて `AgentRunError`
