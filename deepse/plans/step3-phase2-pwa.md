# step3 Phase 2: 保存先 (PWA) — 設計

> ステータス: **Q1〜Q4 確定、実装中** / 作成日: 2026-10-01
> 親: [step3 実装計画](./step3-implementation.md) の Phase 2。入力は Phase 0 の
> [S0-4 spike](../spikes/step3-s0-4-opfs-report.md) (SQLite-WASM + OPFS) と、計画の Q3 (ATProto OAuth へ移す)。
>
> **互換性は考えない** (architecture §1.1)。Phase 1 で保存形式を v2 にしたので、ローカルサーバの DB
> (`events-v2.db`) も、本番の API サーバの DB も持ち込まない。

## 0. この Phase で入れるもの

ローカルサーバ (bun + Hono + `bun:sqlite`) と Tauri をやめ、**ブラウザだけで完結する PWA** にする。

| | 変更 |
| --- | --- |
| 1 | eventStore をブラウザ内 (SQLite-WASM + OPFS、dedicated Worker) に移す |
| 2 | サーバの経路が持っていたロジック (File の作成・取り込み・一覧) を client へ移す |
| 3 | ブラウザのタブごとに別の actor を持つ |
| 4 | PWA 化 (manifest・service worker・`storage.persist()`・未同期の表示) |
| 5 | 認証を ATProto OAuth へ移す (app password をやめる) |
| 6 | Tauri・ローカルサーバ・本番の API サーバを撤去する |

---

## 1. コードを読んで判明した事実

🔵 = コードまたは実行で確認 / ⚪ = 推論・仕様の読み・未確認

### F1: 継ぎ目は `api.ts` の 9 関数である

🔵 client がローカルサーバを叩くのは `api.ts` (175 行) の `fetchFiles` / `fetchLocalFileIds` /
`createFile` / `postImportFile` / `pushBatches` / `pushReceivedBatches` / `fetchBatches` / `putBlob` /
`fetchBlob` だけである (Phase 1 の掃除で branch / commit の経路が消え、File の削除も ANA-127 で
op-log の `file.remove` になった)。どれも既に `Promise` を返すので、**向こう側が Worker への
メッセージになっても関数の形は変わらない**。

### F2: サーバの経路は保存以外のロジックも持っている

🔵 `server/src/index.ts` の経路は、eventStore を呼ぶだけでなく次を持つ。

- **File の作成**: id を振り、genesis の op-log を作る (`initializeOplog`)
- **取り込み**: `.conversensus` を `parseConversensusFile` で読み、batch に直して追記する
- **一覧**: `listOplogFiles` が全 File を畳んで名前を出す (0 シートの branch を除く)
- **受信の追記**: `appendReceivedBatches` が schema marker (W3) を立てる
- **blob**: cid をサーバ側で計算し、サイズ上限 (5 MiB) を enforcement する
- **旧 snapshot の移行**: `migrateAllToOplog` / `storage.ts`。**v2 では読むものが無い** (死んでいる)

どれも `shared` の関数の組み合わせで、bun に固有なのは `bun:sqlite` と `randomUUID` だけである。

### F3: 本番の Web 版は、全利用者で 1 つの DB を共有していた

🔵 試験リリース (2026-05) の構成は `app.conversensus.site` (静的配信) が `api.conversensus.site`
(bun/Hono、`DATA_DIR` 1 つ) を叩く。**「端末のローカル正典」が、Web 版では全利用者で共有される
1 つの DB だった。**op-log は File ごとに分かれているので壊れはしないが、他人の File が一覧に
出うるし、正典の意味 (自分の端末の記録) とずれている。PWA 化はこれを構造的に解く。

### F4: ブラウザのタブは同じ actor を名乗る

