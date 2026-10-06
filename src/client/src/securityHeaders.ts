/**
 * 本番の配信 (`infra/caddy/Caddyfile`) と `vite preview` が付けるセキュリティのヘッダ (#284)。
 * **Caddyfile と同じ値であることは `securityHeaders.test.ts` が見る**。preview にも付けるので、
 * 本番ビルドを開く E2E (`offline.spec.ts`) が CSP の違反 (コンソールのエラー) を拾う
 *
 * CSP の各項の理由:
 * - `script-src 'wasm-unsafe-eval'`: ローカル正典の SQLite-WASM を compile する。文字列の eval は許さない
 * - `worker-src blob:`: sqlite-wasm が OPFS の補助 worker を立てる経路に備える
 * - `style-src 'unsafe-inline'`: React Flow と React が要素の `style` 属性で位置を描く
 * - `img-src https: data: blob:`: node の画像は外部の URL・旧データの data URL・PDS の blob を
 *   `blob:` にしたもの。外部の画像を読むかどうかは #287 で決める
 * - `connect-src https:`: OAuth は利用者の DID から PDS と認可サーバを引き、受信は参加者の PDS を
 *   読む。**どの host になるかは利用者次第**なので https に限るところまでにする
 * - `frame-ancestors 'none'`: 他のサイトに枠で埋め込ませない
 */
export type HeaderName = string;
export type HeaderValue = string;

export const CONTENT_SECURITY_POLICY: HeaderValue = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https: blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** HTTP でも付けてよいもの (HSTS は https の配信にだけ付けるので Caddyfile 側にだけ書く) */
export const SECURITY_HEADERS: Readonly<Record<HeaderName, HeaderValue>> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  // 外部の画像やリンクの先に、開いていた画面の URL を渡さない
  'Referrer-Policy': 'no-referrer',
};
