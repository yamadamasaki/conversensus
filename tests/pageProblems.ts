import type { Page } from '@playwright/test';

/**
 * ページ上の「無言の失敗」を集める (ANA-125)
 *
 * WebKit 適合の検証で**画面の見た目を合格条件にしてはならない** — step1 では
 * PDS への送信が数週間にわたり全滅していたのに画面は正常に見えた前例がある
 * (`deepse/plans/step1-refinement-ana125-safari.md` D2)。
 * どのスモークもこれを併用し, **未処理例外とコンソールエラーが 0 件**であることを見る。
 */

/** 失敗と見なさないもの。**理由を書けるものだけ**をここに足すこと */
const IGNORED = [
  // vite の dev サーバとの HMR 接続。製品コードの問題ではない
  /\[vite\]/,
];

export type PageProblems = {
  /** 集まった問題を発生順で返す */
  list: () => string[];
};

export function collectPageProblems(page: Page): PageProblems {
  const problems: string[] = [];

  const add = (kind: string, text: string) => {
    if (IGNORED.some((re) => re.test(text))) return;
    problems.push(`${kind}: ${text}`);
  };

  // 未処理例外。**握り潰されないのはこれだけ**なので必ず拾う
  page.on('pageerror', (err) => add('pageerror', String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') add('console.error', msg.text());
  });
  // 読み込めなかったリソース (404 の画像など画面に出ない失敗)
  page.on('requestfailed', (req) => {
    add(
      'requestfailed',
      `${req.method()} ${req.url()} — ${req.failure()?.errorText}`,
    );
  });

  return { list: () => [...problems] };
}