🔵 deviceId は `localStorage` (`conversensus_device_id`) にあり、同じ origin のタブはすべて同じ
actor (`<did>#<deviceId>`) になる。タブはそれぞれ自分の `CausalClock` を持つので、**2 つのタブが
同じ点 (actor, seq) を発番する**。PDS の rkey は点で決まる (`<fileId>~<actor>~<seq>`) ので
**後から書いた方が前の batch を上書きする** (`putRecord`)。因果の判定 (`happenedBefore` は同じ actor
なら seq の大小) も壊れる。

いまは Tauri の 1 窓が本番なので潜在しているだけで、**PWA ではタブを 2 つ開くのは普通のこと**である。

⚪ OPFS の同期アクセス (`FileSystemSyncAccessHandle`) は dedicated Worker にしか公開されていない
(仕様の読み)。**DB を SharedWorker に 1 つだけ置いてタブで共有する形は取れない。**S0-4 で
確かめたとおり、`opfs` VFS なら各タブの Worker が同じ DB に接続を持てる。

### F5: テストの基盤がサーバに依っている

🔵 E2E は Playwright の `webServer` で bun のサーバを起動する。App 結合 (`appWorld.ts`) は
**本物の Hono アプリをプロセス内で呼ぶ** (`fetch` を `http://localhost:3000` で差し替える)。
App 結合は bun で走るので Worker も OPFS も無い。

🔵 S0-4: WebKit の使い捨ての context (Playwright の既定) は OPFS を拒む。**E2E は
`launchPersistentContext` で走らせる必要がある。**

### F6: 認証は 1 つの PDS に固定された app password である

🔵 `atproto/client.ts` は `VITE_ATPROTO_PDS_URL` (既定 `http://localhost:2583`) に `AtpAgent` で
パスワードログインし、セッションを `localStorage` に置く。handle から PDS を引く処理は無い。

⚪ ATProto OAuth のブラウザ向けクライアント (`@atproto/oauth-client-browser`) は、client metadata を
**公開された https の origin** に置く必要がある (開発時は loopback の client が使える)。
開発用の PDS (`infra/pds`、Caddy で `https://localhost`) で OAuth が通るかは未確認である。

### F7: 利用者が URL で指した画像は、COEP の下で出なくなりうる

🔵 S0-4 の結論は `opfs` VFS で、これは COOP/COEP (`require-corp`) を要る。PDS の画像は `fetch` →
object URL で出しているので影響しない。しかし **画像 node は利用者が入力した任意の URL を
`<img src>` に入れる** (`app.conversensus.imageUrl`)。`require-corp` の下では、相手が
CORP / CORS を返さない画像は読めない。

⚪ `COEP: credentialless` なら緩められるが、Safari が解さなければ cross-origin isolation 自体が
外れ、`opfs` VFS が動かなくなる (SharedArrayBuffer が無い)。**Safari を本命にする以上
`require-corp` から始める。**

---

## 2. 決めたこと (D)

### D1: eventStore を SQL ドライバ非依存にして `shared` へ移す

`EventStore` は SQL を組み立てて結果を型に戻すだけで、bun 固有なのは `Database` の呼び方である。
小さなドライバの口 (`exec` / `run` / `all` / `get` / `transaction`) を挟み、実装を 2 つ持つ。

- **`bun:sqlite`**: 単体・App 結合 (プロセス内で本物のロジックを通す)
- **SQLite-WASM (`opfs` VFS)**: ブラウザ。dedicated Worker の中で動く

**ロジックが 1 つであることが要点である。**テストが bun で通したものと、ブラウザで動くものが
同じコードになる。

### D2: サーバの経路のロジックを client の「ローカル正典」層へ移す

F2 のロジック (作成・取り込み・一覧・受信の追記・blob) を `localStore` (仮) に集める。
`api.ts` の 9 関数はこれを呼ぶだけになる。**HTTP のバリデーション層は消える**が、PDS から
受け取ったものの検証は受信の側 (既に Zod で読んでいる) に残る。

