import { expect, test } from './fixtures';
import { collectPageProblems } from './pageProblems';

/**
 * 起動のスモーク (ANA-125 S0)
 *
 * ここは土台が生きていることを示す最小限である。導線の通しスモークは S2 で足す。
 */
test.describe('起動', () => {
  test('サイドバーとキャンバスが出る', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'conversensus' }),
    ).toBeVisible();
    await expect(page.getByPlaceholder('新しい File の名前')).toBeVisible();
    // File を開いていない初期画面には空の状態 (visual language §9.1) が出る。
    // WebKit は他の spec の File が残ることがあるので、どちらの空の状態でもよい
    await expect(
      page.getByRole('region', {
        name: /^(File がありません|File を開いてください)$/,
      }),
    ).toBeVisible();
  });

  test('起動でコンソールエラーも未処理例外も出ない', async ({ page }) => {
    // **画面が正しく見えることを合格条件にしない** (計画書 D2)。
    // 送信が数週間全滅していたのに画面は正常だった前例がある
    const problems = collectPageProblems(page);

    await page.goto('/');
    await expect(page.getByPlaceholder('新しい File の名前')).toBeVisible();

    expect(problems.list()).toEqual([]);
  });
});
