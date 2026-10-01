import { test as ephemeralTest } from '@playwright/test';
import { expect, test } from './fixtures';
import { collectPageProblems } from './pageProblems';

/**
 * ブラウザ内のローカル正典 (step3 Phase 2 S2-3)
 *
 * ローカルサーバをやめ、op-log と blob をブラウザの OPFS 上の SQLite (dedicated Worker) に
 * 置いた。**エンジンをまたいで壊れうる所**だけをここで見る — 中身のロジック (`LocalStore`) は
 * 単体と App 結合が `bun:sqlite` で見ている。
 */

/** 起動 (Worker と SQLite-WASM の読み込み・OPFS の open) を待つ上限 */
const START_TIMEOUT_MS = 15_000;

test('SQLite-WASM のドライバが、bun:sqlite と同じ契約を満たす', async ({
  page,
}) => {
  // 契約は `sqlDriverContract.ts`。単体では `bun:sqlite` に、ここではブラウザの Worker の
  // SQLite-WASM に当てる。**同じ EventStore が両方の上で動く**ことの根拠である
  await page.goto('/');
  await page.waitForFunction(() => '__conversensus' in window, undefined, {
    timeout: START_TIMEOUT_MS,
  });
  const failures = await page.evaluate(() =>
    (
      window as unknown as {
        __conversensus: { runDriverContract: () => Promise<string[]> };
      }
    ).__conversensus.runDriverContract(),
  );
  expect(failures).toEqual([]);
});

test('🔴 作った File が再読み込みの後も残る (OPFS に保存されている)', async ({
  page,
}) => {
  const problems = collectPageProblems(page);
  const fileName = `残る-${Date.now()}`;
  await page.goto('/');
  await page.getByPlaceholder('ファイル名').fill(fileName);
  await page.getByPlaceholder('ファイル名').press('Enter');
  await expect(
    page.getByRole('button', { name: fileName, exact: true }),
  ).toBeVisible({
    timeout: START_TIMEOUT_MS,
  });

  await page.reload();

  await expect(
    page.getByRole('button', { name: fileName, exact: true }),
  ).toBeVisible({
    timeout: START_TIMEOUT_MS,
  });
  expect(problems.list()).toEqual([]);
});

/**
 * **使い捨ての context** (Playwright の既定) で開く。WebKit はここで OPFS を拒む (S0-4 の注意 1)
 * — Safari のプライベートブラウズに当たると考えられる場面である。黙ってメモリ上の DB に
 * 落とすと閉じた瞬間に編集が消えるので、編集を始めさせずに理由を出す (設計 D5)
 */
ephemeralTest(
  '🔴 保存領域の無い窓では「保存できません」を出し、編集を始めさせない',
  async ({ page, browserName }) => {
    ephemeralTest.skip(
      browserName !== 'webkit',
      'Chromium は使い捨ての context でも OPFS を開ける',
    );
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText(
      'この窓では保存できません',
      {
        timeout: START_TIMEOUT_MS,
      },
    );
    await expect(page.getByPlaceholder('ファイル名')).toHaveCount(0);
  },
);
