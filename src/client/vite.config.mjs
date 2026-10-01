import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * **cross-origin isolation を有効にする** (step3 Phase 2 D8)。ローカル正典の SQLite-WASM は
 * `opfs` VFS で開き、これは SharedArrayBuffer を要る (S0-4)。本番の配信 (Caddy) にも同じ
 * ヘッダを付ける
 */
const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/**
 * **IPv4 の loopback で待ち受ける** (step3 Phase 2 S2-6)。ATProto OAuth の loopback client は
 * 戻り先が `http://127.0.0.1:<port>/` でなければならない。Vite の既定 (`localhost`) は macOS では
 * IPv6 の `[::1]` にだけ待ち受けるので、`127.0.0.1` へ戻ると「接続できません」になった。
 * `localhost` で開いてもブラウザは `127.0.0.1` に落ちて届く
 */
const DEV_HOST = '127.0.0.1';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { host: DEV_HOST, headers: CROSS_ORIGIN_ISOLATION_HEADERS },
  preview: { host: DEV_HOST, headers: CROSS_ORIGIN_ISOLATION_HEADERS },
  // sqlite-wasm は自分の .wasm を相対で引くので、事前バンドルに入れない (公式の注意)
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
});
