import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { collectPageProblems } from './pageProblems';

/**
 * 画面の言語 (#50 i18n)
 *
 * 他の E2E は ja に固定している (`playwright.config.ts`)。ここだけブラウザの言語を en にして開き、
 * **本物のブラウザで**英語の画面になること・日本語が残らないことを見る。言語はモジュールの読み込み時に
 * `navigator.languages` から決まるので、エンジンの差が出うる
 */
test.use({ locale: 'en-US' });

const SETTLE_TIMEOUT_MS = 15_000;
const JAPANESE = /[぀-ヿ一-鿿]/;

/**
 * 画面の作りの文字 (描いた文字・読み上げの名前・tooltip・placeholder) に残った日本語の行。
 * **利用者が付けた名前は除く** — `translate="no"` の要素の中身と、その名前を含む属性の部分。
 * 言語の名前「日本語」も除く (切り替えのために日本語で書く)
 */
async function japaneseLeft(page: Page): Promise<string[]> {
  return await page.evaluate((pattern) => {
    const re = new RegExp(pattern);
    const names = Array.from(document.querySelectorAll('[translate="no"]'))
      .map((el) => el.textContent ?? '')
      .filter((name) => name !== '');
    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const el of Array.from(clone.querySelectorAll('[translate="no"]')))
      el.remove();
    const attributes = Array.from(
      document.querySelectorAll('[aria-label],[title],[placeholder]'),
    ).map((el) =>
      ['aria-label', 'title', 'placeholder']
        .map((a) => el.getAttribute(a) ?? '')
        .join(' '),
    );
    const withoutNames = (text: string) =>
      names.reduce((t, name) => t.replaceAll(name, ''), text);
    return [clone.textContent ?? '', ...attributes]
      .flatMap((t) => t.split('\n'))
      .map((line) => withoutNames(line).replaceAll('日本語', ''))
      .filter((line) => re.test(line));
  }, JAPANESE.source);
}

test.describe('画面の言語', () => {
  test('ブラウザが en なら英語で開き、日本語が残らない。切り替えると日本語になり、再読み込みしても残る', async ({
    page,
  }) => {
    const problems = collectPageProblems(page);
    await page.goto('/');
    const newFile = page.getByPlaceholder('New File name');
    await expect(newFile).toBeVisible({ timeout: SETTLE_TIMEOUT_MS });
    await newFile.fill('Research');
    await newFile.press('Enter');
    await expect(
      page.getByRole('toolbar', { name: 'Graph actions' }),
    ).toBeVisible({ timeout: SETTLE_TIMEOUT_MS });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await japaneseLeft(page)).toEqual([]);

    await page.getByLabel('Language').selectOption('ja');
    await expect(page.getByPlaceholder('新しい File の名前')).toBeVisible();
    await expect(
      page.getByRole('toolbar', { name: 'グラフの操作' }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');

    await page.reload();
    await expect(page.getByPlaceholder('新しい File の名前')).toBeVisible({
      timeout: SETTLE_TIMEOUT_MS,
    });
    expect(problems.list()).toEqual([]);
  });
});
