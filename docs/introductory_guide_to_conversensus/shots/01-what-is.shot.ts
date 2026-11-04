import { expect, test } from '@playwright/test';
import { collectPageProblems } from '../../../tests/pageProblems';
import { buildSimpleScene, coverBlob, S } from './scene';
import {
  importScene,
  NODE,
  nodeWith,
  renderCover,
  SETTLE_TIMEOUT_MS,
  shoot,
  t,
} from './support';

/** 2 章 始める / 1 章 conversensus って何 */
test('初期画面と、単純なグラフ', async ({ page }, testInfo) => {
  const problems = collectPageProblems(page);
  await page.goto('/');
  await page.getByPlaceholder(t.sidebar.newFileName).waitFor();
  // 2 章: 何も無い初期画面
  await shoot(page, 'lets_get_started-initial');

  // 1 章: label と property の付いた markdown node と画像の node、その間の edge。
  // property は右サイドバーに出るので、主張を選んで開いておく
  const cover = await coverBlob(await renderCover(page, S.cover));
  await importScene(page, buildSimpleScene(cover), testInfo);
  await expect(page.locator(`${NODE} img`)).toBeVisible({
    timeout: SETTLE_TIMEOUT_MS,
  });
  await nodeWith(page, S.claimLabel).click();
  await page.getByRole('button', { name: t.header.property }).click();
  await shoot(page, 'what_is_conversensus-simple-graph');

  expect(problems.list()).toEqual([]);
});
