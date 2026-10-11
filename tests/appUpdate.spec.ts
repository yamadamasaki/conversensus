import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { collectPageProblems } from './pageProblems';
import { E2E_PREVIEW_URL } from './ports';

/**
 * 新しい版の知らせ (#262)
 *
 * **本番ビルド** (`vite preview`) で開く — 版の印 (`version.json`) は build でだけ出し、
 * service worker も本番ビルドでだけ登録する。新しい版を配ったことは、`version.json` の応答を
 * 差し替えて作る。
 */

const SETTLE_TIMEOUT_MS = 15_000;
const NOTICE_NAME = '新しい版の知らせ';
const NEWER_BUILD = '99.0.0+e2e.newer';

async function openApp(page: Page) {
  await page.goto(E2E_PREVIEW_URL);
  await page
    .getByPlaceholder('新しい File の名前')
    .waitFor({ timeout: SETTLE_TIMEOUT_MS });
}

/**
 * 知らせの領域。**役割 (`status`) では引かない** — WebKit の Playwright は `section` に付けた
 * `role="status"` の名前を引けず、出ているのに見つからなかった
 */
const noticeOf = (page: Page) => page.getByLabel(NOTICE_NAME);

/** タブが前に戻ったことにする (見に行く時機の 1 つ) */
async function returnToTab(page: Page) {
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')),
  );
}

test('🔴 配信の版が変わらなければ知らせず、変われば前に戻ったときに知らせ、再読み込みで消える', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Playwright の WebKit は、service worker が素通しした要求を page.route で差し替えられない (配信の版を変えられない)。素通しすること自体は次のテストが両方で見る',
  );
  const problems = collectPageProblems(page);
  await openApp(page);
  // build は自分の印を配っている (同じ版なので知らせない)
  const served = await page.evaluate(async () => {
    const response = await fetch('/version.json', { cache: 'no-store' });
    return (await response.json()) as { build: string };
  });
  expect(served.build).toMatch(/^\d+\.\d+\.\d+\+/);
  await returnToTab(page);
  await expect(noticeOf(page)).toHaveCount(0);

  // 新しい版を配る
  await page.route('**/version.json', (route) =>
    route.fulfill({ json: { build: NEWER_BUILD } }),
  );
  await returnToTab(page);
  const notice = noticeOf(page);
  await expect(notice).toBeVisible({ timeout: SETTLE_TIMEOUT_MS });

  // 再読み込みすれば、その版 (ここでは元の配信) になり、知らせは消える
  await page.unroute('**/version.json');
  await notice.getByRole('button', { name: '再読み込み' }).click();
  await page
    .getByPlaceholder('新しい File の名前')
    .waitFor({ timeout: SETTLE_TIMEOUT_MS });
  await returnToTab(page);
  await expect(noticeOf(page)).toHaveCount(0);
  expect(problems.list()).toEqual([]);
});

test('🔴 service worker が画面を握っていても、版の印をキャッシュに入れず、毎回配信から取る', async ({
  page,
}) => {
  // service worker が `version.json` をキャッシュから返すと、新しい版に永遠に気付けない
  const problems = collectPageProblems(page);
  await openApp(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page
    .getByPlaceholder('新しい File の名前')
    .waitFor({ timeout: SETTLE_TIMEOUT_MS });
  const result = await page.evaluate(async () => {
    // 見に行く時機を作り、加えて自分でも取る (どちらも service worker を通る)
    document.dispatchEvent(new Event('visibilitychange'));
    const response = await fetch('/version.json', { cache: 'no-store' });
    const cached = await caches.match('/version.json');
    return {
      controlled: navigator.serviceWorker.controller !== null,
      ok: response.ok,
      cached: cached !== undefined,
    };
  });
  expect(result).toEqual({ controlled: true, ok: true, cached: false });
  expect(problems.list()).toEqual([]);
});