旧 snapshot の移行 (F2 の最後) は持ち込まない。

### D3: DB は各タブの dedicated Worker が持つ

`opfs` VFS は同じ DB に複数の接続を許す (S0-4 で確認)。各タブが自分の Worker を立て、`api.ts` は
Worker への RPC になる。**他のタブの書き込みは BroadcastChannel で知らせ**、受け取ったタブは
受信と同じ経路 (`receiveEpoch` の読み直し) で画面を差し替える。

### D4: タブごとに別の actor を持つ (Q1)

F4 の解。deviceId を「端末に 1 つ」から「同時に開いているタブに 1 つ」にする。既定案は
**`localStorage` に deviceId の溜まり (pool) を持ち、タブは Web Locks で 1 つを借りる**形である
(`navigator.locks.request(id, { ifAvailable: true })` を取れた id を使い、全部借りられていれば
新しく作って溜まりに足す)。タブを閉じれば lock が外れ、次のタブが同じ id を使う。

- actor の数が「同時に開いたタブの最大数」で頭打ちになる (vector が伸び続けない。Phase 1 の
  U2 = actor の退役規則を急がずに済む)
- 再読み込みしたタブは同じ id を取り直せることが多く、seq は `restore` の続きから振る
- **同じ id を 2 つのタブが同時に持つことは無い** (lock が排他を保証する)

### D5: 保存できないときは編集させない

S0-4 の注意 1。OPFS が開けない (プライベートブラウズなど) とき、黙ってメモリ上の DB に落とすと
閉じた瞬間に編集が消える。**「この窓では保存できない」を出し、編集を始めさせない。**

### D6: 未同期の編集を常に見えるようにする

ITP は操作の無い Web アプリの保存領域を消すことがある (S0-4 の注意 3)。PDS へ送れていない batch が
あることを、画面のどこかに常に出す (既存の `SyncStatusIndicator` を広げる)。`persist()` は起動時に
求める。

### D7: 認証は ATProto OAuth (Q3 確定済み)、handle から PDS を引く

`@atproto/oauth-client-browser` を使い、利用者は handle を入れる。PDS は handle から引く
(`VITE_ATPROTO_PDS_URL` の固定をやめる)。**招待は同じ PDS に限る規則 (`isLocalDid`) は変えない**
— ログインできることと、招待できる相手の範囲は別の話である。

テストは認証の境界を差し替える (App 結合は既にセッションを `localStorage` で与えている。OAuth の
セッションは IndexedDB に入るので、境界を 1 枚の口にしてそこを差し替える)。

### D8: 配信は `app.conversensus.site` の静的配信 + COOP/COEP (Q2)

`require-corp` を Caddy (本番) と Vite (開発) の両方で付ける。client metadata (`client-metadata.json`)
を `public/` に置く。**`api.conversensus.site` (bun のサーバ) は止める。**Tauri の配布もやめる
(インストールは PWA で行う)。

---

## 3. スライス

| | 内容 | テスト |
| --- | --- | --- |
| **S2-1** ✅ | eventStore をドライバ非依存にして `shared` へ (D1)。サーバは `bun:sqlite` ドライバで同じものを使う — **振る舞いは変えない** | 既存の eventStore テストがそのまま通る |
| **S2-2** ✅ | 経路のロジックを `localStore` へ (D2)。`api.ts` を「バックエンド」の口の上に載せ、実装を HTTP とプロセス内 (`bun:sqlite`) の 2 つにする。**App 結合をプロセス内に切り替え、Hono を外す** | 単体 + App 結合 |
| **S2-3** ✅ | ブラウザのバックエンド (D3): Worker + SQLite-WASM (`opfs`) + RPC。Vite に COOP/COEP。開けないときの画面 (D5)。既定をこちらに切り替える。E2E を persistent context に | E2E (WebKit / Chromium) |
| **S2-4** ✅ | タブの actor (D4) と、タブ間の知らせ (D3 の BroadcastChannel) | 単体 (溜まりの借り方) + E2E (2 タブで同じ File を編む: 点が重ならない、相手のタブに出る) |
| **S2-5** ✅ | PWA 化: manifest・service worker (オフラインで起動)・`persist()`・未同期の表示 (D6)。COEP の下の画像 (Q4) | E2E (オフライン起動) |
| **S2-6** ✅ | ATProto OAuth (D7)。**最初に spike**: 開発用の PDS で loopback client が通るか | 単体 + 実機 |
| **S2-7** | 撤去: `src/server/`・`src-tauri/`・Tauri 関係の E2E と設定・`api.conversensus.site` の手順。本番の Caddy に COOP/COEP (D8) | lint / typecheck / test / E2E |

