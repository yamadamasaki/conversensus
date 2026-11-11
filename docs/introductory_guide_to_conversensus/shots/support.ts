/**
 * 入門の図を撮るための道具 (step4)
 *
 * 画面の文言は**アプリの辞書から引く** (`src/client/src/i18n`)。同じスクリプトで ja と en の図を撮るため。
 * 撮った図は `../images/<言語>/<名前>.webp` に置く。
 *
 * **図は WebP (lossy, 品質 85) で書く。**PNG では 27 枚 × 2 言語で 8 MB あり、文書のサイトを開くたびに重かった。
 * 画面の文字が滲まないことを確かめた品質で、PNG の 4 割ほどになる。高精細の画面向けに 2 倍で撮るのはそのまま
 * (`playwright.shots.config.ts` の `deviceScaleFactor`)
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import sharp from 'sharp';
import { en } from '../../../src/client/src/i18n/en';
import { ja } from '../../../src/client/src/i18n/ja';
import type { ConversensusFile } from '../../../src/shared/src/schemas';

export type Locale = 'ja' | 'en';
export const LOCALE: Locale = process.env.SHOTS_LOCALE === 'en' ? 'en' : 'ja';
/** 画面の文言 (撮る言語のもの) */
export const t = LOCALE === 'en' ? en : ja;

// Playwright は CommonJS として読むので import.meta は使えない
const IMAGES_DIR = path.resolve(__dirname, '..', 'images', LOCALE);
/** 画面の反映を待つ上限 (blob の往復を含む) */
export const SETTLE_TIMEOUT_MS = 15_000;
/** 図の切り抜きに足す余白 (px) */
const CLIP_PADDING = 24;
/** 図の WebP の品質 (0〜100)。画面の小さな文字が滲まない下限の近く */
const WEBP_QUALITY = 85;

export const NODE = '.react-flow__node';
export const PANE = '.react-flow__pane';

/** 図の置き場所 */
export function imagePath(name: string): string {
  return path.join(IMAGES_DIR, `${name}.webp`);
}

/** 撮った PNG を WebP にして図の置き場所に書く */
async function saveImage(png: Buffer, name: string): Promise<void> {
  await sharp(png)
    .webp({ quality: WEBP_QUALITY, effort: 6 })
    .toFile(imagePath(name));
}

/**
 * 撮る。`target` が Locator ならその要素だけ、Page なら画面全体。
 * **動きが止まってから撮る** (React Flow の fit や pane の開閉のアニメーション)
 */
export async function shoot(target: Page | Locator, name: string) {
  const page = 'page' in target ? target.page() : target;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await saveImage(await target.screenshot({ animations: 'disabled' }), name);
}

/** いくつかの要素をまとめて囲む範囲を撮る (グラフの一部だけを図にするとき) */
export async function shootAround(
  page: Page,
  targets: Locator[],
  name: string,
) {
  const boxes = await Promise.all(targets.map((l) => l.boundingBox()));
  const present = boxes.filter((b) => b !== null);
  if (present.length === 0) throw new Error('撮る要素が見つからない');
  // 画面の外へははみ出さない (はみ出すと撮れない)
  const left = Math.max(0, Math.min(...present.map((b) => b.x)) - CLIP_PADDING);
  const top = Math.max(0, Math.min(...present.map((b) => b.y)) - CLIP_PADDING);
  const right = Math.max(...present.map((b) => b.x + b.width)) + CLIP_PADDING;
  const bottom = Math.max(...present.map((b) => b.y + b.height)) + CLIP_PADDING;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const png = await page.screenshot({
    animations: 'disabled',
    clip: { x: left, y: top, width: right - left, height: bottom - top },
  });
  await saveImage(png, name);
}

/**
 * 本の表紙の画像を作る (場面の画像 node に使う)。HTML を描いて PNG にするので、
 * 外から画像を持ち込まずに済む
 */
export async function renderCover(
  page: Page,
  lines: { title: string; author: string; year: string },
): Promise<Uint8Array> {
  const cover = await page.context().newPage();
  await cover.setViewportSize({ width: 240, height: 340 });
  await cover.setContent(`
    <body style="margin:0">
      <div style="width:240px;height:340px;box-sizing:border-box;padding:28px 20px;
        background:#2f4858;color:#f6f1e7;font-family:serif;display:flex;flex-direction:column;
        justify-content:space-between;border-left:10px solid #c8a96a">
        <div style="font-size:40px;font-weight:bold;letter-spacing:4px">${lines.title}</div>
        <div style="font-size:18px">${lines.author}<br><span style="font-size:14px">${lines.year}</span></div>
      </div>
    </body>`);
  const bytes = await cover.screenshot({ type: 'png', scale: 'css' });
  await cover.close();
  return new Uint8Array(bytes);
}

