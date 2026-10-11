/**
 * 新しい版の見つけ方 (#262、step3 Phase 2 U2)
 *
 * ## なぜ service worker の更新に頼らないか
 *
 * `sw.js` は build をまたいで中身が変わらない (ビルドの成果物を名前で持たない) ので、ブラウザは
 * 新しい版に気付かない。画面はネットワークを先に取るので、**再読み込みすれば新しい版になる** —
 * 足りないのは「新しい版がある」と開いているタブが知ることだけである。そこで build ごとの印
 * (`version.json`) を配り、このタブが読み込まれた build の印 (`__BUILD_ID__`) と見比べる。
 *
 * ## 勝手に読み直さない
 *
 * 知らせて、押すのは利用者 (利用者判断 2026-10-11)。編集の途中で読み直すと、書きかけの文字が
 * 消える。古い版のままでも壊れはしない — 知らない op は保存して読み飛ばす (FPR の完了基準 5)。
 */

export type BuildId = string;

/** 配信の印の置き場所。`vite.config.mjs` の `VERSION_FILE` と揃える */
export const VERSION_PATH = '/version.json';

/**
 * このタブの build の印。テスト (bun) と開発サーバでは埋められていないので `dev` になる。
 * `typeof` は宣言の無い名前でも投げない
 */
export const CURRENT_BUILD_ID: BuildId =
  typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/**
 * 配信の印を読む。**読めなければ null** — オフライン・配信の入れ替え中・開発サーバ
 * (印が無い) はどれも「新しい版は無い」と同じに扱う。知らせを誤って出すより、出し損ねる方がよい
 */
export async function fetchLatestBuildId(
  fetcher: typeof fetch = fetch,
): Promise<BuildId | null> {
  try {
    // HTTP のキャッシュを通さない (service worker も素通しする、public/sw.js)
    const response = await fetcher(VERSION_PATH, { cache: 'no-store' });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'build' in body &&
      typeof body.build === 'string' &&
      body.build.length > 0
    ) {
      return body.build;
    }
    return null;
  } catch {
    return null;
  }
}
