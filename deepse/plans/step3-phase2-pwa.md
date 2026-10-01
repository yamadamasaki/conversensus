# step3 Phase 2: 保存先 (PWA) — 設計

> ステータス: **起草 (Q1〜Q4 待ち)** / 作成日: 2026-10-01
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
| **S2-1** | eventStore をドライバ非依存にして `shared` へ (D1)。サーバは `bun:sqlite` ドライバで同じものを使う — **振る舞いは変えない** | 既存の eventStore テストがそのまま通る |
| **S2-2** | 経路のロジックを `localStore` へ (D2)。`api.ts` を「バックエンド」の口の上に載せ、実装を HTTP とプロセス内 (`bun:sqlite`) の 2 つにする。**App 結合をプロセス内に切り替え、Hono を外す** | 単体 + App 結合 |
| **S2-3** | ブラウザのバックエンド (D3): Worker + SQLite-WASM (`opfs`) + RPC。Vite に COOP/COEP。開けないときの画面 (D5)。既定をこちらに切り替える。E2E を persistent context に | E2E (WebKit / Chromium) |
| **S2-4** | タブの actor (D4) と、タブ間の知らせ (D3 の BroadcastChannel) | 単体 (溜まりの借り方) + E2E (2 タブで同じ File を編む: 点が重ならない、相手のタブに出る) |
| **S2-5** | PWA 化: manifest・service worker (オフラインで起動)・`persist()`・未同期の表示 (D6)。COEP の下の画像 (Q4) | E2E (オフライン起動) |
| **S2-6** | ATProto OAuth (D7)。**最初に spike**: 開発用の PDS で loopback client が通るか | 単体 + 実機 |
| **S2-7** | 撤去: `src/server/`・`src-tauri/`・Tauri 関係の E2E と設定・`api.conversensus.site` の手順。本番の Caddy に COOP/COEP (D8) | lint / typecheck / test / E2E |

S2-1 と S2-2 は**今の形のまま動く**ことを保つ (サーバがまだ居る)。S2-3 で既定を切り替え、
S2-7 でサーバを消す。途中のどこで止めても main が動く順にしてある。

---

## 4. 着手前に訊くこと (Q)

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
- **U3**: Worker の RPC を自前で書くか、小さなライブラリ (Comlink など) を使うか。S2-3 で決める

## 7. 実装の記録

(スライスごとに追記する)
