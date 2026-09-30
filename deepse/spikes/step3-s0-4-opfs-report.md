# S0-4 spike: SQLite-WASM + OPFS (2026-09-30)

step3 Phase 0 S0-4 / [実装計画](../plans/step3-implementation.md) の U2。
Phase 2 (PWA 化) でローカルサーバ (bun + `bun:sqlite`) をブラウザ内へ移すとき、
保存先を **SQLite-WASM + OPFS** にできるかを確かめた。

- 版: `@sqlite.org/sqlite-wasm` 3.53.4
- 実行: Playwright 1.x の WebKit (Desktop Safari) / Chromium (Desktop Chrome)、macOS
- 台本: `src/client/spikes/opfs/` (投棄可)。
  `bunx playwright test -c src/client/spikes/opfs/playwright.config.ts`
- 負荷: batch レコード相当の行 (本文 約 600 バイト、S0-3 の実測に合わせた) を 5000 行

**🔴 = 実行して確認 / ⚪ = 推論・未確認**

## 結論

**SQLite-WASM + OPFS は使える。VFS は `opfs` を選び、COOP/COEP ヘッダを配信する。**

| | `opfs` | `opfs-sahpool` |
| --- | --- | --- |
| 前提 | **COOP/COEP が必要** (SharedArrayBuffer) | ヘッダ不要 |
| WebKit で動く | 🔴 動く (保存領域のある context) | 🔴 動く (同) |
| Chromium で動く | 🔴 動く | 🔴 動く |
| 再読み込み後に残る | 🔴 両エンジンで残る | 🔴 両エンジンで残る |
| **2 つ目のタブから開ける** | 🔴 **開ける** (両エンジン、1 つ目が接続を持ったままでも) | 🔴 **開けない** (Chromium: `NoModificationAllowedError`、WebKit: `InvalidStateError`) |

`sahpool` は 1 つの origin で同時に 1 つの接続しか持てず、**1 つ目のページの worker が
生きている限り pool を握り続ける** (DB を close しても放さない)。利用者がブラウザのタブを
2 つ開くのは普通のことなので、`sahpool` を選ぶと 2 つ目のタブが必ず壊れる。
アプリ内タブ (Phase 3) は 1 つのページの中なので問題ないが、ブラウザのタブは防げない。

## 数値 (🔴, 5000 行、保存領域のある context)

| | 開く | 5000 行の挿入 (1 トランザクション) | 全件読み出し |
| --- | ---: | ---: | ---: |
| WebKit `opfs` | 39〜62 ms | 69 ms | 20〜46 ms |
| WebKit `sahpool` | 30〜36 ms | 41 ms | 21〜24 ms |
| Chromium `opfs` | 35〜87 ms | 69〜132 ms | 16〜73 ms |
| Chromium `sahpool` | 28〜93 ms | 55〜126 ms | 15〜60 ms |

どれも S0-3 の「畳み込み」と同じ桁で、保存先が律速になることはない。

## 注意点

### 1. プライベートブラウズでは使えない可能性が高い

🔴 Playwright の既定の context (使い捨て = ephemeral) では、WebKit が OPFS の SyncAccessHandle を
`UnknownError: The operation failed for an unknown transient reason` で拒んだ。同じ操作が
保存領域のある context (`launchPersistentContext`) では通った。

⚪ Safari のプライベートブラウズがこれに当たると考えられる。**開けなかったときに黙って
メモリ上の DB に落とすと、閉じた瞬間に編集が消える。**「この窓では保存できない」と
はっきり出すこと (Phase 2 の受入基準に入れる)。

### 2. COOP/COEP を付けると、別 origin の資源の読み込みが制限される

⚪ `Cross-Origin-Embedder-Policy: require-corp` の下では、別 origin の資源は
CORS か `Cross-Origin-Resource-Policy` が無いと読めない。PDS の blob (画像) を
`<img src=別 origin>` で出している箇所があれば壊れる。`fetch` で取って object URL にしている
なら影響は無い。**Phase 2 で画像の読み込み経路を確かめる。**`COEP: credentialless` で
緩められるが、Safari の対応は未確認。

### 3. `navigator.storage.persist()` は自動化では確かめられない

🔴 両エンジンとも `persist()` は `false` を返した (自動化されたブラウザは許可を出さない)。
⚪ Safari の ITP は、ホーム画面に入れていない Web アプリの保存領域を、一定期間操作が
無いと消すことがある。**実機で確かめる必要がある。**未同期の op が消えうるので、
Phase 2 で「未同期の編集がある」ことを常に見えるようにしておく。

### 4. 使えるかの判定は `sqlite3.oo1.OpfsDb` の有無で行う

🔴 `'opfs' in sqlite3` は `opfs` VFS が入っていても false だった (この spike で最初に誤った)。
型定義の注のとおり `sqlite3.oo1.OpfsDb` を見る。

## Phase 2 への入力

- **S2-1 の既定案 (SQLite-WASM + OPFS) で進めてよい。VFS は `opfs`**
- 配信に COOP/COEP を付ける (Vite の dev サーバ、本番の Caddy の両方)
- 開けないとき (プライベートブラウズなど) は編集させず、理由を出す
- 画像の読み込み経路を COEP の下で確かめる
- 実機の Safari で `persist()` と保存領域の消去を確かめる (自動化では見えない)
