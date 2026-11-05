import { type Browser, expect, type Page, test } from '@playwright/test';
import { collectPageProblems } from '../../../tests/pageProblems';
import { type Account, HANAKO, login, recreateAccount, TARO } from './accounts';
import { buildScene, coverBlob, S } from './scene';
import {
  fileItem,
  hideMap,
  importScene,
  NODE,
  nodeWith,
  openNodeMenu,
  openSheet,
  renderCover,
  rewriteNode,
  SETTLE_TIMEOUT_MS,
  shoot,
  t,
} from './support';

/** 相手の編集が届くのを待つ上限 (流れの合図が無ければ定期同期の 30 秒) */
const SYNC_TIMEOUT_MS = 45_000;

/** その人の origin の保存領域を持つ、別のブラウザの窓 */
async function windowFor(browser: Browser, account: Account): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  // 参加コードは「コードをコピー」でクリップボードへ写る。読むのに権限が要る
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: account.origin,
  });
  return context.newPage();
}

/**
 * 読み込みの失敗のうち、起きてよいもの。コンソールには URL が出ないので、応答の側で数えておき、
 * その数だけ「Failed to load resource」を問題から外す
 *
 * - `/oauth/par` の 400 `use_dpop_nonce`: DPoP の nonce の受け渡し。OAuth のライブラリがやり直す
 */
function expectedFailures(page: Page): string[] {
  const seen: string[] = [];
  page.on('response', (response) => {
    const url = response.url();
    const status = response.status();
    if (status === 400 && url.includes('/oauth/par')) seen.push(url);
  });
  return seen;
}

const LOAD_FAILED = 'console.error: Failed to load resource';

/**
 * 起きてよい問題の文言。
 *
 * - 通信を切った間の送信の失敗: 衝突を起こすために taro の通信をわざと切る
 */
const EXPECTED_PROBLEMS = [/net::ERR_INTERNET_DISCONNECTED$/];

function withoutExpected(problems: string[], expected: string[]): string[] {
  let allowance = expected.length;
  return problems.filter((problem) => {
    if (EXPECTED_PROBLEMS.some((pattern) => pattern.test(problem)))
      return false;
    if (allowance > 0 && problem.startsWith(LOAD_FAILED)) {
      allowance -= 1;
      return false;
    }
    return true;
  });
}

function participantsOf(page: Page) {
  return page.getByRole('dialog', { name: t.sidebar.participants });
}

async function openParticipants(page: Page) {
  // 共有中はボタンの名前 (accessible name) が人数だけになるので、title で引く
  await fileItem(page, S.file)
    .locator(`button[title^="${t.sidebar.participants}"]`)
    .first()
    .click();
  await expect(participantsOf(page)).toBeVisible();
}

/**
 * 6 章 グラフで対話する。
 *
 * 開発用の PDS に、図のためだけの 2 人 (hanako / taro) を作り直してから撮る (`accounts.ts`)。
 * 2 人は別のポート (= 別の origin = 別の保存領域) で開く
 */