S2-1 と S2-2 は**今の形のまま動く**ことを保つ (サーバがまだ居る)。S2-3 で既定を切り替え、
S2-7 でサーバを消す。途中のどこで止めても main が動く順にしてある。

---

## 4. 着手前に訊くこと (Q)

**すべて既定案で確定した (2026-10-01)。**

| | 問い | 既定案 |
| --- | --- | --- |
| **Q1** | タブごとの actor をどう持つか (F4) | **deviceId の溜まり + Web Locks** (D4)。対案: (b) タブを開くたびに新しい actor (actor が増え続ける) / (c) 書けるのは 1 つのタブだけにする (他のタブは読むだけ) |
| **Q2** | `api.conversensus.site` を止め、Tauri の配布をやめてよいか (F3・D8) | **止める・やめる。**既存のデータは v2 で読めないので移さない。VPS の作業 (Caddy の設定・サービスの停止) は手順を書き、実行は利用者が行う |
| **Q3** | 開発用 PDS で OAuth が通らなかったとき (F6) | **開発ビルドに限り app password のログインを残す** (本番ビルドからは消す)。テストは認証の境界を差し替えるので影響しない |
| **Q4** | 利用者が URL で指した画像が COEP で出ないこと (F7) | **受け入れる。**`<img crossorigin="anonymous">` にして CORS を返す画像は出し、出ないものには「この URL の画像は表示できません。画像をドロップすると保存されます」と出す。対案: `opfs-sahpool` (COEP 不要) にして、2 つ目以降のタブを読むだけにする (Q1 の c と同じ形) |

---

## 5. やらないこと (N)

- **actor の退役規則** (Phase 1 の U2)。D4 で actor の数が頭打ちになるので急がない
- **per-actor cursor** (S0-3 の帰結)。v2 の rkey はこれを持てる形にしてあるが、同期量の削減は
  この Phase の目的ではない
- **移行**。ローカルサーバ・本番 API サーバ・Tauri のデータは読まない
- **通知とフォルダ** (Phase 6)

## 6. 未決 (U)

- **U1**: Safari 実機での `persist()` と ITP の消去 (S0-4 の注意 3)。S2-5 の後に実機で見る
- **U2**: service worker の更新の出し方 (新しい版が来たとき、開いているタブをどうするか)
- **U3** (S2-3 で決着): Worker の RPC は自前で書いた (`local/worker/protocol.ts`)。運ぶのは 9 関数の呼び出しと起動の結果と開発時の契約の検査だけで、ライブラリを足すほどの量ではない

## 7. 実装の記録

### S2-1 eventStore を SQL ドライバ非依存にして shared へ (2026-10-01)

`EventStore` を `src/server` から `src/shared/src/store/` へ移し、DB の呼び方を `SqlDriver`
(`exec` / `run` / `all` / `get` / `transaction` / `close`、同期) の口に寄せた。`bun:sqlite` の
実装 (`BunSqliteDriver`) はブラウザの bundle に入れないよう `index.ts` から出さず、使う側が
パスで import する。サーバは同じ `EventStore` を `BunSqliteDriver` で使う — **振る舞いは変えていない**
(SQL も pragma もそのまま)。

