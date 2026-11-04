import { expect, test } from '@playwright/test';
import { collectPageProblems } from '../../../tests/pageProblems';
import { buildScene, coverBlob, S } from './scene';
import {
  dropImage,
  fitAndZoomOut,
  hideMap,
  importScene,
  leftSidebar,
  NODE,
  openNodeMenu,
  openSheet,
  PANE,
  renderCover,
  SETTLE_TIMEOUT_MS,
  shoot,
  shootAround,
  t,
} from './support';

/** 3 章 グラフの置き場所 / 4 章 グラフで考える */
test('左サイドバー、グラフの画面、node の作成', async ({ page }, testInfo) => {
  const problems = collectPageProblems(page);
  await page.goto('/');
  const coverPng = await renderCover(page, S.cover);
  await importScene(page, buildScene(await coverBlob(coverPng)), testInfo);

  // --- 3 章: Folder「読書会」に File を入れる ---
  await page.getByRole('button', { name: t.sidebar.createFolder }).click();
  const input = page.getByRole('dialog').getByRole('textbox');
  await input.fill(S.folder);
  await input.press('Enter');
  await page
    .getByRole('button', { name: t.sidebar.moveFileToFolder(S.file) })
    .click();
  await page.getByRole('button', { name: `→ ${S.folder}` }).click();
  await openSheet(page, S.file, S.ch1);
  await hideMap(page);
  await expect(page.locator(`${NODE} img`)).toBeVisible({
    timeout: SETTLE_TIMEOUT_MS,
  });
  // 一覧の部分だけ (下の空白とバナーは写さない)
  await shootAround(
    page,
    [
      leftSidebar(page).getByText('conversensus', { exact: true }),
      page.getByRole('button', { name: t.sidebar.addSheet }),
    ],
    'the_place_where_graph_lives-sidebar',
  );

  // --- 4 章: グラフの画面 ---
  await fitAndZoomOut(page);
  await shoot(page, 'thinking_with_graphs-graph');

  // --- 4 章: node の作成。空の Sheet で行う ---
  await page.getByRole('button', { name: t.sidebar.addSheet }).click();
  await expect(page.locator(NODE)).toHaveCount(0);
  await openNodeMenu(page, { x: 120, y: 120 });
  const menuItem = page.getByRole('button', {
    name: t.graph.appearances.markdown,
    exact: true,
  });
  await menuItem.waitFor();
  await shootAround(
    page,
    [menuItem.locator('xpath=..')],
    'thinking_with_graphs-node-menu',
  );

  // markdown・画像・group を 1 つずつ作り、並べて撮る
  await menuItem.click();
  const markdown = page.locator(NODE).first();
  await markdown.dblclick();
  await page.locator(`${NODE} textarea`).fill(S.deadDogma);
  await page.locator(PANE).click({ position: { x: 1000, y: 640 } });

  await dropImage(page, coverPng, { x: 860, y: 160 });
  const image = page.locator(NODE).filter({ has: page.locator('img') });
  await expect(image.locator('img')).toBeVisible({
    timeout: SETTLE_TIMEOUT_MS,
  });

  await openNodeMenu(page, { x: 120, y: 420 });
  await page
    .getByRole('button', { name: t.graph.appearances.group, exact: true })
    .click();
  await expect(page.locator(NODE)).toHaveCount(3);
  // 作った場所の都合で group が markdown に重なるので、下へずらしてから全体を収めて撮る
  const groupBox = await page.locator(NODE).last().boundingBox();
  if (!groupBox) throw new Error('group の位置が取れない');
  await page.mouse.move(groupBox.x + 40, groupBox.y + 15);
  await page.mouse.down();
  await page.mouse.move(groupBox.x + 40, groupBox.y + 175, { steps: 8 });
  await page.mouse.up();
  await page.locator(PANE).click({ position: { x: 1000, y: 640 } });
  await fitAndZoomOut(page);
  await shoot(
    page.locator('.react-flow'),
    'thinking_with_graphs-created-nodes',
  );

  expect(problems.list()).toEqual([]);
});
