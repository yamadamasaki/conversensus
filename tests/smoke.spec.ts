import { expect, test } from '@playwright/test';
import { collectPageProblems } from './pageProblems';

/**
 * 起動のスモーク (ANA-125 S0)
 *
 * ここは土台が生きていることを示す最小限である。導線の通しスモークは S2 で足す。
 */
test.describe('起動', () => {
  test('サイドバーとキャンバスが出る', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('conversensus')).toBeVisible();
    await expect(page.getByPlaceholder('ファイル名')).toBeVisible();
    // ファイル未選択の初期画面
    await expect(
      page.getByText('ファイルを選択するか, 新規作成してください'),
    ).toBeVisible();
  });

  test('起動でコンソールエラーも未処理例外も出ない', async ({ page }) => {
    // **画面が正しく見えることを合格条件にしない** (計画書 D2)。
    // 送信が数週間全滅していたのに画面は正常だった前例がある
    const problems = collectPageProblems(page);

    await page.goto('/');
    await expect(page.getByPlaceholder('ファイル名')).toBeVisible();

    expect(problems.list()).toEqual([]);
  });
});
