import { expect, test } from '@playwright/test';
import { collectPageProblems } from './pageProblems';

/**
 * ノードのサイズ変更 (ANA-125 S4 / ResizeObserver ループ通知)
 *
 * **WebKit だけ**, サイズ変更ハンドルを掴んで動かすと
 * `ResizeObserver loop completed with undelivered notifications.` が未処理例外として
 * 上がり続ける (実 Safari の使い込みで数百件)。出所は `@xyflow/react` の中の
 * ResizeObserver なのでアプリ側に直す場所が無く, **メッセージを限定して握り潰した**
 * (`src/client/src/suppressResizeObserverLoop.ts`)。ここはその回帰である。
 *
 * このテストは**抑止を入れる前は webkit で赤かった** (chromium は元から緑)。
 */

const NODE = '.react-flow__node';
const PANE = '.react-flow__pane';
const RESIZE_HANDLE = '.react-flow__resize-control.bottom.right';

test('サイズ変更ハンドルを動かしても未処理例外が出ない', async ({ page }) => {
  const problems = collectPageProblems(page);

  await page.goto('/');
  await page.getByPlaceholder('ファイル名').fill(`resize-${Date.now()}`);
  await page.getByPlaceholder('ファイル名').press('Enter');
  await expect(page.locator(PANE)).toBeVisible();

  await page.locator(PANE).dblclick({ position: { x: 200, y: 200 } });
  await page.getByRole('button', { name: 'Markdown' }).click();

  // 選択するとハンドルが出る (NodeResizer は selected のときだけ描かれる)
  const node = page.locator(NODE).first();
  await node.click();
  const handle = page.locator(RESIZE_HANDLE).first();
  await expect(handle).toBeVisible();

  const before = await node.boundingBox();
  const grip = await handle.boundingBox();
  if (!before || !grip) throw new Error('ノードかハンドルの位置が取れない');

  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  // **1 回で運ばない。** 通知のループはフレームをまたいで積み上がるので,
  // 刻んで動かさないと再現しない
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(grip.x + i * 6, grip.y + i * 4);
  }
  await page.mouse.up();

  // 実際に大きくなったことを見る — ハンドルを掴み損ねていても
  // 「例外 0 件」だけなら通ってしまう
  const after = await node.boundingBox();
  if (!after) throw new Error('ノードの位置が取れない');
  expect(after.width).toBeGreaterThan(before.width);

  expect(problems.list()).toEqual([]);
});
