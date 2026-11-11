import { expect, test } from '@playwright/test';
import { collectPageProblems } from '../../../tests/pageProblems';
import { buildScene, coverBlob, S } from './scene';
import {
  fileItem,
  fitAndZoomOut,
  hideMap,
  importScene,
  NODE,
  openApplyTemplate,
  openNodeMenu,
  openSheet,
  renderCover,
  SETTLE_TIMEOUT_MS,
  shoot,
  t,
} from './support';

/** Toulmin の template graph の名前 (作り込みの種の名前。訳さない) */
const TOULMIN = 'Toulmin model';

/** 7 章 グラフのカタ: 既定の index と、書き足した index */
test('index', async ({ page }, testInfo) => {
  const problems = collectPageProblems(page);
  await page.goto('/');
  const cover = await coverBlob(await renderCover(page, S.cover));
  await importScene(page, buildScene(cover), testInfo);
  await openSheet(page, S.file, S.index);
  await hideMap(page);
  await expect(page.locator(NODE)).toHaveCount(3, {
    timeout: SETTLE_TIMEOUT_MS,
  });
  await fitAndZoomOut(page, 2);
  await shoot(page, 'graph_kata-index-default');
  expect(problems.list()).toEqual([]);
});

test('index に書き足す', async ({ page }, testInfo) => {
  const problems = collectPageProblems(page);
  await page.goto('/');
  const cover = await coverBlob(await renderCover(page, S.cover));
  await importScene(
    page,
    buildScene(cover, { withIndexNotes: true }),
    testInfo,
  );
  await openSheet(page, S.file, S.index);
  await hideMap(page);
  await expect(page.locator(NODE)).toHaveCount(4, {
    timeout: SETTLE_TIMEOUT_MS,
  });
  await fitAndZoomOut(page, 2);
  await shoot(page, 'graph_kata-index-notes');
  expect(problems.list()).toEqual([]);
});

/** 独自の metagraph と Toulmin model */
test('metagraph と Toulmin model', async ({ page }, testInfo) => {
  const problems = collectPageProblems(page);
  await page.goto('/');
  const cover = await coverBlob(await renderCover(page, S.cover));
  await importScene(page, buildScene(cover), testInfo);
  await openSheet(page, S.file, S.ch1);
  await hideMap(page);
  const file = fileItem(page, S.file);
  const special = file.getByRole('button', {
    name: t.sidebar.addSheetWithTemplate,
  });

  // ▾ のメニュー (metagraph・template graph・Toulmin model)
  await special.click();
  await page.waitForTimeout(300);
  await shoot(page, 'graph_kata-add-menu');

  // 独自の metagraph
  await file.getByRole('button', { name: '+ metagraph' }).click();
  await expect(page.locator(NODE).first()).toBeVisible({
    timeout: SETTLE_TIMEOUT_MS,
  });
  await fitAndZoomOut(page, 2);
  await shoot(page, 'graph_kata-metagraph');

  // Toulmin model の template graph を File に足す (そのまま図式になっている)
  await special.click();
  await file
    .getByRole('button', { name: t.sidebar.addTemplate(TOULMIN) })
    .click();
  await openSheet(page, S.file, TOULMIN);
  await expect(page.locator(NODE).first()).toBeVisible({
    timeout: SETTLE_TIMEOUT_MS,
  });
  await fitAndZoomOut(page);
  await shoot(page, 'graph_kata-toulmin-template');

  // Toulmin model を当てた Sheet を作り、node の種類のメニューを出す
  await file.getByRole('button', { name: t.sidebar.addSheet }).click();
  const dialog = page.getByRole('dialog', { name: t.templateApply.title });
  await dialog.getByLabel(TOULMIN).check();
  await shoot(dialog, 'graph_kata-template-apply');
  await dialog
    .getByRole('button', { name: t.templateApply.submit, exact: true })
    .click();
  await expect(page.locator(NODE)).toHaveCount(0, {
    timeout: SETTLE_TIMEOUT_MS,
  });
  await openNodeMenu(page, { x: 300, y: 200 });
  await page.waitForTimeout(300);
  await shoot(page, 'graph_kata-toulmin-menu');

  expect(problems.list()).toEqual([]);
});

/** Toulmin の「主張」の種類 (見る人の言語で出る、#356) */
const CLAIM_KIND = /^(主張|Claim)$/;

/**
 * すでにある Sheet に後から template を当てる (#355) と、読み取り専用の property (#357)。
 * 4 章 (グラフで考える) の右サイドバーの図もここで撮る (Toulmin の種類が要るので)
 */
test('template を後から当てる、読み取り専用の property', async ({
  page,
}, testInfo) => {
  const problems = collectPageProblems(page);
  await page.goto('/');
  const cover = await coverBlob(await renderCover(page, S.cover));
  await importScene(page, buildScene(cover), testInfo);
  await openSheet(page, S.file, S.ch1);
  await hideMap(page);
  const file = fileItem(page, S.file);
  await file
    .getByRole('button', { name: t.sidebar.addSheetWithTemplate })
    .click();
  await file
    .getByRole('button', { name: t.sidebar.addTemplate(TOULMIN) })
    .click();

  // 第 1 章の「…」→「template を当てる」
  await openSheet(page, S.file, S.ch1);
  const dialog = await openApplyTemplate(page, S.file, S.ch1);
  await dialog.getByLabel(TOULMIN).check();
  await shoot(dialog, 'graph_kata-template-apply-later');
  await dialog
    .getByRole('button', { name: t.templateApply.applySubmit, exact: true })
    .click();
  await expect(dialog).toBeHidden();

  // 当てた種類で node を作り、選んで、property の欄に読み取り専用の property も出す
  await fitAndZoomOut(page, 2);
  const before = await page.locator(NODE).count();
  await openNodeMenu(page, { x: 1000, y: 120 });
  // 場面の node にも label「主張」があるので、node の外 (種類のメニュー) のボタンに限る
  await page
    .locator(`button:not(${NODE} *)`)
    .filter({ hasText: CLAIM_KIND })
    .first()
    .click();
  await expect(page.locator(NODE)).toHaveCount(before + 1, {
    timeout: SETTLE_TIMEOUT_MS,
  });
  const created = page.locator(NODE).last();
  await created.click({ position: { x: 20, y: 40 } });
  await page
    .getByRole('button', { name: t.sidePanel.expand(t.boundary.rightSidebar) })
    .click();
  await page.getByLabel(t.property.showReadOnly).check();
  await expect(page.getByText(t.property.readOnly.templateKind)).toBeVisible({
    timeout: SETTLE_TIMEOUT_MS,
  });
  await shoot(
    // 欄の下は空いているので、property の区画だけを撮る
    page.getByRole('complementary').last().getByRole('region').first(),
    'thinking_with_graphs-readonly-properties',
  );
  // 端末の好みとして覚えるので、次の撮影のために外しておく
  await page.getByLabel(t.property.showReadOnly).uncheck();

  expect(problems.list()).toEqual([]);
});
