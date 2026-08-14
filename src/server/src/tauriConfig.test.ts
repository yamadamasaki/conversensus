import { describe, expect, test } from 'bun:test';

/**
 * デーモンのポートは 2 箇所に書かれている (Phase 8 S3)。
 *
 * - `src-tauri/src/lib.rs` の `DAEMON_PORT` — アプリがデーモンを起動するとき渡す
 * - `src/client/.env.tauri` の `VITE_API_BASE` — クライアントが焼き込む宛先
 *
 * **言語をまたぐので型では守れない。** 食い違うとアプリは「起動するのに何も読めない」
 * 状態になり, しかもエラーは CORS でも 404 でもなく**接続拒否**なので分かりにくい。
 * ここで機械的に突き合わせる。
 */

const ROOT = new URL('../../../', import.meta.url).pathname;

/** `const DAEMON_PORT: &str = "39847";` からポートを取る */
async function portFromRust(): Promise<string> {
  const source = await Bun.file(`${ROOT}src-tauri/src/lib.rs`).text();
  const match = source.match(/const DAEMON_PORT: &str = "(\d+)"/);
  if (!match) throw new Error('lib.rs から DAEMON_PORT を読めませんでした');
  return match[1];
}

/** `VITE_API_BASE=http://localhost:39847` からポートを取る */
async function portFromEnv(): Promise<string> {
  const source = await Bun.file(`${ROOT}src/client/.env.tauri`).text();
  const match = source.match(/^VITE_API_BASE=http:\/\/localhost:(\d+)$/m);
  if (!match)
    throw new Error('.env.tauri から VITE_API_BASE を読めませんでした');
  return match[1];
}

/** `tauri.conf.json` を読む */
async function tauriConfig(): Promise<{
  app: { windows: { dragDropEnabled?: boolean }[] };
}> {
  return await Bun.file(`${ROOT}src-tauri/tauri.conf.json`).json();
}

describe('Tauri のデーモンポート', () => {
  test('lib.rs と .env.tauri で一致している', async () => {
    expect(await portFromEnv()).toBe(await portFromRust());
  });

  test('開発用の 3000 ではない', async () => {
    // 開発機では `bun run dev:server` が 3000 を掴んでいることが多く,
    // アプリが同じポートを使うと日常的に衝突して起動できない (計画 §2.3 / D3)
    expect(await portFromRust()).not.toBe('3000');
  });
});

describe('Tauri のウィンドウ設定', () => {
  test('drag & drop は webview に任せる (dragDropEnabled=false)', async () => {
    // **既定 (true) だと Tauri が OS の drop を横取りし, webview に渡さない。**
    // 実機で「画像を落としても何も起きない」形で出た (Phase 8 S4)。
    // 貼り付け (Cmd+V) は横取りされないので動く — その非対称が診断を難しくする。
    //
    // 本物のドラッグは合成できない (ANA-125 で確認済み) ので, ここで検査できるのは
    // **設定が意図どおりであること**だけである。それでも, 誰かが既定へ戻したときに
    // 気付ける
    const config = await tauriConfig();

    expect(config.app.windows[0].dragDropEnabled).toBe(false);
  });
});
