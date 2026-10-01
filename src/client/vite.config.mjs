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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { headers: CROSS_ORIGIN_ISOLATION_HEADERS },
  preview: { headers: CROSS_ORIGIN_ISOLATION_HEADERS },
  // sqlite-wasm は自分の .wasm を相対で引くので、事前バンドルに入れない (公式の注意)
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
});
