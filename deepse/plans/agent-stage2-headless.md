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

## 5. 決めたこと

- **書く経路は UI と同じ GraphEvent** (`EventSyncTap` が op へ落とす)。op を直接組む口は作らない —
  書く経路を 2 つにすると、ローカルの状態と op-log の projection が食い違いうる (R4 の不変条件)。
  設計 D4 の「道具は op に 1 対 1」は、GraphEvent が op に 1 対 1 で落ちることで満たす (段 3 で確かめる)
- **1 プロセス = 1 agent** (F8)
- 端末の id は `dataDir` に保存し、`did#deviceId` を起動をまたいで保つ (F5)

## 6. 問い

- **P1.** 置き場所は案 A (新しい workspace、ファイルは動かさない) で良いか (§3)
