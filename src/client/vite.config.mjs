import { execSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import packageJson from './package.json' with { type: 'json' };
import { SECURITY_HEADERS } from './src/securityHeaders.ts';

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

/**
 * **この build の印** (#262)。開いているタブは配信の `version.json` をこれと見比べ、違えば
 * 「新しい版があります」を出す。commit が同じでも build し直せば変わるよう、時刻を足す
 */
function buildIdOf() {
  let commit = 'nogit';
  try {
    commit = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    // git の無い所で build しても止めない。時刻だけで足りる
  }
  return `${packageJson.version}+${commit}.${Date.now().toString(36)}`;
}

const BUILD_ID = buildIdOf();
/** 配信の印の置き場所。`src/update/appUpdate.ts` の `VERSION_PATH` と揃える */
const VERSION_FILE = 'version.json';

/** build の成果物に `version.json` を足す (開発サーバでは出さない — 確かめるのは本番だけ) */
const emitVersionFile = {
  name: 'conversensus-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: VERSION_FILE,
      source: JSON.stringify({ build: BUILD_ID }),
    });
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), emitVersionFile],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: { host: DEV_HOST, headers: CROSS_ORIGIN_ISOLATION_HEADERS },
  // 開発サーバは HMR と React Refresh が inline の script を使うので、CSP は本番ビルドの配信にだけ付ける
  preview: {
    host: DEV_HOST,
    headers: { ...CROSS_ORIGIN_ISOLATION_HEADERS, ...SECURITY_HEADERS },
  },
  // sqlite-wasm は自分の .wasm を相対で引くので、事前バンドルに入れない (公式の注意)
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
});
