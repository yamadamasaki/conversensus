import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { collectPageProblems } from './pageProblems';

/**
 * service worker とオフライン起動 (step3 Phase 2 S2-5)
 *
 * **本番ビルド** (`vite preview`, playwright.config.ts) で開く — service worker は本番ビルドで
 * だけ登録する。
 */

const PREVIEW_URL = 'http://127.0.0.1:5175/';
const SETTLE_TIMEOUT_MS = 15_000;

/** 開いて、service worker が画面を握った状態で開き直す (資源を覚えさせる) */
async function openUnderServiceWorker(page: Page) {
  await page.goto(PREVIEW_URL);
  await page
    .getByPlaceholder('ファイル名')
    .waitFor({ timeout: SETTLE_TIMEOUT_MS });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
}

async function createFile(page: Page, fileName: string) {
  await page.getByPlaceholder('ファイル名').fill(fileName);
  await page.getByPlaceholder('ファイル名').press('Enter');
  await expect(
    page.getByRole('button', { name: fileName, exact: true }),
  ).toBeVisible({ timeout: SETTLE_TIMEOUT_MS });
}

test('🔴 service worker が握った画面でも、ローカル正典の Worker が起動する', async ({
  page,
}) => {
  // WebKit で実際に壊れた: service worker の中で元の Request をそのまま `fetch` すると、
  // Worker のスクリプトの取得が "Load failed" で落ち、「この窓では保存できません」になった
  const problems = collectPageProblems(page);
  await openUnderServiceWorker(page);
  await createFile(page, `握られた画面-${Date.now()}`);
  expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);
  expect(problems.list()).toEqual([]);
});

test('🔴 1 度開いた後は、回線が無くても起動して、手元の File を開ける', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Playwright の WebKit は、オフラインのエミュレーション下の再読み込みが内部エラーになる (service worker の扱いは Chromium だけが対応)',
  );
  const fileName = `オフライン-${Date.now()}`;
  await openUnderServiceWorker(page);
  await createFile(page, fileName);

  await context.setOffline(true);
  const problems = collectPageProblems(page);
  await page.reload();

  // 画面が出て (cross-origin isolation も保たれて) ローカル正典が開ける
  await expect(
    page.getByRole('button', { name: fileName, exact: true }),
  ).toBeVisible({ timeout: SETTLE_TIMEOUT_MS });
  expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);
  expect(problems.list()).toEqual([]);
});