ドライバの契約は `sqlDriverContract.ts` に、テストの道具に依らない関数の列として書いた。
S2-3 で SQLite-WASM のドライバにブラウザの中で同じ契約を当てる。

旧 snapshot の移行 (`migrateToOplog`) も一緒に移した (S2-1 は振る舞いを変えないため)。
v2 では読むものが無いので、S2-7 でサーバと一緒に消す。

#### 検証

単体 1887 件・App 結合 7 件・E2E が緑。client のビルドに `bun:sqlite` が混ざらない。
トランザクションを巻き戻さない変異で契約の 1 件が落ちる。

### S2-2 経路のロジックを LocalStore へ、App 結合をプロセス内に (2026-10-01)

サーバの経路が持っていたロジック (作成・取り込み・一覧・受信の追記・blob の検査) を
`shared/src/store/localStore.ts` の `LocalStore` に集めた。サーバの経路は要求の形の検証と
状態コードだけを持つ薄い包みになった。正典の marker の版も `LocalStore` が持つ
(`OPLOG_SCHEMA_VERSION`。サーバの `W3_SCHEMA_VERSION` はこれを指す)。

client の `api.ts` は 9 関数の形を保ったまま、差し替えられるバックエンド (`local/backend.ts` の
`LocalBackend`) に委ねるようにした。実装は `httpBackend` (今の既定) と `storeBackend`
(`LocalStore` を同じスレッドで呼ぶ)。`storeBackend` は HTTP と同じく、書く batch と読んだ batch を
`BatchSchema` で読み直す — 既定値の補完まで揃えないと、経路によって畳み込みの入力が変わる。

App 結合 (`appWorld.ts`) は Hono を経由せず、端末ごとにインメモリの `LocalStore` を持って
`setLocalBackend` で切り替えるようにした (`DATA_DIR` と一時ディレクトリが要らなくなった)。
誰も使っていなかった観測口 `localServer` は、端末の `LocalStore` を返す `localStore` に替えた。

#### 検証

単体 1902 件・App 結合 7 件・E2E が緑。`storeBackend` の受信の追記を捨てる変異で App 結合の
6 件が落ちる (App 結合がこの経路を確かに通っている)。

### S2-3 ブラウザのバックエンド (2026-10-01)

SQLite-WASM を `opfs` VFS で開く dedicated Worker (`local/worker/localStore.worker.ts`) を置き、
その中で **App 結合と同じ `storeBackend(LocalStore)`** を動かす。main 側の `workerBackend` は
`LocalBackend` の 9 関数をそのまま RPC にする。SQL ドライバ `WasmSqliteDriver` は oo1 API の上に
`SqlDriver` を載せたもの。

起動 (`main.tsx`) は**保存領域が開けたかを確かめてから**描く。開けなければ
`StorageUnavailable` (「この窓では保存できません」) を出し、編集させない (D5)。Vite の dev / preview に
COOP/COEP を付けた (D8)。

E2E は `tests/fixtures.ts` で、テストごとに新しいプロファイルの persistent context で走らせる。
デーモンの起動は E2E から外した (デーモンそのものは S2-7 で撤去)。

`api.ts` の既定は `httpBackend` のままで、`main.tsx` が起動時に Worker のバックエンドへ
差し替える。単体テストの既定を変えないためで、`httpBackend` は S2-7 で消す。

#### 分かったこと

- **既存の E2E 24 件が、そのまま OPFS の上で両エンジンとも通った** (画像の drop も Worker 経由)。
  hooks から上が `api.ts` の 9 関数しか見ていない (事実 1) ことの裏付けになった
- 保存領域の無い窓 (WebKit の使い捨て context) では、`OpfsDb` の判定に 9 秒ほどかかる
  (sqlite-wasm が OPFS の導入を待つ)。その間は白い画面になる。起動中の表示は S2-5 で足す

