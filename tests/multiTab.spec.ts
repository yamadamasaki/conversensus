import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { collectPageProblems } from './pageProblems';

/**
 * 同じブラウザの複数のタブ (step3 Phase 2 S2-4)
 *
 * タブはそれぞれ Worker を持ち、同じ OPFS の DB に書く。**同じ context の 2 つの page** が
 * 「同じブラウザの 2 つのタブ」に当たる (localStorage・Web Locks・BroadcastChannel・OPFS を
 * 共有する)。
 */

/** 起動と、タブ間の知らせが画面に出るまでを待つ上限 */
const SETTLE_TIMEOUT_MS = 15_000;
const NODE = '.react-flow__node';
const PANE = '.react-flow__pane';

async function deviceIdOf(page: Page): Promise<string> {
  await page.waitForFunction(() => '__conversensus' in window, undefined, {
    timeout: SETTLE_TIMEOUT_MS,
  });
  return page.evaluate(
    () =>
      (window as unknown as { __conversensus: { deviceId: string } })
        .__conversensus.deviceId,
  );
}

async function openTab(page: Page): Promise<Page> {
  const tab = await page.context().newPage();
  await tab.goto('/');
  return tab;
}

test('🔴 同時に開いたタブは別の deviceId を持ち、閉じたタブの id は次のタブが使う', async ({
  page,
}) => {
  // 同じ deviceId = 同じ actor のタブが 2 つあると、同じ点 (actor, seq) を発番して PDS で
  // 上書きし合う (設計 F4)
  await page.goto('/');
  const second = await openTab(page);
  const [a, b] = [await deviceIdOf(page), await deviceIdOf(second)];
  expect(a).not.toBe(b);

  await second.close();
  const third = await openTab(page);
  // actor の数は「同時に開いたタブの最大数」で頭打ちになる
  expect(await deviceIdOf(third)).toBe(b);
});

test('🔴 別のタブで作った File と、置いたノードが、再読み込みなしに出る', async ({
  page,
}) => {
  const problems = [collectPageProblems(page)];
  const fileName = `タブ間-${Date.now()}`;
  await page.goto('/');
  const other = await openTab(page);
  problems.push(collectPageProblems(other));
  await deviceIdOf(other);

  // 1 つ目のタブで作る → 2 つ目のタブの一覧に出る
  await page.getByPlaceholder('新しい File の名前').fill(fileName);
  await page.getByPlaceholder('新しい File の名前').press('Enter');
  const fileButton = (p: Page) =>
    p.getByRole('button', { name: fileName, exact: true });
  await expect(fileButton(other)).toBeVisible({ timeout: SETTLE_TIMEOUT_MS });

  // 2 つ目のタブでも開いておき、1 つ目のタブでノードを置く → 2 つ目のタブに出る
  await fileButton(other).click();
  await expect(other.locator(PANE)).toBeVisible({ timeout: SETTLE_TIMEOUT_MS });
  await page.locator(PANE).dblclick({ position: { x: 200, y: 200 } });
  await page.getByRole('button', { name: 'Markdown' }).click();
  await expect(page.locator(NODE)).toHaveCount(1);

  await expect(other.locator(NODE)).toHaveCount(1, {
    timeout: SETTLE_TIMEOUT_MS,
  });
  for (const p of problems) expect(p.list()).toEqual([]);
});
