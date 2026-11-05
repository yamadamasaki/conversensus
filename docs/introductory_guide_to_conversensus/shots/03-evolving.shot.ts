import { expect, test } from '@playwright/test';
import { collectPageProblems } from '../../../tests/pageProblems';
import { buildScene, coverBlob, S } from './scene';
import {
  fileItem,
  fitAndZoomOut,
  hideMap,
  importScene,
  inputDialog,
  NODE,
  nodeWith,
  openNodeMenu,
  openSheet,
  renderCover,
  rewriteNode,
  SETTLE_TIMEOUT_MS,
  shoot,
  shootAround,
  t,
} from './support';

/** 本文の頭で主張の node を引く (markdown の ** は画面に出ないので外す) */
const claimNode = (page: import('@playwright/test').Page) =>
  nodeWith(page, S.claimLabel);

/**
 * 5 章 成長するグラフ。
 *
 * 衝突は 1 人で起こす (計画 §1.2 の案 b): branch を切った後で trunk の同じ node を書き換えてから、
 * branch を merge する。2 人が要るのは 6 章だけにする
 */
test('trunk、branch、commit、merge、衝突、history', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const problems = collectPageProblems(page);
  await page.goto('/');
  const cover = await coverBlob(await renderCover(page, S.cover));
  await importScene(page, buildScene(cover), testInfo);
  await openSheet(page, S.file, S.ch1);
  await hideMap(page);
  const file = fileItem(page, S.file);
  const addSheet = page.getByRole('button', { name: t.sidebar.addSheet });

  // --- trunk: Sheet がそのまま trunk ---
  await shootAround(page, [file, addSheet], 'evolving_graph-trunk');

  // --- branch を作る ---
  await file.getByRole('button', { name: '+ branch' }).click();
  await inputDialog(page).getByRole('textbox').fill(S.branch);
  await shoot(inputDialog(page), 'evolving_graph-branch-create');
  await inputDialog(page).getByRole('button', { name: t.common.ok }).click();
  // 作っただけでは開かない。branch の行を押して開く (ヘッダに commit / merge が出る)
  const branchButton = file.getByRole('button', {
    name: S.branch,
    exact: true,
  });
  await branchButton.click();
  await expect(
    page.getByRole('button', { name: t.header.commit, exact: true }),
  ).toBeVisible({ timeout: SETTLE_TIMEOUT_MS });

  // --- branch に変更を重ねる: 主張を言い直し、メモを足す。差分の印が付く ---
  await rewriteNode(page, claimNode(page), S.branchClaim);
  await openNodeMenu(page, { x: 160, y: 600 });
  await page
    .getByRole('button', { name: t.graph.appearances.markdown, exact: true })
    .click();
  const added = page.locator(NODE).last();
  await rewriteNode(page, added, S.branchNote);
  await fitAndZoomOut(page);
  await shoot(page, 'evolving_graph-branch-diff');

  // --- commit ---
  await page
    .getByRole('button', { name: t.header.commit, exact: true })
    .click();
  const commit = page.getByRole('dialog', { name: t.commit.title });
  await commit.getByRole('textbox').fill(S.commitMessage);
  await shoot(commit, 'evolving_graph-commit');
  await commit.getByRole('button', { name: t.commit.submit }).click();
  await expect(commit).toHaveCount(0, { timeout: SETTLE_TIMEOUT_MS });

  // --- 開いている branch の行には merge・close・削除のボタンが並ぶ ---
  await branchButton.hover();
  await shootAround(
    page,
    [file, addSheet],
    'evolving_graph-branch-close-delete',
  );

  // --- その間に trunk の同じ node が書き換えられる (衝突の種) ---
  await file.getByRole('button', { name: S.ch1, exact: true }).click();
  await rewriteNode(page, claimNode(page), S.trunkClaim);

  // --- merge: 衝突 (内容) があるので merger が開く ---
  await branchButton.click();
  const merge = page.getByRole('button', { name: t.header.merge, exact: true });
  await expect(merge).toBeEnabled({ timeout: SETTLE_TIMEOUT_MS });
  await merge.click();
  const conflicts = page.getByRole('region', { name: 'conflict list' });
  await expect(conflicts).toBeVisible({ timeout: SETTLE_TIMEOUT_MS });
  await page.waitForTimeout(1000);
  await shoot(page, 'evolving_graph-merger');

  // 衝突を確かめ、merge の理由を書いて merge する
  await conflicts.getByRole('checkbox').first().check();
  await conflicts.getByRole('textbox').fill(S.mergeReason);
  await shoot(conflicts, 'evolving_graph-merge');
  await conflicts
    .getByRole('button', { name: t.merger.mergeButton, exact: true })
    .click();
  await expect(conflicts).toHaveCount(0, { timeout: SETTLE_TIMEOUT_MS });

  // --- history: timeline ---
  await file.getByRole('button', { name: S.ch1, exact: true }).click();
  // 右サイドバーを広げて timeline に切り替える
  await page
    .getByRole('button', { name: t.sidePanel.expand(t.boundary.rightSidebar) })
    .click();
  await page.getByRole('tab', { name: t.rightSidebar.panes.timeline }).click();
  await page.waitForTimeout(1000);
  await shoot(page, 'evolving_graph-timeline');

  expect(problems.list()).toEqual([]);
});