#### ⚠️ 本番への影響

**この版を `app.conversensus.site` に出すには、Caddy に COOP/COEP を足す必要がある。**
足さずに出すと、全員が「この窓では保存できません」になる。配信の手順は S2-7 でまとめて書く。

#### 検証

単体 1902 件・App 結合 7 件・E2E 29 件 (1 件は Chromium で skip) が緑。Worker の DB をメモリに
する変異で「再読み込みの後も残る」が、ドライバのトランザクションを外す変異で「ドライバの契約」が
落ちる。

### S2-4 タブごとの actor と、タブ間の知らせ (2026-10-01)

起動時 (`main.tsx`) に `claimDeviceId` (`local/deviceClaim.ts`) で deviceId の溜まりから 1 つを
Web Locks で借り、描画の前に `setClaimedDeviceId` で決める。溜まりの先頭は従来の deviceId なので、
1 つ目のタブはこれまでと同じ actor になる。Web Locks が無い環境 (bun のテスト・古いブラウザ) は
従来どおり端末に 1 つである。

書いたら `broadcastingBackend` (`local/localChanges.ts`) が BroadcastChannel で知らせる。受けたタブは
tap (`useEventSyncTap`) が**因果の知識に取り込んでから** `onLocalChanged` を呼び、
`useFileSheetOperations` は #202 の経路 (`refreshIfStale` — `handleSynced` から切り出した) で画面を
差し替え、一覧も読み直す。

#### 分かったこと

- **画面に出すだけでは足りない。**別のタブの書き込みを因果の知識に入れないと、それを見た上で
  書いた batch の deps に載らず、Phase 1 の並行の判定で偽の競合になる。画面からは見えないので
  App 結合で固定した (`causal.restore` を外す変異で落ちる)
- 既存の #202 の経路 (「手元の正典に、画面に出ていない他の actor の batch がある」) がそのまま
  使えた。タブごとに actor を分けたことで、別のタブの書き込みが「他の actor の batch」として
  数えられるからである。足りなかったのは契機だけだった

#### 検証

単体 1911 件・App 結合 8 件・E2E 33 件 (1 件は Chromium で skip) が緑。E2E は 2 つの page で、別の
deviceId になることと、閉じた id の再利用と、作った File と置いたノードが再読み込みなしに出ることを
見る (両エンジン)。

### S2-5 PWA 化 (2026-10-01)

- **manifest とアイコン** (`public/manifest.webmanifest`、`icon-192.png` / `icon-512.png`)。アイコンは
  `scripts/generateIcons.ts` が描く**仮のもの**で、正式なものができたら差し替える
- **service worker** (`public/sw.js`, 本番ビルドだけ登録)。画面はネットワークを先に、同じ origin の
  他の GET はキャッシュを先に。別の origin (PDS) には触らない
- **起動中の表示** (`Starting`)。保存領域の無い窓で数秒白いままだった (S2-3 の記録)
- **`persist()`** を起動時に求める。断られても動く (頼れるのは PDS と未同期の表示)
- **未ログインのときに「この端末にだけ保存されています」** (D6)。ログイン中の未同期件数は既に出ていた
- **URL で指した画像** (Q4): `crossorigin="anonymous"` で読み、読めなければドロップを案内する

#### 分かったこと

- **WebKit では service worker の中の `fetch(request)` が Worker のスクリプトで落ちる。**元の Request を
  渡し直すと "Load failed" になり、Worker が起動できず「この窓では保存できません」になった。
  URL から取り直す形にして直した。本番ビルドでしか service worker を登録しないので、開発サーバで
  走る E2E では見えない — 本番ビルドを配る E2E を足して初めて見つかった
- Playwright の WebKit では、オフラインのエミュレーションと service worker の組み合わせを確かめられない
  (再読み込みが内部エラー)。オフライン起動は Chromium で見て、WebKit は実機で見る (U1)

