import { expect, type Locator, type Page, test } from '@playwright/test';
import { collectPageProblems } from './pageProblems';

/**
 * 通しスモーク (ANA-125 S2)
 *
 * ファイル作成 → ノード作成 → ノード編集 → シート追加 → シート切替 → export →
 * import → 画像 drop を **1 本の導線として** WebKit で通す。
 *
 * ここの合格条件は 2 つある。
 *
 * 1. 各操作の**結果**が画面と往復した状態に出ていること (ノードが増える, 文字が残る,
 *    シートを往復しても消えない, import した先に同じノードが居る)
 * 2. **未処理例外・コンソールエラー・読み込み失敗が 0 件**であること (計画書 D2)。
 *    step1 では PDS への送信が数週間全滅していたのに画面は正常に見えた前例があり,
 *    「見えている」を合格条件にすると同じ穴を空ける
 *
 * **エンジン間で壊れるものだけを見る**ので, 個々の機能の網羅は単体テストに任せてある。
 */

/** 画面の反映を待つときの上限。blob の往復 (保存 → 取得) を含むので長めに取る */
const SETTLE_TIMEOUT_MS = 15_000;
/** 落とす画像の一辺 (px)。中身は問わないので小さくてよい */
const DROPPED_IMAGE_SIZE = 8;

const IMPORT_BUTTON = 'button[title="インポート (.conversensus)"]';
const NODE = '.react-flow__node';
const PANE = '.react-flow__pane';

/**
 * このテスト用のファイル名。
 *
 * **プロジェクト (webkit / chromium) をまたいで一意にする。** `webServer` はテスト全体で
 * 1 つなので, 2 つ目のエンジンは 1 つ目が作ったファイルが残っているデーモンを見る。
 * 名前で引く検査が隣のエンジンの残骸に当たらないようにする。
 */
function uniqueFileName(projectName: string): string {
  return `通し-${projectName}-${Date.now()}`;
}

/** ファイル名のボタンを持つ最も外側の `li` (ファイル行 + シート一覧を含む) */
function fileItem(page: Page, fileName: string): Locator {
  return page
    .locator('li')
    .filter({ has: page.getByRole('button', { name: fileName, exact: true }) })
    .first();
}

/** pane をダブルクリックしてノード種別メニューから作る (設計 D5 の生成導線) */
async function createNode(page: Page, at: { x: number; y: number }) {
  await page.locator(PANE).dblclick({ position: at });
  await page.getByRole('button', { name: 'Markdown' }).click();
}

test.describe('通しスモーク (ANA-125 S2)', () => {
  test('作成から画像 drop まで通しで動き, 無言の失敗が出ない', async ({
    page,
  }, testInfo) => {
    // **最初に仕掛ける。** 途中で仕掛けると, それ以前の失敗を見逃す
    const problems = collectPageProblems(page);
    const fileName = uniqueFileName(testInfo.project.name);
    const nodeText = 'こんにちは';

    await page.goto('/');

    // --- ファイル作成 ---
    await page.getByPlaceholder('ファイル名').fill(fileName);
    await page.getByPlaceholder('ファイル名').press('Enter');
    // 作成した直後は最初のシートが開く = キャンバスが出る
    await expect(page.locator(PANE)).toBeVisible({
      timeout: SETTLE_TIMEOUT_MS,
    });

    // --- ノード作成 ---
    await createNode(page, { x: 200, y: 200 });
    await expect(page.locator(NODE)).toHaveCount(1);

    // --- ノード編集 ---
    await page.locator(NODE).dblclick();
    const editor = page.locator(`${NODE} textarea`);
    await expect(editor).toBeVisible();
    await editor.fill(nodeText);
    // blur で確定する (Escape は破棄)
    await page.locator(PANE).click({ position: { x: 400, y: 400 } });
    await expect(page.locator(NODE)).toContainText(nodeText);

    // --- シート追加 → 往復 ---
    await page.getByRole('button', { name: '+ シートを追加' }).click();
    // 追加したシートは空である。**ここが 0 でなければシートの切り替えが効いていない**
    await expect(page.locator(NODE)).toHaveCount(0);
    const item = fileItem(page, fileName);
    await item.getByRole('button', { name: 'Sheet 1', exact: true }).click();
    // 戻ったら編集が残っている (シート切替で React Flow を再 seed する経路の検査)
    await expect(page.locator(NODE)).toContainText(nodeText);

    // --- export ---
    await item.locator('button[title="設定"]').first().click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page
        .getByRole('button', { name: 'エクスポート (.conversensus)' })
        .click(),
    ]);
    const exported = await download.path();
    expect(exported).toBeTruthy();
    // ポップアップは export では閉じない。外クリックと同じ「破棄して閉じる」で畳む
    await page.keyboard.press('Escape');

    // --- import ---
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click(IMPORT_BUTTON),
    ]);
    await chooser.setFiles(exported);
    // 同じ名前のファイルが 2 つになる (元 + 取り込んだもの)
    await expect(
      page.getByRole('button', { name: fileName, exact: true }),
    ).toHaveCount(2, { timeout: SETTLE_TIMEOUT_MS });
    // 取り込んだ側が開き, 中身が入っている
    await expect(page.locator(NODE)).toContainText(nodeText);

    // --- 画像 drop ---
    // **合成イベントで落とす。** 実 OS のドラッグは Playwright からは作れないので,
    // ここで見られるのは「drop を受けてから blob が画面に出るまで」の配線である
    // (トラックパッド由来の挙動は S4 で実機を見る)。
    const dataTransfer = await page.evaluateHandle(async (size: number) => {
      // canvas から作る — base64 を直書きするとエンジンごとのデコード差を持ち込む
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2d コンテキストが取れない');
      ctx.fillStyle = '#4f6ef7';
      ctx.fillRect(0, 0, size, size);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      );
      if (!blob) throw new Error('PNG に変換できない');
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'e2e.png', { type: 'image/png' }));
      return transfer;
    }, DROPPED_IMAGE_SIZE);

    const canvasBox = await page.locator('.react-flow').boundingBox();
    if (!canvasBox) throw new Error('キャンバスの位置が取れない');
    const dropPoint = {
      clientX: canvasBox.x + canvasBox.width / 2,
      clientY: canvasBox.y + canvasBox.height / 2,
    };
    await page.dispatchEvent('.react-flow', 'dragover', {
      dataTransfer,
      ...dropPoint,
    });
    await page.dispatchEvent('.react-flow', 'drop', {
      dataTransfer,
      ...dropPoint,
    });

    await expect(page.locator(NODE)).toHaveCount(2, {
      timeout: SETTLE_TIMEOUT_MS,
    });
    // **`<img>` が居ることを合格条件にしない。** 参照だけ書けて実体が取れていなくても
    // 要素は出る。デコードまで済んだこと (naturalWidth > 0) を見る
    const image = page.locator(`${NODE} img`);
    await expect(image).toBeVisible({ timeout: SETTLE_TIMEOUT_MS });
    await expect
      .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth), {
        timeout: SETTLE_TIMEOUT_MS,
      })
      .toBeGreaterThan(0);

    // --- 無言の失敗 (D2) ---
    expect(problems.list()).toEqual([]);
  });
});
