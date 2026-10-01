/**
 * E2E の fixture (step3 Phase 2 S2-3)
 *
 * **テストごとに新しいプロファイルの persistent context で開く。**
 *
 * - ローカル正典は OPFS の SQLite にある。WebKit は使い捨ての context (Playwright の既定) で
 *   OPFS を拒む (S0-4 の注意 1) ので、保存領域のある context でなければ App が起動しない
 * - プロファイルを毎回新しくするのは、以前のローカルサーバの DB を毎回消していたのと同じ理由
 *   (「作ったファイルが 1 つだけ」のような前提を崩さない)
 *
 * 端末の設定 (`devices['Desktop Safari']` など) は project の `use` から受け継ぐ。
 */

import { type BrowserContext, test as base, type Page } from '@playwright/test';

export { expect } from '@playwright/test';

export const test = base.extend<{ context: BrowserContext; page: Page }>({
  context: async ({ playwright, browserName }, use, testInfo) => {
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
      { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL },
    );
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    await use(context.pages()[0] ?? (await context.newPage()));
  },
});
