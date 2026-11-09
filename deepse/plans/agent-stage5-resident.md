# agent 段 5: 常駐の agent (実装計画)

> 設計: [agent-actor.md](../architecture/step4/agent-actor.md) D3・D11・D13、§4 段 5、A2'。
> 前の段: [agent-stage4-request.md](agent-stage4-request.md) (PR #361)。
> branch: `step/agent-stage5-resident`。

## 1. 目標と完了基準

agent が**常駐**し、自分宛てに送られた依頼に、人が横にいなくても答える。conversensus は依頼を評価しない
(D12) — 常駐の loop は依頼を**見つけて言語モデルを起動するだけ**で、読み書きは段 3・4 の MCP の道具を通す。

**完了基準**:

1. 常駐の agent は app password でログインし、再起動・token の失効をまたいで人の手なしに続く (A2')
2. 参加している File すべてを同期し続ける。新しい書き込みには firehose の合図で気づき、合図が抜けても
   遅いポーリングが拾う (D11)
3. 自分宛てに送られた依頼 (送った・未回答) を見つけると、言語モデル (既定は `claude -p`) を 1 依頼に
   1 回起動し、それが MCP の道具で答えを書く。**同じ送信には 1 度しか起動しない** (答えられなくても)
4. 起動する言語モデルが使える道具は conversensus の MCP の道具だけで、時間に上限がある
5. App の alice が agent に送る → 常駐の agent が答える → alice の画面で「回答あり」、を App 結合で
   確かめる (言語モデルは偽物に差し替える)
6. 開発用の PDS で、人間が送った依頼に常駐の agent (本物の `claude -p`) が答えるのを手で確かめる

**非目標**: `answerTarget` の `newSheet`・`newFile`、依頼の答えを次の依頼に流す (dataflow、D12)、
複数の依頼を並べて同時に答える、confidential client、連合 (参加者の PDS が別々)。

## 2. 調べて分かったこと (事実)

| # | 事実 | 帰結 |
| --- | --- | --- |
| F1 | `Headless` は `dataDir` を lock し、1 プロセス = 1 agent (`lockDataDir`、段 2 F8)。段 3 の MCP server は stdio で、起動されると自分で `Headless` を開く | 常駐の loop が `claude -p` に stdio の MCP server を渡すと、**同じ置き場所を 2 つのプロセスが取り合う**。常駐のプロセスが MCP を **Streamable HTTP** (127.0.0.1、秘密の token) で出し、`claude -p` にはその URL を渡す。`Headless` は 1 つのまま |
| F2 | MCP SDK 1.32.2 に `WebStandardStreamableHTTPServerTransport` がある (Request/Response の口) | `Bun.serve` に載る。`createMcpServer(headless)` はそのまま使える |
| F3 | `passwordAuth` (`createSession`) は App 結合テスト専用と書かれているが、セッションを `localStorage` に置くだけで、headless の `FileStorage` で動く | 常駐の認証に使う。注釈を「App 結合と常駐の agent」に直す。refresh も切れたら app password でログインし直す |
| F4 | `LiveChannel` は socket の作り方と「今つなぐか」を差し替えられる。ブラウザ版だけが `document`・`window` を読む | headless 版は「常につなぐ」で作る。bun に `WebSocket` はある |
| F5 | `FileSession` は `live` (合図) と `pollIntervalMs`・`livePollIntervalMs` を取る。headless は今ポーリングしない (`NO_POLLING_MS`) | 常駐のときだけ合図と遅いポーリングを渡す。受信の経路は今のまま (合図は合図だけ) |
| F6 | `requestsForMe` は「送った・未回答」「自分宛て (空 = 誰にでも)」「最後に送ったのが自分でない」を返す (段 4 R6) | 見つける規則はこれを使う。誰かが先に答えれば「回答あり」になって外れる |
| F7 | 種類の説明 (= 種類ごとの指示、D13) は既に `read_file` の encoding に出る | 種類ごとの指示は新しく運ばなくてよい。agent 全体の指示 (operator) は `claude -p --append-system-prompt` で渡す |
| F8 | `claude -p` は `--mcp-config` (JSON)・`--strict-mcp-config`・`--allowedTools`・`--append-system-prompt` を取る。`-p` では許していない道具は使えない | 道具を `mcp__conversensus__*` に絞り、他の MCP server も読ませない (完了基準 4) |
| F9 | MCP の `accept_invitation` がある。常駐の間、CLI と stdio の MCP server は同じ置き場所を開けない (F1) | 参加は、常駐の HTTP の口に operator の Claude Code をつないで `accept_invitation` するか、常駐を止めて CLI で行う (手順に書く) |

## 3. 決めたこと (利用者 2026-11-09、すべて推奨案)

- **言語モデルの呼び方**: 依頼ごとに `claude -p` を起動し、conversensus の MCP を渡す。起動するコマンドは設定で替えられる
- **認証 (A2')**: app password。段 3 の loopback OAuth (人が横で操作する) はそのまま残す
- **合図**: firehose の合図 + 遅いポーリング
- **見る範囲**: 参加している File すべて (新しく参加すれば、その File も見る)

## 4. スライス

| | 内容 | 確かめ方 |
| --- | --- | --- |
| S1 | **認証**: headless で app password のログイン (`passwordAuth` を headless から使う)。app password は環境変数 (`CONVERSENSUS_APP_PASSWORD`) から読み、置き場所には残さない。セッションが戻せなければ app password でログインし直す | 単体 (偽の PDS で、戻す・ログインし直す) |
| S2 | **同期し続ける**: 参加している File を見つけ (`discover`)、それぞれの `FileSession` に合図 (headless 版の `LiveChannel`) と遅いポーリングを渡す。判断ログ (名簿) の合図で知らない File が来たら見つけ直す | 単体 (偽の合図で受信が走る、知らない File を見つけ直す) |
| S3 | **見つけて起動する**: 受信のたびに `requestsForMe` を見て、まだ起動していない (File・node・送った回数) なら起動の列に入れる。**1 つずつ**、起動した印を置き場所に残す (再起動しても同じ送信に 2 度起動しない)。起動する口は差し替えられる (`AgentRunner`) | 単体 + 性質 (どんな受信の並びでも、同じ送信への起動は高々 1 回) |
| S4 | **MCP を HTTP で出す**: 常駐のプロセスが `createMcpServer` を Streamable HTTP で 127.0.0.1 に出す。token が無い・違う要求は断る | 単体 (MCP client で道具が呼べる・token が違えば 401) |
| S5 | **`claude -p` の起動**: `--mcp-config` (S4 の URL と token)・`--strict-mcp-config`・`--allowedTools mcp__conversensus__*`・prompt (どの File のどの依頼か)・operator の指示 (任意の file)。時間の上限で止める。出力は log に | 単体 (起動の引数を組み立てる関数、時間切れで止める) |
| S6 | **入口と App 結合**: `resident.ts` (引数・起動・終了)。App の alice が送る → 常駐 (偽の `AgentRunner` が HTTP の MCP で `answer_request`) → alice の画面で「回答あり」 | App 結合 (完了基準 5) |
| S7 | 開発用の PDS で、本物の `claude -p` で確かめる。`user-test-environment.md` に手順 | 完了基準 6 (人間が確かめる) |

### 4.1 進捗

| | 状態 | メモ |
| --- | --- | --- |
| S1 | — | |
| S2 | — | |
| S3 | — | |
| S4 | — | |
| S5 | — | |
| S6 | — | |
| S7 | — | |
