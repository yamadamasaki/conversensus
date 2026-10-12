/**
 * E2E の fixture (step3 Phase 2 S2-3)
 *
 * **テストごとに新しいプロファイルの persistent context で開く。**
 *
 * - ローカル正典は OPFS の SQLite にある。WebKit は使い捨ての context (Playwright の既定) で
 *   OPFS を拒む (S0-4 の注意 1) ので、保存領域のある context でなければ App が起動しない
 * - プロファイルを毎回新しくするのは、以前のローカルサーバの DB を毎回消していたのと同じ理由
 *   (「作ったファイルが 1 つだけ」のような前提を崩さない)
 * - **WebKit はそれだけでは足りない** — 保存領域がプロファイルの外に残るので、開く前に空にする
 *   (`clearOriginStorage`)
 *
 * 端末の設定 (`devices['Desktop Safari']` など) は project の `use` から受け継ぐ。言語 (`locale`) は
 * Playwright の fixture から受け取る — `test.use({ locale })` で替えたテストにも効かせるため (#50)。
 */

import { type BrowserContext, test as base, type Page } from '@playwright/test';
import { E2E_PREVIEW_URL } from './ports';

/** 保存領域を空にするときに開く、アプリを読まない静的なファイル */
const STORAGE_PROBE_PATH = '/icon-192.png';

export { expect } from '@playwright/test';

export const test = base.extend<{ context: BrowserContext; page: Page }>({
  context: async ({ playwright, browserName, locale }, use, testInfo) => {
    const {
      viewport,
      userAgent,
      deviceScaleFactor,
      isMobile,
      hasTouch,
      baseURL,
    } = testInfo.project.use;
    const context = await playwright[browserName].launchPersistentContext(
      testInfo.outputPath('profile'),
      // **locale も渡す。**persistent context は project の `use` を自動では受け継がないので、
      // 渡さないとエンジンの既定の言語で開き、画面の言語 (#50) が設定と食い違う
      {
        viewport,
        userAgent,
        deviceScaleFactor,
        isMobile,
        hasTouch,
        baseURL,
        locale,
      },
    );
    await use(context);
    await context.close();
  },
  page: async ({ context, baseURL }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    // **WebKit はプロファイルのディレクトリを替えても、保存領域 (OPFS など) が前のテストのまま残る**
    // (Chromium は空)。ローカル正典は OPFS にあるので、前のテストが作った File が一覧に出ていた。
    // アプリが保存領域を開く前に、両方の配信 (dev / 本番ビルド) の origin で空にする
    for (const origin of [baseURL, E2E_PREVIEW_URL]) {
      if (origin) await clearOriginStorage(page, origin);
    }
    await use(page);
  },
});

/**
 * その origin の保存領域 (OPFS・localStorage・IndexedDB) を空にする。アプリを読まない静的なファイル
 * (アイコン) を開いて行う — アプリを開くと worker が OPFS のファイルを握り、消せなくなる
 */
async function clearOriginStorage(page: Page, origin: string): Promise<void> {
  await page.goto(new URL(STORAGE_PROBE_PATH, origin).href);
  await page.evaluate(async () => {
    const root = (await navigator.storage.getDirectory()) as unknown as {
      keys(): AsyncIterable<string>;
      removeEntry(name: string, options: { recursive: boolean }): Promise<void>;
    };
    const names: string[] = [];
    for await (const name of root.keys()) names.push(name);
    for (const name of names) await root.removeEntry(name, { recursive: true });
    localStorage.clear();
    const databases = await indexedDB.databases();
    for (const db of databases) if (db.name) indexedDB.deleteDatabase(db.name);
  });
}
