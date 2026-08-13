import { expect, test } from '@playwright/test';

/**
 * サイドバーのレイアウト (ANA-125 S1 / GitHub #51)
 *
 * WebKit では新規作成の行が溢れ, import ボタンがサイドバーの外へ押し出されて
 * **押せなくなる**。仕様は「行が溢れないこと」「ボタンが押せること」であって
 * 「特定のピクセル値」ではないので, 実測値ではなく**関係**を検査する。
 */

const IMPORT_BUTTON = 'button[title="インポート (.conversensus)"]';

/** 新規作成の行 (ファイル名入力 + 追加 + import) の寸法を測る */
async function measureHeaderRow(page: import('@playwright/test').Page) {
  return await page.evaluate((importSelector) => {
    const nameInput = document.querySelector<HTMLInputElement>(
      'input[placeholder="ファイル名"]',
    );
    if (!nameInput?.parentElement)
      throw new Error('新規作成の行が見付からない');
    const row = nameInput.parentElement;
    const importBtn = document.querySelector<HTMLButtonElement>(importSelector);
    if (!importBtn) throw new Error('import ボタンが見付からない');

    const box = importBtn.getBoundingClientRect();
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const atCenter = document.elementFromPoint(center.x, center.y);

    return {
      // 溢れていれば scrollWidth が clientWidth を上回る
      rowScrollWidth: row.scrollWidth,
      rowClientWidth: row.clientWidth,
      importRight: Math.round(box.right),
      rowRight: Math.round(row.getBoundingClientRect().right),
      // 押した先がボタン自身か (外に出ているとキャンバス側の要素が返る)
      centerHitsButton: atCenter === importBtn || importBtn.contains(atCenter),
      centerHit: atCenter?.tagName ?? 'null',
    };
  }, IMPORT_BUTTON);
}

test.describe('サイドバーの新規作成の行 (#51)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('ファイル名')).toBeVisible();
  });

  test('行が溢れない', async ({ page }) => {
    const row = await measureHeaderRow(page);

    expect(row.rowScrollWidth).toBeLessThanOrEqual(row.rowClientWidth);
  });

  test('import ボタンが行の内側に収まる', async ({ page }) => {
    const row = await measureHeaderRow(page);

    expect(row.importRight).toBeLessThanOrEqual(row.rowRight);
  });

  test('import ボタンの中心が押せる', async ({ page }) => {
    // **見えていても押せない**のが #51 の分かりにくいところである。
    // はみ出した部分の最前面はキャンバス側の要素になる
    const row = await measureHeaderRow(page);

    expect(row.centerHitsButton, `中心にあるのは ${row.centerHit}`).toBe(true);
  });

  test('import ボタンを押すとファイル選択が開く', async ({ page }) => {
    // 症状の言葉どおりの検査。レイアウトが直っても配線が切れていれば落ちる
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click(IMPORT_BUTTON),
    ]);

    expect(chooser.isMultiple()).toBe(false);
  });
});

test.describe('サイドバーのファイル一覧', () => {
  test('長いファイル名でも行が溢れない', async ({ page }) => {
    // #51 と**同じ形** (`flex: 1` の子 + 固定幅のボタン) がファイル行にもある。
    // そちらは `overflow: hidden` を持つので自動最小サイズが効かず縮む**はず**である。
    // 理屈で済ませずここで固定する — 縮まなければ設定ボタンが押せなくなる
    await page.goto('/');
    const nameInput = page.getByPlaceholder('ファイル名');
    await expect(nameInput).toBeVisible();

    await nameInput.fill('あ'.repeat(60));
    await nameInput.press('Enter');
    // ギアボタンの表示は「⚙」なので, 名前ではなく title で引く
    await expect(page.locator('button[title="設定"]').first()).toBeVisible();

    const row = await page.evaluate(() => {
      const target = document.querySelector<HTMLButtonElement>(
        'button[title="設定"]',
      );
      if (!target?.parentElement) throw new Error('ファイル行が見付からない');
      const fileRow = target.parentElement;
      return {
        scrollWidth: fileRow.scrollWidth,
        clientWidth: fileRow.clientWidth,
        gearRight: Math.round(target.getBoundingClientRect().right),
        rowRight: Math.round(fileRow.getBoundingClientRect().right),
      };
    });

    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
    expect(row.gearRight).toBeLessThanOrEqual(row.rowRight);
  });
});
