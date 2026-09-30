// S0-4 spike 専用 (投棄可)。E2E (`tests/`) とは分ける — これは適合の検証ではなく調査である。
// 実行: `bunx playwright test -c src/client/spikes/opfs/playwright.config.ts`
import { defineConfig, devices } from '@playwright/test';

export const COI_PORT = 5191;
export const PLAIN_PORT = 5192;
const vite = (port: number, coi: boolean) => ({
  command: `${coi ? 'SPIKE_COI=1 ' : ''}bunx vite --config spikes/opfs/vite.config.mjs --port ${port} --strictPort`,
  cwd: '../..',
  url: `http://localhost:${port}`,
  reuseExistingServer: false,
  timeout: 60_000,
});

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spike\.ts/,
  // 出力はリポジトリ直下の test-results (.gitignore 済み) に出す
  outputDir: '../../../../test-results/opfs-spike',
  workers: 1,
  reporter: 'list',
  projects: [
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [vite(COI_PORT, true), vite(PLAIN_PORT, false)],
});
