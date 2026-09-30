// S0-4 spike: SQLite-WASM + OPFS を WebKit / Chromium で試す (投棄可)。
// 合否ではなく**観測**が目的なので、結果は console に出して report に書き写す。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Page, test } from '@playwright/test';

const COI = 'http://localhost:5191';
const PLAIN = 'http://localhost:5192';
const ROWS = 5000;

async function run(page: Page, origin: string, query: string) {
  await page.goto(`${origin}/?${query}`);
  await page.waitForFunction(
    () => (window as unknown as { __spike?: unknown }).__spike,
    null,
    {
      timeout: 60_000,
    },
  );
  return page.evaluate(
    () => (window as unknown as { __spike: unknown }).__spike,
  );
}

const log = (name: string, label: string, value: unknown) =>
  console.log(`[${name}] ${label}: ${JSON.stringify(value)}`);

for (const [vfs, origin] of [
  ['opfs', COI],
  ['sahpool', PLAIN],
  ['opfs', PLAIN],
] as const) {
  test(`${vfs} @ ${origin === COI ? 'COOP/COEP' : 'ヘッダ無し'}`, async ({
    page,
    context,
  }, info) => {
    const name = `${info.project.name} ${vfs} ${origin === COI ? 'coi' : 'plain'}`;
    log(
      name,
      'write',
      await run(page, origin, `vfs=${vfs}&rows=${ROWS}&mode=write`),
    );
    // 再読み込みで残るか (同じ context = 同じ origin の保存領域)
    log(name, 'reload', await run(page, origin, `vfs=${vfs}&mode=read`));
    // 1 つ目のタブが接続を持ったまま、2 つ目のタブから開けるか
    const holder = await context.newPage();
    log(
      name,
      'hold (tab 1)',
      await run(holder, origin, `vfs=${vfs}&mode=hold`),
    );
    const second = await context.newPage();
    log(
      name,
      'read (tab 2)',
      await run(second, origin, `vfs=${vfs}&mode=read`),
    );
  });
}

// 使い捨て (ephemeral) context では WebKit が OPFS を拒むことがある。実際のブラウザに
// 近い「保存領域を持つ」 context で同じことを見る
for (const [vfs, origin] of [
  ['opfs', COI],
  ['sahpool', PLAIN],
] as const) {
  test(`persistent context: ${vfs}`, async ({ playwright, browserName }) => {
    const name = `${browserName} persistent ${vfs}`;
    const context = await playwright[browserName].launchPersistentContext(
      mkdtempSync(join(tmpdir(), 'opfs-spike-')),
    );
    const page = await context.newPage();
    log(
      name,
      'write',
      await run(page, origin, `vfs=${vfs}&rows=${ROWS}&mode=write`),
    );
    log(name, 'reload', await run(page, origin, `vfs=${vfs}&mode=read`));
    const holder = await context.newPage();
    log(
      name,
      'hold (tab 1)',
      await run(holder, origin, `vfs=${vfs}&mode=hold`),
    );
    const second = await context.newPage();
    log(
      name,
      'read (tab 2)',
      await run(second, origin, `vfs=${vfs}&mode=read`),
    );
    await context.close();
  });
}
