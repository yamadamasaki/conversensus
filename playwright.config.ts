import { defineConfig, devices } from '@playwright/test';

/**
 * WebKit 適合の E2E (ANA-125)
 *
 * 目的は「Safari で壊れるものを機械判定する」ことである。設計は
 * `deepse/plans/step1-refinement-ana125-safari.md` §3〜§4。
 *
 * **本命は webkit, chromium は対照**である。#51 のように「WebKit だけ壊れる」ものは,
 * 両方を並べて初めて「エンジン差」と言い切れる。逆に「WebKit を直して Blink を壊した」も
 * 対照が無いと気付けない。**firefox は対象外** — どの配布形態にも Gecko は出てこないため
 * (計画書 §7.1)。要るようになればここに 1 行足すだけである。
 */

// **利用者が動かしている dev サーバ (:5173) には触らない。**別のポートで自前に立てる。
// ローカル正典はブラウザ内 (OPFS) にあり、テストごとに新しいプロファイルで開く
// (`tests/fixtures.ts`) ので、デーモンは要らない (step3 Phase 2 S2-3)。
const E2E_CLIENT_PORT = 5174;
const E2E_CLIENT_URL = `http://localhost:${E2E_CLIENT_PORT}`;
/**
 * 本番ビルドの配信 (`vite preview`)。**service worker は本番ビルドでだけ登録する**ので、
 * オフライン起動 (`offline.spec.ts`) はこちらで見る
 */
const E2E_PREVIEW_PORT = 5175;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  // **リトライしない。** WebKit で落ちたら差そのものが証拠であり,
  // 2 回目で通ることに意味は無い (むしろ再現しない不安定さを隠す)
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: E2E_CLIENT_URL,
    trace: 'on-first-retry',
  },

  projects: [
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: [
    {
      command: `bun run --cwd src/client build && bun run --cwd src/client preview --port ${E2E_PREVIEW_PORT} --strictPort`,
      url: `http://localhost:${E2E_PREVIEW_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `bun run --cwd src/client dev --port ${E2E_CLIENT_PORT} --strictPort`,
      url: E2E_CLIENT_URL,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
