# oauthLoopback.test.ts — headless の loopback OAuth のテスト仕様

## 何を

`oauthLoopback` (ATProto OAuth の loopback client による認証の口) と、セッションを置く `JsonStore`。

## なぜ

headless は人間と同じ OAuth でログインする (設計 D3: 認証の方式を本番と統一し、パスワードを agent に
渡さない)。ATProto の OAuth には device flow が無いので、手元に受け口を開き、ブラウザでの同意の戻りを
受ける。**受け口の配線を間違えると、ログインが永遠に終わらないか、プロセスが終わらない** (受け口が
開いたまま)。

本物の PDS との往復 (同意の画面・token の発行・DPoP) はここでは見ない。偽の PDS は OAuth を持たないので、
開発用の PDS で手で確かめる (計画 H5)。

## どのように

OAuth client を偽物に差し替える (`createClient`)。偽物の `authorize` は「同意した後に PDS が戻す先」
(`<受け口>?code=…&state=…`) をそのまま返し、テストの「ブラウザ」(`openUrl`) がそれを開く — 利用者が
同意してブラウザが戻り先へ移ったのと同じことになる。「ブラウザ」は bun の `fetch` を使う (preload の
happy-dom の `fetch` は bun の受け口の応答を読めない)。

- 🔴 同意の URL を渡し、戻りを受け口で受けてログインする。戻り先は `127.0.0.1` の空いている port の `/callback`
- ログインした DID を覚え、次に作った口で戻せる (起動をまたぐ)
- ログインしていなければ戻さない
- ログアウトするとセッションを捨て、次は戻さない
- 同意を待ちきれなければ失敗する。同意のページを渡せなければ失敗する (どちらも受け口を閉じる)
- セッションの file は持ち主だけが読み書きできる (DPoP の秘密鍵を含む)
