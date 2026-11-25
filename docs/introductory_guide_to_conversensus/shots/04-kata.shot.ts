import { expect, type Locator, type Page, test } from '@playwright/test';
import { collectPageProblems } from '../../../tests/pageProblems';
import { buildScene, buildTemplateScene, coverBlob, S } from './scene';
import {
  fileItem,
  fitAndZoomOut,
  hideMap,
  importScene,
  NODE,
  nodeWith,
  openApplyTemplate,
  openNodeMenu,
  openSheet,
  PANE,
  renderCover,
  rewriteNode,
  SETTLE_TIMEOUT_MS,
  shoot,
  shootAround,
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

/** edge (React Flow が描く線の `g`) */
const EDGE = '.react-flow__edge';

/** 右サイドバーを広げる (畳まれているときだけ) */
async function expandRightSidebar(page: Page) {
  const expand = page.getByRole('button', {
    name: t.sidePanel.expand(t.boundary.rightSidebar),
  });
  if (await expand.isVisible()) await expand.click();
}

/** 右サイドバーの property の区画 */
function propertyRegion(page: Page): Locator {
  return page.getByRole('complementary').last().getByRole('region').first();
}

/**
 * 種類のメニューから種類を選んで node を作る。場面の node にも同じ文字があるので、node の外
 * (メニュー) のボタンに限る
 */
async function createKindNode(
  page: Page,
  kind: string,
  at: { x: number; y: number },
) {
  const before = await page.locator(NODE).count();
  await openNodeMenu(page, at);
  await page
    .locator(`button:not(${NODE} *)`)
    .filter({ hasText: new RegExp(`^${kind}$`) })
    .first()
    .click();
  await expect(page.locator(NODE)).toHaveCount(before + 1, {
    timeout: SETTLE_TIMEOUT_MS,
  });
}

/**
 * 2 つの node を edge で繋ぐ: 始点の右の接続点から、終点の左の接続点へドラッグする
 * (接続は Loose なので、接続点はどれも source。`ImageNode`・`EditableNode` の id)
 */
async function connect(page: Page, from: Locator, to: Locator) {
  const start = await from
    .locator('.react-flow__handle[data-handleid="source-right"]')
    .boundingBox();
  const end = await to
    .locator('.react-flow__handle[data-handleid="source-left"]')
    .boundingBox();
  if (!start || !end) throw new Error('接続点の位置が取れない');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
}

/**
 * label の文字が `label` の edge を選ぶ。label の枠はクリックを自分で受ける (ドラッグで動かすため) ので、
 * 線の上の点 (label から外れた所) を押す。どの線の label かは、線の中点がいちばん近い label で決める
 */
async function selectEdgeLabelled(page: Page, label: string) {
  const point = await page.evaluate(
    ({ edgeSelector, label }) => {
      const spans = [
        ...document.querySelectorAll('.react-flow__edgelabel-renderer span'),
      ].filter((e) => e.textContent === label);
      const rect = spans[0]?.getBoundingClientRect();
      if (!rect) return null;
      const center = {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      };
      const onScreen = (path: SVGPathElement, at: number) => {
        const p = path.getPointAtLength(at);
        const m = path.getScreenCTM();
        if (!m) return { x: p.x, y: p.y };
        return {
          x: m.a * p.x + m.c * p.y + m.e,
          y: m.b * p.x + m.d * p.y + m.f,
        };
      };
      let best: { x: number; y: number } | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const g of document.querySelectorAll(edgeSelector)) {
        const path = g.querySelector<SVGPathElement>(
          'path[stroke="transparent"]',
        );
        if (!path) continue;
        const length = path.getTotalLength();
        const mid = onScreen(path, length / 2);
        const distance = Math.hypot(mid.x - center.x, mid.y - center.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = onScreen(path, length * 0.2);
        }
      }
      return best;
    },
    { edgeSelector: EDGE, label },
  );
  if (!point) throw new Error(`label が ${label} の edge が見つからない`);
  await page.mouse.click(point.x, point.y);
}

/**
 * template graph を手で書いて当て、育てる (template-update 段 3 G1)。
 * 種類の書き方 → 宣言 → 後から当てる → 種類のメニュー → 既定値と本文の案内 → template graph を直す →
 * 新しい版の知らせ → 最新の版にする (違反の印) → 外す入口
 */
