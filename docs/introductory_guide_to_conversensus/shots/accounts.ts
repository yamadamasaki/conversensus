/**
 * 6 章 (グラフで対話する) の 2 人のアカウント (step4)
 *
 * 開発用の PDS (localhost:3000) に、図のためだけのアカウントを**撮るたびに作り直す**。
 * 普段の alice.test / bob.test には開発で作った File が溜まっていて、ログインするとそれが
 * サイドバーに並ぶ。作り直せば、写るのは場面の File だけになる。
 *
 * 管理者のパスワードは環境変数 `PDS_ADMIN_PASSWORD`。無ければ開発用の値
 * (`deepse/requirements/operation-manual-for-dev.md` に載っているもの) を使う。**本番の PDS には向けない**
 */

import type { Page } from '@playwright/test';
import { SHOTS_CLIENT_PORT, SHOTS_PEER_PORT } from '../../../tests/ports';
import { t } from './support';

const PDS_URL = 'http://localhost:3000';
const DEV_ADMIN_PASSWORD = '7147f1f843bbf2a2f97b69a30d797543';
const PASSWORD = 'devpassword123';

export type Account = { handle: string; origin: string };

/** 1 人目 (File を作り、参加を依頼する) と 2 人目 (参加する) */
export const HANAKO: Account = {
  handle: 'hanako.test',
  origin: `http://127.0.0.1:${SHOTS_CLIENT_PORT}`,
};
export const TARO: Account = {
  handle: 'taro.test',
  origin: `http://127.0.0.1:${SHOTS_PEER_PORT}`,
};

function adminAuth(): string {
  const password = process.env.PDS_ADMIN_PASSWORD ?? DEV_ADMIN_PASSWORD;
  return `Basic ${btoa(`admin:${password}`)}`;
}

async function xrpc(
  method: string,
  options: { body?: unknown; query?: string; admin?: boolean } = {},
): Promise<Response> {
  const url = `${PDS_URL}/xrpc/${method}${options.query ? `?${options.query}` : ''}`;
  return fetch(url, {
    method: options.body === undefined ? 'GET' : 'POST',
    headers: {
      ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
      ...(options.admin && { Authorization: adminAuth() }),
    },
    ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
  });
}

/** アカウントを消して作り直す (前回の撮影の File を残さない) */
export async function recreateAccount(account: Account): Promise<void> {
  const resolved = await xrpc('com.atproto.identity.resolveHandle', {
    query: `handle=${account.handle}`,
  });
  if (resolved.ok) {
    const { did } = (await resolved.json()) as { did: string };
    const deleted = await xrpc('com.atproto.admin.deleteAccount', {
      body: { did },
      admin: true,
    });
    if (!deleted.ok) throw new Error(`消せない: ${await deleted.text()}`);
  }
  const invite = await xrpc('com.atproto.server.createInviteCode', {
    body: { useCount: 1 },
    admin: true,
  });
  if (!invite.ok)
    throw new Error(`招待コードを作れない: ${await invite.text()}`);
  const { code } = (await invite.json()) as { code: string };
  const created = await xrpc('com.atproto.server.createAccount', {
    body: {
      handle: account.handle,
      email: `${account.handle}@example.test`,
      password: PASSWORD,
      inviteCode: code,
    },
  });
  if (!created.ok) throw new Error(`作れない: ${await created.text()}`);
}

/** アプリから OAuth でログインし、アプリに戻るまで待つ (PDS のページの文言は言語で変わるので型で引く) */
export async function login(page: Page, account: Account): Promise<void> {
  await page.goto(`${account.origin}/`);
  await page.getByRole('button', { name: t.sidebar.login }).click();
  await page.getByLabel(t.login.handle).fill(account.handle);
  await page.getByRole('button', { name: t.login.submit, exact: true }).click();
  await page.waitForURL(/localhost:3000\/oauth/);
  await page.locator('input[type=password]').fill(PASSWORD);
  await page.locator('button[type=submit]').click();
  // 承認の画面。承認のボタンは submit で、拒否は別のボタン
  await page.locator('button[type=submit]').click();
  await page.waitForURL(`${account.origin}/**`);
  await page
    .getByRole('button', { name: t.sidebar.logout })
    .waitFor({ timeout: 30_000 });
}