/** 組み立てた場面を `.conversensus` として import し、取り込んだ File が開くまで待つ */
export async function importScene(
  page: Page,
  file: ConversensusFile,
  testInfo: TestInfo,
) {
  const tmp = testInfo.outputPath(`${file.name}.conversensus`);
  await writeFile(tmp, JSON.stringify(file));
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator(`button[title="${t.sidebar.importTitle}"]`).click(),
  ]);
  await chooser.setFiles(tmp);
  await page
    .getByRole('button', { name: file.name, exact: true })
    .first()
    .waitFor({ timeout: SETTLE_TIMEOUT_MS });
}

/** File 名のボタンを持つ、File の行 (Sheet の一覧を含む) */
export function fileItem(page: Page, fileName: string): Locator {
  return page
    .locator('li')
    .filter({ has: page.getByRole('button', { name: fileName, exact: true }) })
    .first();
}

/** File の中の Sheet を開く */
export async function openSheet(page: Page, fileName: string, sheet: string) {
  // metagraph などの特殊な Sheet のボタンは、種類の印のせいで名前 (accessible name) を持たない。
  // 文字で引く
  const exact = fileItem(page, fileName).getByRole('button', {
    name: sheet,
    exact: true,
  });
  const byText = fileItem(page, fileName)
    .getByRole('button')
    .filter({ hasText: new RegExp(`^${escapeRegExp(sheet)}$`) });
  await exact.or(byText).first().click();
}

/**
 * Sheet の「…」から「template を当てる」の dialog を開く (#355)。Sheet のボタンと「…」は兄弟なので、
 * Sheet のボタンの親から「…」を引く
 */
export async function openApplyTemplate(
  page: Page,
  fileName: string,
  sheet: string,
): Promise<Locator> {
  const sheetButton = fileItem(page, fileName)
    .getByRole('button')
    .filter({ hasText: new RegExp(`^${escapeRegExp(sheet)}$`) })
    .first();
  await sheetButton
    .locator('xpath=..')
    .getByRole('button', { name: t.sidebar.details })
    .click();
  await page
    .getByRole('button', { name: t.settings.applyTemplate, exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: t.templateApply.applyTitle,
  });
  await dialog.waitFor();
  return dialog;
}

/** 本文で node を引く */
export function nodeWith(page: Page, text: string): Locator {
  return page.locator(NODE).filter({ hasText: text }).first();
}

/** 左サイドバー */
export function leftSidebar(page: Page): Locator {
  return page.locator('aside').first();
}

/** map を閉じる (図の右下を覆うので)。開いているときだけ押す */
export async function hideMap(page: Page) {
  const map = page.getByRole('button', { name: t.header.map });
  if ((await map.getAttribute('aria-pressed')) === 'true') await map.click();
}

/** グラフを全体が収まるように合わせ、少し引く (fit だけだと node が画面いっぱいになる) */
export async function fitAndZoomOut(page: Page, steps = 1) {
  await page.locator('.react-flow__controls-fitview').click();
  for (let i = 0; i < steps; i += 1) {
    await page.locator('.react-flow__controls-zoomout').click();
  }
}

/** 何も無い所をダブルクリックして、node の種類のメニューを出す */
export async function openNodeMenu(page: Page, at: { x: number; y: number }) {
  await page.locator(PANE).dblclick({ position: at });
}

/** 画像ファイルをグラフに落とす (合成イベント。walkthrough.spec.ts と同じ) */
export async function dropImage(
  page: Page,
  png: Uint8Array,
  at: { x: number; y: number },
) {
  const dataTransfer = await page.evaluateHandle((bytes: number[]) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array(bytes)], 'cover.png', { type: 'image/png' }),
    );
    return transfer;
  }, Array.from(png));
  const box = await page.locator('.react-flow').boundingBox();
  if (!box) throw new Error('グラフの位置が取れない');
  const point = { clientX: box.x + at.x, clientY: box.y + at.y };
  await page.dispatchEvent('.react-flow', 'dragover', {
    dataTransfer,
    ...point,
  });
  await page.dispatchEvent('.react-flow', 'drop', { dataTransfer, ...point });
}

/** node の本文を書き換える (ダブルクリック → 書く → 外を押して確定) */
export async function rewriteNode(page: Page, node: Locator, text: string) {
  await node.dblclick();
  const editor = page.locator(`${NODE} textarea`);
  await editor.fill(text);
  await page.locator(PANE).click({ position: { x: 20, y: 20 } });
  await editor.waitFor({ state: 'detached' });
}

/** 画面の入力ダイアログ (branch の名前、merge の理由) に書いて OK を押す */
export function inputDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: t.common.input });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