test('template graph を書いて当て、育てる', async ({ page }, testInfo) => {
  const T = S.template;
  const problems = collectPageProblems(page);
  await page.goto('/');
  await importScene(page, buildTemplateScene(), testInfo);

  // 手で書いた template graph
  await openSheet(page, S.file, T.name);
  await hideMap(page);
  await expect(page.locator(NODE)).toHaveCount(5, {
    timeout: SETTLE_TIMEOUT_MS,
  });
  await fitAndZoomOut(page);
  await shoot(page, 'graph_kata-template-kinds');

  // 「主張」の property の宣言 (型・適用先で編集できる)
  await nodeWith(page, T.claimHint).click({ position: { x: 20, y: 40 } });
  await expandRightSidebar(page);
  await expect(page.getByLabel(t.property.typeOf(T.certainty))).toBeVisible({
    timeout: SETTLE_TIMEOUT_MS,
  });
  await shoot(propertyRegion(page), 'graph_kata-template-schema');

  // まだ何も当てていない Sheet に後から当てる
  await openSheet(page, S.file, T.notes);
  const dialog = await openApplyTemplate(page, S.file, T.notes);
  await dialog.getByLabel(T.name).check();
  await dialog
    .getByRole('button', { name: t.templateApply.applySubmit, exact: true })
    .click();
  await expect(dialog).toBeHidden();

  // 見た目の下に、その見た目の種類が並ぶ
  await openNodeMenu(page, { x: 300, y: 200 });
  await page.waitForTimeout(300);
  await shoot(page, 'graph_kata-template-kind-menu');
  await page.keyboard.press('Escape');

  // 根拠と主張を作って繋ぐ (種類が 1 つに決まるので「支える」が付く)
  await createKindNode(page, T.ground, { x: 60, y: 260 });
  await createKindNode(page, T.claim, { x: 560, y: 260 });
  // 作る位置は画面の座標なので、拡大の度合いによっては 2 つが近すぎて線がラベルに隠れる。
  // 「主張」を node 1 つ分右へずらし、線 (後で違反の破線になる) が見えるようにする
  const claimBox = await nodeWith(page, T.claimHint).boundingBox();
  if (!claimBox) throw new Error('「主張」の位置が取れない');
  await page.mouse.move(claimBox.x + claimBox.width / 2, claimBox.y + 12);
  await page.mouse.down();
  await page.mouse.move(claimBox.x + claimBox.width * 1.5, claimBox.y + 12, {
    steps: 8,
  });
  await page.mouse.up();
  const ground = nodeWith(page, T.ground);
  await rewriteNode(page, ground, T.groundText);
  const claim = nodeWith(page, T.claimHint);
  await connect(page, nodeWith(page, T.groundText), claim);
  await expect(page.locator(EDGE)).toHaveCount(1, {
    timeout: SETTLE_TIMEOUT_MS,
  });
  await expect(page.getByText(T.supports, { exact: true })).toBeVisible();

  // 主張の property: 補った既定値・選択肢・固定の値。本文の案内も node に出ている
  await claim.click({ position: { x: 20, y: 40 } });
  await expandRightSidebar(page);
  await expect(page.getByText(t.property.readOnly.templateFixed)).toBeVisible({
    timeout: SETTLE_TIMEOUT_MS,
  });
  await fitAndZoomOut(page);
  await shoot(page, 'graph_kata-template-defaults');

  // template graph を直す: 「支える」の edge を消す
  await openSheet(page, S.file, T.name);
  await expect(page.locator(EDGE)).toHaveCount(2, {
    timeout: SETTLE_TIMEOUT_MS,
  });
  await selectEdgeLabelled(page, T.supports);
  await page.keyboard.press('Delete');
  await expect(page.locator(EDGE)).toHaveCount(1, {
    timeout: SETTLE_TIMEOUT_MS,
  });

  // 当てた Sheet に戻ると、右下に新しい版の知らせが出ている
  await openSheet(page, S.file, T.notes);
  const notices = page.getByRole('status', { name: t.notices.templateRegion });
  await expect(
    notices.getByText(t.notices.templateNewer(T.notes, T.name)),
  ).toBeVisible({
    timeout: SETTLE_TIMEOUT_MS,
  });
  await shoot(notices, 'graph_kata-template-newer');

  // 最新の版にする: 種類の無くなった「支える」は消えずに残り、警告色の破線になる
  await notices.getByRole('button', { name: t.notices.templatePull }).click();
  await expect(page.locator('[data-edge-violation]')).toHaveCount(1, {
    timeout: SETTLE_TIMEOUT_MS,
  });
  await page.locator(PANE).click({ position: { x: 20, y: 20 } });
  await shootAround(
    page,
    [nodeWith(page, T.groundText), nodeWith(page, T.claimHint)],
    'graph_kata-template-violation',
  );

  // 後から当てたので、「…」に外す入口がある
  const sheetButton = fileItem(page, S.file)
    .getByRole('button')
    .filter({ hasText: new RegExp(`^${T.notes}$`) })
    .first();
  await sheetButton
    .locator('xpath=..')
    .getByRole('button', { name: t.sidebar.details })
    .click();
  const detach = page.getByRole('button', {
    name: t.settings.detachTemplate(T.name),
  });
  await expect(detach).toBeVisible({ timeout: SETTLE_TIMEOUT_MS });
  await shoot(
    detach.locator('xpath=ancestor::div[contains(@style, "z-index")][1]'),
    'graph_kata-template-detach',
  );

  expect(problems.list()).toEqual([]);
});
