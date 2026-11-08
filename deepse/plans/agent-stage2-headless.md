# agent 段 2: 同期を headless で動かす (実装計画)

> 設計: [agent-actor.md](../architecture/step4/agent-actor.md) §2 D3・§4 段 2。
> branch: `step/agent-stage2-headless`。

## 1. 目標と完了基準

ブラウザの外 (bun のプロセス) で、agent の DID として conversensus の File を同期できるようにする。
段 3 (MCP) はこの上に道具を載せるだけになる。

**完了基準**:

1. headless の client が、人間 (ブラウザの App) から招待された File に**参加を承認**できる
2. 人間が書いた編集を **受信**して、trunk の projection として読める
3. headless の client が書いた編集を、人間の App が **受信して表示**できる
4. 1〜3 を **App 結合と同じ世界 (偽の PDS) のテスト**で確かめる
5. 開発用の PDS (`user-test-environment`) で、agent 用のアカウントで 1〜3 を手で確かめる
6. プロセスを止めて起動し直しても、**同じ actor** (`did#deviceId`) として続きから同期する

**非目標**: MCP (段 3)、完全な encoding (段 3)、常駐と firehose の合図での自動の受信 (段 5)。
段 2 の受信は「呼ばれたら同期する」(`syncNow`) でよい。

## 2. 調べて分かったこと (事実)

| # | 事実 | 帰結 |
| --- | --- | --- |
| F1 | ローカル正典は `LocalStore` (shared) で、`SqlDriver` を差し替えられる。bun 用に `BunSqliteDriver` がある | 保存は **file の SQLite 1 つ**で足りる。新しく書くものは無い |
| F2 | client が正典に頼む口は `LocalBackend` で、`storeBackend(store)` が同じプロセスで呼ぶ実装 (App 結合が使っている)。`api.ts` の `setBackend` で差し替える | headless もこれを使う |
| F3 | File 1 つの書き込み・同期・受信は `FileSession` (`sync/fileSession.ts`) に、React の外で既にある | 同期のサイクルは書き直さない |
| F4 | 認証は `setAuthBackend` で差し替えられる。本番は OAuth (ブラウザ)、`passwordAuth` は App 結合専用 | headless 用の認証の実装を 1 つ足す (§4 H4) |
| F5 | 端末の id・セッション・参加の初期化の印などは `localStorage` に置いている (`safeStorage` 経由)。`getDeviceId` は無いと**プロセスごとに新しい id** になる | 完了基準 6 のために、**file に保存する `Storage`** を入れる |
| F6 | `window.addEventListener('online')` が `fileSession.ts`・`liveChannel.ts` にある。bun には `window` が無い | 呼ぶ前に有無を確かめる形に直す (小さな変更) |
| F7 | 参加の発見・名簿・招待の承認の**組み立て**は `useParticipation` (React hook, 453 行) にある。部品 (`discoverParticipatingFiles`・`bootstrapParticipation`・`appendJudgment`・`participationCode`) は React の外 | 組み立ては headless 側に書く。部品は使い回す |
| F8 | `atproto/client.ts` の agent はプロセスに 1 つ | headless のプロセスは agent 1 つ (= DID 1 つ) を前提にする。agent ごとにプロセスを分ける |

### 2.1 H0 の spike の結果 (2026-11-08)

`src/client/spikes/headless/spike.ts` (`bun run` で走る。DOM 無し、`happy-dom` も読まない)。
偽の PDS の上で、alice が File を作って書き、agent を招待 → agent が承認して受信 → agent が書く →
alice (新しい端末) が受信して、**両方の node が見えた。既存の部品の組み立てだけで一周する。**

| # | 分かったこと | どのスライスで扱うか |
| --- | --- | --- |
| S1 | client のモジュールは**読み込みの時点では DOM を触らない**。`window`・`document`・`localStorage` が無くても import できる | — |
| S2 | `oauth-client-browser` が読み込み時に `Locks API not available` と警告する (`atproto/client.ts` が既定の認証として `oauthAuth` を import するため)。害は無いが、headless で OAuth のブラウザ版を読まないように、既定の認証を遅れて作る形にしたい | H4 |
| S3 | bun には `localStorage` が無い。代わりの `Storage` を入れれば、端末の id・セッション・参加の初期化の印がそのまま動く (F5 の確認) | H1 |
| S4 | **処理が終わってもプロセスが終わらない。**何かの timer か接続が event loop を握っている。headless の client に `close()` が要る | H1 |
| S5 | `FileSession.start()` (定期・`online` の契機) は spike では呼んでいない。呼べば F6 の `window` に当たる | H1 |
| S6 | 組み立てに要ったのは、正典・認証・remote キュー・名簿の供給元・発番器・`FileSession`・判断の書き込み (`appendJudgment`) の 7 つ。`useFileSheetOperations`・`useRosterSource`・`useRemoteSyncQueue`・`useParticipation` に散っているものと同じ | H1・H2 |

