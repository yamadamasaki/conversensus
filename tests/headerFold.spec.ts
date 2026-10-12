import { expect, test } from './fixtures';
import { collectPageProblems } from './pageProblems';

/**
 * ヘッダの操作を幅に合わせて畳む (利用者の指摘 2026-10-12)
 *
 * 畳むかどうかは、描いた中身の幅 (`scrollWidth`) と箱の幅 (`clientWidth`) を比べて決める。
 * 単体のテストは配置をしない happy-dom で幅を差し替えているので、**本物の配置で溢れが消えるか**を
 * 両方のエンジンで見る
 */

const LONG_NAME = 'とても長い名前の File '.repeat(6);

/** ヘッダの中身が箱からはみ出している幅 (0 なら収まっている) */
async function overflow(page: import('@playwright/test').Page) {
  return await page
    .getByRole('toolbar', { name: 'グラフの操作' })
    .evaluate((el) => el.scrollWidth - el.clientWidth);
}

test.describe('ヘッダの畳み', () => {
  test('長い名前と狭い幅でも、ヘッダは溢れず、畳んだ操作は「…」から使える', async ({
    page,
  }) => {
    const problems = collectPageProblems(page);
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto('/');
    await page.getByPlaceholder('新しい File の名前').fill(LONG_NAME);
    await page.getByPlaceholder('新しい File の名前').press('Enter');
    const toolbar = page.getByRole('toolbar', { name: 'グラフの操作' });
    await expect(toolbar).toBeVisible();

    // 広い幅: 何も畳まない
    await expect(
      toolbar.getByRole('button', { name: 'PNG で書き出す' }),
    ).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    // 右サイドバーを広げてヘッダを狭める (画面の幅の段は変わらない)
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.getByRole('button', { name: '右サイドバーを広げる' }).click();
    await expect.poll(() => overflow(page)).toBeLessThanOrEqual(0);
    await expect(
      toolbar.getByRole('button', { name: 'その他の操作' }),
    ).toBeVisible();
    await expect(
      toolbar.getByRole('button', { name: '元に戻す' }),
    ).toBeVisible();

    await toolbar.getByRole('button', { name: 'その他の操作' }).click();
    await expect(
      page.getByRole('menuitem', { name: 'PNG で書き出す' }),
    ).toBeVisible();
    expect(problems.list()).toEqual([]);
  });
});
