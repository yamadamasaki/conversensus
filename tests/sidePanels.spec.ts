import { expect, test } from './fixtures';
import { collectPageProblems } from './pageProblems';

/**
 * 左右のサイドバーの幅変更と折り畳み (step3 Phase 3 S3-4b)
 *
 * 取っ手はポインタのキャプチャ (`setPointerCapture`) で引く。ポインタの扱いはエンジンごとに
 * 違いが出やすい (paneDrag.spec の前例) ので、WebKit で実際に引いて確かめる
 */

const LEFT_HANDLE = { name: '左サイドバーの幅' };
const MIN_WIDTH = 160;

/** 左サイドバーの外枠の幅 (取っ手の親) */
async function leftWidth(page: import('@playwright/test').Page) {
  return await page
    .getByRole('separator', LEFT_HANDLE)
    .evaluate((el) =>
      Math.round(
        (el.parentElement as HTMLElement).getBoundingClientRect().width,
      ),
    );
}

test.describe('サイドバーの幅と開閉', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('ファイル名')).toBeVisible();
  });

  test('取っ手を右へ引くと左サイドバーが広がり、再読み込みしても残る', async ({
    page,
  }) => {
    const problems = collectPageProblems(page);
    const before = await leftWidth(page);
    const box = await page.getByRole('separator', LEFT_HANDLE).boundingBox();
    if (!box) throw new Error('取っ手が描かれていない');
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, y, { steps: 8 });
    await page.mouse.up();

    await expect.poll(() => leftWidth(page)).toBe(before + 80);
    await page.reload();
    await expect(page.getByPlaceholder('ファイル名')).toBeVisible();
    expect(await leftWidth(page)).toBe(before + 80);
    expect(problems.list()).toEqual([]);
  });

  test('畳むと帯だけが残り、広げると元の幅に戻る', async ({ page }) => {
    const before = await leftWidth(page);
    await page.getByRole('button', { name: '左サイドバーを畳む' }).click();
    await expect(page.getByPlaceholder('ファイル名')).toBeHidden();
    await page.getByRole('button', { name: '左サイドバーを広げる' }).click();
    await expect(page.getByPlaceholder('ファイル名')).toBeVisible();
    expect(await leftWidth(page)).toBe(before);
  });

  test('最小の幅まで狭めても、新規作成の行は溢れない (#51 の再発を見る)', async ({
    page,
  }) => {
    const handle = page.getByRole('separator', LEFT_HANDLE);
    await handle.focus();
    // 既定 240 から 16 ずつ。最小で止まる
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft');
    expect(await leftWidth(page)).toBe(MIN_WIDTH);

    const overflow = await page.evaluate(() => {
      const row = document.querySelector<HTMLInputElement>(
        'input[placeholder="ファイル名"]',
      )?.parentElement;
      if (!row) throw new Error('新規作成の行が見付からない');
      return row.scrollWidth - row.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('右サイドバーは既定で畳まれていて、広げると詳細が出る', async ({
    page,
  }) => {
    await expect(
      page.getByRole('complementary', { name: '詳細' }),
    ).toBeHidden();
    await page.getByRole('button', { name: '右サイドバーを広げる' }).click();
    await expect(
      page.getByRole('complementary', { name: '詳細' }),
    ).toBeVisible();
  });
});
