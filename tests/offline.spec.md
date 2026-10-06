# offline.spec.ts — service worker とオフライン起動 (step3 Phase 2 S2-5)

## 何を

- service worker が画面を握った状態でも、ローカル正典 (Worker + SQLite-WASM) が起動すること
- 1 度開いた後は、回線が無くても起動して手元の File を開けること (PWA の完了基準 1 の「オフラインで編集できる」)

## なぜ

service worker は**本番ビルドでだけ**登録する (開発中は Vite の更新と噛み合わない) ので、開発サーバで
走る他の E2E は service worker を一度も通らない。ここだけが本番ビルド (`vite preview`) で開く。

service worker が画面を握ると、Worker のスクリプトや SQLite-WASM の `.wasm` の取得も service worker を
通る。**実際に WebKit で壊れた**: service worker の中で元の Request をそのまま `fetch(request)` すると、
Worker のスクリプトの取得が "Load failed" で落ち、「この窓では保存できません」になった。URL から
取り直す形にして直した。

オフラインで返す画面は、保存した応答のヘッダごと返すので COOP/COEP が残る。残らないと
cross-origin isolation が外れ、SQLite-WASM が開けない。だから `crossOriginIsolated` も見る。

## どのように

開いて、`navigator.serviceWorker.ready` を待ち、service worker が握った状態で開き直す (ここで資源が
service worker のキャッシュに入る)。

| テスト | 見ること |
| --- | --- |
| 🔴 握られた画面でも Worker が起動する | File を作れる。`crossOriginIsolated` が true。未処理例外・コンソールエラーが 0 件。**両エンジン** |
| 🔴 回線が無くても起動する | 回線を切って開き直し、作っておいた File が一覧に出る。`crossOriginIsolated` が true。**Chromium だけ** — Playwright の WebKit は、オフラインのエミュレーション下の再読み込みが内部エラーになる (service worker の扱いは Chromium だけが対応) |

変異で確かめたこと: service worker を `fetch(request)` に戻すと、WebKit の「握られた画面」が落ちる。

## テストしていないこと

- **Safari 実機のオフライン起動と、ホーム画面に入れた PWA** — 自動化では見えない。実機で見る (設計 U1)
- **新しい版が来たときの切り替え** — 設計 U2

## CSP (#284)

preview は本番と同じセキュリティのヘッダ (CSP を含む, `src/client/src/securityHeaders.ts`) を付けるので、
ここは **CSP の下で本番ビルドが起動すること**の検査も兼ねる。違反はコンソールのエラーとして `pageProblems` が拾う。
確かめた変異: `script-src` から `'wasm-unsafe-eval'` を外すと chromium の 2 件が落ちる (SQLite-WASM が compile できない)。
