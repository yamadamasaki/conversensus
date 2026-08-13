import { expect, type Page, test } from '@playwright/test';

/**
 * ボタンを押していないのに始まったドラッグが終わらない (ANA-125 S4 / ANA-115 再診断)
 *
 * **実 Safari + トラックパッドで観測した本当の症状**である。当初 #51 のコメントには
 * 「ノードがカーソルに付いてくる」とあったが, 実際は次のとおりだった。
 *
 * - ノードでも画面全体でも起きる (掴んだ先による)
 * - **トラックパッドのタップでのみ起きる。押し込んだドラッグでは起きない**
 * - WebKit はタップの `pointerdown` を **`buttons=0` / `pressure=0`** で配送し,
 *   さらに `pointerup` を `pointerdown` より**先に**配送することがある。
 *   先に来た `pointerup` は誰も待っていないので捨てられ, 後から来た `pointerdown` で
 *   始まったドラッグには**終わらせる `pointerup` が残っていない**
 * - その間 `pointermove` の `buttons` は **0** である (正常なドラッグ中は 1)。
 *   実測: 正常 = `down buttons=1 pressure=0.5` / 暴走 = `down buttons=0 pressure=0`
 *
 * ここでは**タップ相当の `pointerdown` (buttons=0) を直接投げて**再現する。
 * `page.mouse` は必ず `buttons=1` を立てるので, これは合成でしか作れない。
 */

const NODE = '.react-flow__node';
const PANE = '.react-flow__pane';

/** ノードの画面上の位置 (React Flow は transform で動かす) */
async function nodeTransform(page: Page): Promise<string> {
  return await page
    .locator(NODE)
    .first()
    .evaluate((el) => (el as HTMLElement).style.transform);
}

/** キャンバスの平行移動 */
async function viewportTransform(page: Page): Promise<string> {
  return await page
    .locator('.react-flow__viewport')
    .evaluate((el) => (el as HTMLElement).style.transform);
}

/**
 * トラックパッドのタップ相当 — **ボタンを押していない** mousedown。
 *
 * **ページの中で組み立てる。** React Flow のドラッグは d3-drag で動き,
 * d3-drag は `event.view` にリスナを張る。Playwright の `dispatchEvent` は view を
 * 立てないので, 外から投げても何も始まらない (実測)。
 */
async function tapMouseDown(
  page: Page,
  selector: string,
  at: { clientX: number; clientY: number },
) {
  await page.evaluate(
    ({ selector, at }) => {
      const target = document.querySelector(selector);
      if (!target) throw new Error(`${selector} が無い`);
      target.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          button: 0,
          buttons: 0,
          ...at,
        }),
      );
    },
    { selector, at },
  );
}

/** ボタンを押していない mousemove (押していれば buttons=1 になる) */
async function moveWithoutButton(
  page: Page,
  at: { clientX: number; clientY: number },
) {
  await page.evaluate((at) => {
    window.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        buttons: 0,
        ...at,
      }),
    );
  }, at);
}

async function setUpNode(page: Page) {
  await page.goto('/');
  await page.getByPlaceholder('ファイル名').fill(`tap-${Date.now()}`);
  await page.getByPlaceholder('ファイル名').press('Enter');
  await expect(page.locator(PANE)).toBeVisible();
  await page.locator(PANE).dblclick({ position: { x: 200, y: 200 } });
  await page.getByRole('button', { name: 'Markdown' }).click();
  await expect(page.locator(NODE)).toHaveCount(1);
}

test.describe('ボタンを押していないポインタ (トラックパッドのタップ)', () => {
  test('ノードがカーソルに付いてこない', async ({ page }) => {
    await setUpNode(page);
    const box = await page.locator(NODE).first().boundingBox();
    if (!box) throw new Error('ノードの位置が取れない');
    const center = {
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height / 2,
    };

    const before = await nodeTransform(page);

    await tapMouseDown(page, NODE, center);
    // タップの後にカーソルだけ動かす。ここで動けばドラッグが終わっていない
    await moveWithoutButton(page, {
      clientX: center.clientX + 60,
      clientY: center.clientY + 40,
    });
    await moveWithoutButton(page, {
      clientX: center.clientX + 120,
      clientY: center.clientY + 80,
    });

    expect(await nodeTransform(page)).toBe(before);
  });

  test('押し込んだドラッグは今までどおりノードを動かす', async ({ page }) => {
    // **打ち切りの guard が本物のドラッグを壊していないこと。**
    // `page.mouse` は押下中の移動に buttons=1 を立てるので, 正常な列になる
    await setUpNode(page);
    const box = await page.locator(NODE).first().boundingBox();
    if (!box) throw new Error('ノードの位置が取れない');
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const before = await nodeTransform(page);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(from.x + i * 8, from.y + i * 5);
    }
    await page.mouse.up();

    expect(await nodeTransform(page)).not.toBe(before);
  });

  test('キャンバスがカーソルに付いてこない', async ({ page }) => {
    await setUpNode(page);
    const before = await viewportTransform(page);

    await tapMouseDown(page, PANE, { clientX: 600, clientY: 400 });
    await moveWithoutButton(page, { clientX: 660, clientY: 440 });
    await moveWithoutButton(page, { clientX: 720, clientY: 480 });

    expect(await viewportTransform(page)).toBe(before);
  });
});