#### 検証

単体 1915 件・App 結合 8 件・E2E 36 件 (Chromium で 1 件、WebKit で 1 件 skip) が緑。
service worker を `fetch(request)` に戻すと WebKit の「握られた画面」が落ちる。

### S2-6 ATProto OAuth (2026-10-01)

#### spike: 開発用 PDS で OAuth が通るか

**通った** (利用者が実機で確認)。`@atproto/oauth-client-browser` の loopback client
(`http://127.0.0.1:<port>`) と `allowHttp` で、開発用 PDS に OAuth でログインし、そのセッションで
`describeRepo` を読めた (台本 `src/client/spikes/oauth/`, 投棄可)。

途中で分かったこと:

- **開発用 PDS の公開 URL がずれていた。**dev mode の PDS は自分を `http://localhost:3000`
  (コンテナの中のポート) と名乗り、**アカウントの DID 文書もそこを指していた** (plc.directory に
  登録済み)。ホストには `:2583` で出していたので、OAuth (issuer へ直接届く必要がある) が通らない。
  いまのアプリが動いていたのは、PDS の URL を `:2583` に固定して DID 文書を引いていなかったから
  である。**ホストの `:3000` で公開し直した** (`infra/pds/docker-compose.yml`)。`:3000` はローカル
  サーバが使っていたが、S2-3 からアプリは使っていないので止めてもらった
- Q3 の退避策 (開発ビルドだけ app password) は**要らなくなった**

#### 実装

- **認証の口** (`atproto/auth.ts` の `AuthBackend`): 既定は `oauthAuth.ts` (本番と開発)。App 結合
  テストは偽の PDS に `passwordAuth.ts` でログインする (OAuth の同意画面は自動化できない)。
  パスワードの実装はテストの道具だけが import するので、本番の bundle に入らない
- `atproto/client.ts` の窓口 (`getAgent` / `currentDid` / `login` / `resumeSession` / `logout`) は形を
  保ち、口に委ねる。PDS の URL は `VITE_ATPROTO_PDS_URL` (既定 `http://localhost:3000`)。blob の
  生の URL は、OAuth のセッションの `getTokenInfo().aud` (自分の PDS) から組む
- **本番**: client metadata を配信元の `/client-metadata.json` から読む (`BrowserOAuthClient.load`)。
  `client_id` はその URL そのもの (`https://app.conversensus.site/client-metadata.json`)。
  **開発**: loopback client。scope は `atproto transition:generic` (レコードを書くため。loopback の
  既定は `atproto` だけ)。戻り先は `http://127.0.0.1:<port>/`
- handle の解決は自分たちの PDS に頼む (Bluesky の公開サービスに handle と IP を渡さない)
- ログインのダイアログは、OAuth ではパスワード欄を出さない

- **`localhost` では起動時に OAuth を触らない。**ライブラリの `init()` は `localhost` を見ると
  その場で `127.0.0.1` へ移動する (戻り先と IndexedDB の origin を揃えるため)。起動時に復元を
  呼ぶと、`localhost` で開いた画面が勝手に移動し、**Chromium の E2E が全滅した**。`localhost` では
  復元せず、ログインを押したときだけ `127.0.0.1` へ移す。パスワードの実装が本番の bundle に
  入っていないことも確かめた (その実装だけが持つ文字列が bundle に無い)

#### 確かめていないこと

- **OAuth のセッションでレコードを書くこと** (op-log の送信・判断ログ・blob の upload)。spike は
  読むだけだった。scope (`transition:generic`) で足りるはずだが、実機で確かめる
- **本番の PDS** (`pds.conversensus.site`) での OAuth。配信 (S2-7) の後に確かめる

#### 検証

単体 1918 件・App 結合 8 件・E2E 36 件 (2 件 skip) が緑 (App 結合はパスワードの認証で、偽の PDS に対して)。
