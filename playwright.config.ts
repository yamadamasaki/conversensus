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

// **利用者が動かしている dev サーバ (:3000 / :5173) には触らない。**
// 再利用すると E2E がファイルを作る先が利用者の `data/` になってしまう。
// オリジンが分かれることで blob の HTTP キャッシュも混ざらない
// (`/blobs/:cid` は immutable で返るので, 同じオリジンだと消した実体が
//  キャッシュから返る — ANA-116 の実機検証で踏んだ罠)。
const E2E_DAEMON_PORT = 3100;
const E2E_CLIENT_PORT = 5174;
const E2E_DAEMON_URL = `http://localhost:${E2E_DAEMON_PORT}`;
const E2E_CLIENT_URL = `http://localhost:${E2E_CLIENT_PORT}`;

// デーモンのデータ置き場。gitignore の `data-` 始まりのパターンに入る
const E2E_DATA_DIR = 'data-e2e';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // 1 つのデーモンを共有するので直列に回す
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
      // **毎回まっさらから始める。** 前回の残骸があると「作ったファイルが 1 つだけ」の
      // ような前提が崩れる。消してから開くために起動コマンドに含める
      // (globalSetup と webServer の実行順に依存しない形にする)。
      command: `rm -rf ${E2E_DATA_DIR} && DATA_DIR=${E2E_DATA_DIR} PORT=${E2E_DAEMON_PORT} bun run src/server/src/index.ts`,
      url: `${E2E_DAEMON_URL}/files`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `bun run --cwd src/client dev --port ${E2E_CLIENT_PORT} --strictPort`,
      url: E2E_CLIENT_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        // これを忘れるとクライアントは既定の :3000 = 利用者のデーモンを見る
        VITE_API_BASE: E2E_DAEMON_URL,
      },
    },
  ],
});