test('参加依頼、参加、一緒に編集、衝突、離脱', async ({
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  await recreateAccount(HANAKO);
  await recreateAccount(TARO);
  const hanako = await windowFor(browser, HANAKO);
  const taro = await windowFor(browser, TARO);
  const problems = [collectPageProblems(hanako), collectPageProblems(taro)];
  const expected = [expectedFailures(hanako), expectedFailures(taro)];

  // --- hanako: ログインして File を用意し、taro に参加を依頼する ---
  await login(hanako, HANAKO);
  const cover = await coverBlob(await renderCover(hanako, S.cover));
  await importScene(hanako, buildScene(cover), testInfo);
  await openSheet(hanako, S.file, S.ch1);
  await hideMap(hanako);
  await openParticipants(hanako);
  const dialog = participantsOf(hanako);
  await dialog
    .getByPlaceholder(t.invitation.handlesPlaceholder)
    .fill(TARO.handle);
  await dialog.getByRole('button', { name: t.invitation.invite }).click();
  const copy = dialog.getByRole('button', { name: t.invitation.copyCode });
  await expect(copy).toBeVisible({ timeout: SETTLE_TIMEOUT_MS });
  await shoot(dialog, 'interact_with_graphs-invite');
  await copy.click();
  const code = await hanako.evaluate(() => navigator.clipboard.readText());
  expect(code.length).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: t.common.close }).click();

  // --- taro: ログインして、参加コードで参加する ---
  await login(taro, TARO);
  await taro
    .getByRole('button', { name: t.sidebar.participate, exact: true })
    .click();
  const participate = taro.getByRole('dialog', { name: t.participate.title });
  await participate.getByLabel(t.participate.code).fill(code);
  await participate
    .getByRole('button', { name: t.common.ok, exact: true })
    .click();
  const accept = taro.getByRole('dialog', { name: t.acceptInvitation.title });
  await expect(accept).toBeVisible({ timeout: SYNC_TIMEOUT_MS });
  await shoot(accept, 'interact_with_graphs-accept');
  await accept
    .getByRole('button', { name: t.acceptInvitation.accept, exact: true })
    .click();
  await expect(
    taro.getByRole('button', { name: S.file, exact: true }),
  ).toBeVisible({ timeout: SYNC_TIMEOUT_MS });

  // --- hanako: 参加者一覧 (2 人とも参加中) ---
  await openParticipants(hanako);
  await expect(
    participantsOf(hanako).getByText(t.invitation.status.accepted),
  ).toHaveCount(2, {
    timeout: SYNC_TIMEOUT_MS,
  });
  await shoot(participantsOf(hanako), 'interact_with_graphs-participants');
  await participantsOf(hanako)
    .getByRole('button', { name: t.common.close })
    .click();

  // --- 一緒に編集する: taro がメモを足し、hanako の画面に届く ---
  // 参加した File は畳まれて並ぶ。押して開くと Sheet の一覧が出る
  await taro.getByRole('button', { name: S.file, exact: true }).click();
  await openSheet(taro, S.file, S.ch1);
  await hideMap(taro);
  await openNodeMenu(taro, { x: 160, y: 620 });
  await taro
    .getByRole('button', { name: t.graph.appearances.markdown, exact: true })
    .click();
  await rewriteNode(taro, taro.locator(NODE).last(), S.taroNote);
  await expect(nodeWith(hanako, S.taroNote)).toBeVisible({
    timeout: SYNC_TIMEOUT_MS,
  });
  await hanako
    .getByRole('button', { name: t.sidePanel.expand(t.boundary.rightSidebar) })
    .click();
  await hanako
    .getByRole('tab', { name: t.rightSidebar.panes.timeline })
    .click();
  // 「N 件の変更」を開くと、変更ごとに誰が行ったかが並ぶ
  const changes = new RegExp(t.timeline.changes(0).replace('0', '\\d+'));
  await hanako.getByText(changes).first().click();
  await hanako.waitForTimeout(1000);
  await shoot(hanako, 'interact_with_graphs-timeline');

  // --- 衝突: taro が通信の切れている間に、2 人が同じ主張を書き換える ---
  await taro.context().setOffline(true);
  await rewriteNode(taro, nodeWith(taro, S.claimLabel), S.taroClaim);
  await rewriteNode(hanako, nodeWith(hanako, S.claimLabel), S.hanakoClaim);
  await hanako.waitForTimeout(3000);
  await taro.context().setOffline(false);
  const noticeOf = (page: Page) =>
    // 通知は status の役割で出る。役割に頼らず、名前 (aria-label) で引く
    page
      .locator(`[aria-label="${t.conflicts.region}"]`)
      .or(page.locator(`[aria-label="${t.overwrites.region}"]`))
      .first();
  // 衝突は taro の側で見つかり、保留として hanako にも届く。図は hanako の窓で撮る
  await noticeOf(taro).waitFor({ timeout: SYNC_TIMEOUT_MS * 2 });
  const shown = (await noticeOf(hanako)
    .waitFor({ timeout: SYNC_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false))
    ? hanako
    : taro;
  await shown.waitForTimeout(2000);
  await shoot(shown, 'interact_with_graphs-conflict');

  // --- 離れる: taro が参加を取りやめる ---
  await openParticipants(taro);
  const taroRow = participantsOf(taro)
    .getByRole('row')
    .filter({ hasText: TARO.handle });
  await taroRow
    .getByRole('button', { name: t.invitation.actions.resign })
    .click();
  const confirm = taro
    .getByRole('alertdialog')
    .or(taro.getByRole('dialog').last());
  const ok = confirm.getByRole('button', { name: t.common.ok, exact: true });
  if (await ok.isVisible().catch(() => false)) await ok.click();
  await expect(
    participantsOf(taro).getByText(t.invitation.status.resigned),
  ).toBeVisible({ timeout: SYNC_TIMEOUT_MS });
  await shoot(participantsOf(taro), 'interact_with_graphs-leave');

  problems.forEach((p, i) => {
    expect(withoutExpected(p.list(), expected[i] ?? [])).toEqual([]);
  });
});
