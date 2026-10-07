import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { collectPageProblems } from './pageProblems';

/**
 * ログアウトで「この端末のデータも消す」を選んだ後の起動 (#288)
 *
 * 消すのは次の起動の最初 (`src/client/src/local/eraseDevice.ts`)。**OPFS が本当に空になるか**は
 * エンジンの OPFS の実装次第 (閉じたばかりの同期ハンドルの解放など) なので、ここで見る。
 * ログアウトの問い (ログインが要る) は単体 (`logoutFlow.test.ts`) で見ていて、ここでは
 * 問いの後に付く印 (`sessionStorage`) を直接置いて再読み込みする。
 */

const START_TIMEOUT_MS = 15_000;
/** `ERASE_REQUEST_KEY` と同じ (E2E は src から import しない) */
const ERASE_REQUEST_KEY = 'conversensus_erase_requested';
/** `ERASED_TITLE` と同じ */
const ERASED_TITLE = 'この端末の conversensus のデータを消しました';

async function createFile(page: Page, name: string) {
  await page.getByPlaceholder('ファイル名').fill(name);
  await page.getByPlaceholder('ファイル名').press('Enter');
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible({
    timeout: START_TIMEOUT_MS,
  });
}

async function requestEraseAndReload(page: Page) {
  await page.evaluate(
    (key) => sessionStorage.setItem(key, '1'),
    ERASE_REQUEST_KEY,
  );
  await page.reload();
}

test('🔴 印を付けて再読み込みすると、この端末の File を消して「消した」とだけ出す。次に開けば空から使える', async ({
  page,
}) => {
  const problems = collectPageProblems(page);
  const fileName = `消える-${Date.now()}`;
  await page.goto('/');
  await createFile(page, fileName);

  await requestEraseAndReload(page);

  // 消した後は保存領域を開き直さず、閉じてもらう画面だけを出す
  await expect(page.getByText(ERASED_TITLE)).toBeVisible({
    timeout: START_TIMEOUT_MS,
  });
  await expect(page.getByPlaceholder('ファイル名')).toHaveCount(0);

  // 次に開けば (印はもう無い) 空から始まり、新しい File を作れる
  await page.reload();
  await expect(page.getByPlaceholder('ファイル名')).toBeVisible({
    timeout: START_TIMEOUT_MS,
  });
  await expect(
    page.getByRole('button', { name: fileName, exact: true }),
  ).toHaveCount(0);
  await createFile(page, `後-${Date.now()}`);
  expect(problems.list()).toEqual([]);
});

test('🔴 別のタブが開いていれば消さない', async ({ page }) => {
  const fileName = `残る-${Date.now()}`;
  await page.goto('/');
  await createFile(page, fileName);
  const other = await page.context().newPage();
  await other.goto('/');
  await expect(
    other.getByRole('button', { name: fileName, exact: true }),
  ).toBeVisible({ timeout: START_TIMEOUT_MS });

  await requestEraseAndReload(page);

  await expect(
    page.getByRole('button', { name: fileName, exact: true }),
  ).toBeVisible({ timeout: START_TIMEOUT_MS });
  await other.close();
});
