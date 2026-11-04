import { defineConfig, devices } from '@playwright/test';
import { SHOTS_CLIENT_PORT, SHOTS_PEER_PORT } from './tests/ports';

/**
 * 入門の図を撮る (step4)。テストではないので `bun run test` / `test:e2e` には入れない。
 *
 * - 撮るのは `docs/introductory_guide_to_conversensus/shots/*.shot.ts`
 * - 言語は環境変数 `SHOTS_LOCALE` (ja / en)。同じスクリプトで両方の図を撮る
 * - **chromium だけで撮る。**図は見た目の記録で、エンジンの差を見るものではない。WebKit は
 *   使い捨ての context で OPFS を拒むので、撮るたびにプロファイルを作る手間も要る
 *
 * 方針は `deepse/architecture/step4/intro-guide-figures.md` §2
 */
const SHOTS_URL = `http://127.0.0.1:${SHOTS_CLIENT_PORT}`;
/** 6 章の 2 人目が開く dev サーバ。origin (保存領域) を 1 人目と分けるため */
const SHOTS_PEER_URL = `http://127.0.0.1:${SHOTS_PEER_PORT}`;
const LOCALES = { ja: 'ja-JP', en: 'en-US' } as const;
const locale = process.env.SHOTS_LOCALE === 'en' ? LOCALES.en : LOCALES.ja;

export default defineConfig({
  testDir: './docs/introductory_guide_to_conversensus/shots',
  testMatch: '*.shot.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 120_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: SHOTS_URL,
    locale,
    viewport: { width: 1280, height: 800 },
    // 文書の図なので高精細で撮る
    deviceScaleFactor: 2,
    // 押す相手を間違えたときに、テスト全体の上限まで待たずに落とす
    actionTimeout: 20_000,
  },
  webServer: [SHOTS_CLIENT_PORT, SHOTS_PEER_PORT].map((port, i) => ({
    command: `bun run --cwd src/client dev --port ${port} --strictPort`,
    url: [SHOTS_URL, SHOTS_PEER_URL][i] as string,
    reuseExistingServer: false,
    timeout: 60_000,
  })),
});