## 3. 置き場所 (問 P1)

案 A (推奨): **新しい workspace `src/headless` (`@conversensus/headless`)** を作り、client の
`sync/`・`atproto/`・`local/` を**パスで import** する。ファイルは動かさない。

- 境界をきれいに引くのは #310 (同期のライブラリ化) の仕事で、そのときに client と headless の
  両方が新しいパッケージを見るように変える
- 案 B (#310 の段 1 を先にやり、`sync`・`atproto` を別パッケージへ移す) は、`../events`・`../i18n`・
  `../notices`・`../folders` などへの依存をほどく作業が先に立ち、段 2 が大きくなる

## 4. スライス

| | 内容 | 確かめ方 |
| --- | --- | --- |
| H0 | **spike**: bun のテストの中で `LocalStore` (file の SQLite) + `storeBackend` + `FileSession` + 偽の PDS を組み、1 File を同期させる。壊れる所を洗い出す | 洗い出した結果をこの計画に書き足す |
| H1 | headless の土台: `FileStorage` (file に保存する `Storage`)、`window` の有無の確認 (F6)、`createHeadlessClient({ dataDir, auth })` が正典・認証・端末の id を組む | 起動し直しても deviceId が同じ (単体) |
| H2 | 参加: 参加コードで承認する、参加している File を発見する、File を同期する (`syncNow`) | 偽の PDS で、App の利用者が招待 → headless が承認 → 名簿に載る |
| H3 | 読み書き: trunk の Sheet の projection を読む / GraphEvent を流して書く (UI と同じ経路) | 偽の PDS で、完了基準 2・3 (App 結合の世界と行き来する) |
| H4 | 認証: loopback OAuth (`@atproto/oauth-client-node`)。セッションは `dataDir` に置く。テストでは `passwordAuth` 相当を使う | 開発用の PDS でログインできる。`http://localhost` の client_id を PDS が受けるか確かめる |
| H5 | 手で動かす CLI: `login` / `accept <code>` / `files` / `sync <file>` / `show <file>` | 完了基準 5 (開発用の PDS で、ブラウザの人間と行き来する) |

### 4.1 進捗

| | 状態 | メモ |
| --- | --- | --- |
| H0 | 済 | §2.1 |
| H1 | 済 | `src/headless` (workspace)・`FileStorage`・`Headless.open`/`signIn`/`close`。S2・S4 は `atproto/client.ts` から OAuth の import を外して `main.tsx` で入れる形にして解いた (読み込んだだけでプロセスが終わらなくなっていた)。S5 (`start()` の `window`) は段 5 へ — 段 2 は `syncNow` だけを使う |
| H2 | 済 | `createFile`・`sync`・`invite`・`accept`・`discover`・`files`。招待する側も headless で書ける (設計 §1.1) |
| H3 | 済 | `read`・`record`・`settled`。App の alice ↔ headless の agent の App 結合 (`headlessInterop.app-test.tsx`) と、DOM の無い別プロセスでの一周 (`domFree.test.ts`、終わればプロセスが終わることも見る)。**完了基準 1〜4・6 を満たす**。観察: 参加者の catch-up は genesis を自分の repo にも送る (既存の振舞い、`readWrite.test.md`) |
| H4 | 実装済・PDS で未確認 | `oauthLoopback.ts`。`@atproto/oauth-client-node` は使わず核の `@atproto/oauth-client` + `jwk-jose` で組む — node 版が引く DNS の handle 解決 (`handle-resolver-node` → undici 8) が bun で読み込み時に落ちるため。受け口の配線は偽の OAuth client で単体テスト |
| H5 | 実装済・PDS で未確認 | `cli.ts` (login・logout・whoami・accept・files・show・add)。**開発用の PDS が `createSession` も PAR も内部エラーを返す状態**で、完了基準 5 は未確認 (2026-11-08)。agent 用のアカウント `agent.test` も招待コードの発行が内部エラーで作れていない。当面は `bob.test` を agent 役に使える (設計 D1) |

## 5. 決めたこと

- **書く経路は UI と同じ GraphEvent** (`EventSyncTap` が op へ落とす)。op を直接組む口は作らない —
  書く経路を 2 つにすると、ローカルの状態と op-log の projection が食い違いうる (R4 の不変条件)。
  設計 D4 の「道具は op に 1 対 1」は、GraphEvent が op に 1 対 1 で落ちることで満たす (段 3 で確かめる)
- **1 プロセス = 1 agent** (F8)
- 端末の id は `dataDir` に保存し、`did#deviceId` を起動をまたいで保つ (F5)

## 6. 問い

- **P1.** 置き場所は案 A (新しい workspace、ファイルは動かさない) で良いか (§3)
  - → 案 A (利用者 2026-11-08)
