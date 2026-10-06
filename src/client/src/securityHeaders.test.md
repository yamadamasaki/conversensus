# securityHeaders.test.ts

## 何を

本番の配信 (`infra/caddy/Caddyfile`) が付けるセキュリティのヘッダ (CSP・nosniff・Referrer-Policy・HSTS, #284) と、
その値の原本 `securityHeaders.ts`。

## なぜ

ヘッダは 2 か所に書く — 本番の Caddy と、本番ビルドを配る `vite preview`。preview に付けるのは、本番ビルドを開く
E2E (`offline.spec.ts`) が CSP の違反をコンソールのエラーとして拾えるようにするため (`tests/pageProblems.ts`)。
**2 か所の値がずれると、E2E が緑でも本番だけが壊れる**(あるいは本番だけ守りが無い)。Caddyfile は TS から
import できないので、テストで突き合わせる。

## どのように

- Caddyfile を読み、`app.conversensus.site { … }` の中の `header` の行を名前 → 値に起こして、
  `SECURITY_HEADERS` のすべてと一致することを見る
- HSTS は https の配信にだけ付けるので Caddyfile 側にだけある。app と PDS の両方にあることを見る
- CSP が守りの要の 3 項 (`'unsafe-eval'` が無い・`frame-ancestors 'none'`・`object-src 'none'`) を外していないこと

CSP が実際に画面を壊さないことはここでは見ない。それは E2E (preview) と実機の役目。
