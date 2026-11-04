import { defineConfig, type MarkdownEnv } from 'vitepress';

/**
 * conversensus の文書のサイト (step4)。docs.conversensus.site に GitHub Pages で出す
 * (`.github/workflows/docs.yml`)。
 *
 * - 原稿は言語ごとのディレクトリに置く (`introductory_guide_to_conversensus/ja/` など)。
 *   **URL では言語を先頭に出す** (`/intro/…` が日本語、`/en/intro/…` が英語) — VitePress の
 *   言語の切り替えは URL の先頭で言語を見分けるので、rewrites で付け替える
 * - 図は原稿からの相対パス (`../images/ja/…`) のまま。Vite が原稿の場所から解決する
 * - 図を撮るスクリプト (`shots/`) はサイトに含めない
 */

type Chapters = readonly (readonly [page: string, title: string])[];

/** 入門の章の並び (原稿のファイル名と、目次の題) */
const INTRO_JA = [
  ['what_is_conversensus', 'conversensus って何'],
  ['lets_get_started', '始める'],
  ['the_place_where_graph_lives', 'グラフの置き場所'],
  ['thinking_with_graphs', 'グラフで考える'],
  ['evolving_graph', '成長するグラフ'],
  ['interact_with_graphs', 'グラフで対話する'],
  ['graph_kata', 'グラフのカタ'],
] as const satisfies Chapters;

const INTRO_EN = [
  ['what_is_conversensus', 'What is conversensus'],
  ['lets_get_started', 'Getting started'],
  ['the_place_where_graph_lives', 'Where graphs live'],
  ['thinking_with_graphs', 'Thinking with graphs'],
  ['evolving_graph', 'Evolving graphs'],
  ['interact_with_graphs', 'Interacting through graphs'],
  ['graph_kata', 'Graph kata'],
] as const satisfies Chapters;

/** 目次 (左の sidebar)。`base` は言語の先頭を含む入門の URL (`/intro/`, `/en/intro/`) */
function introSidebar(base: string, heading: string, chapters: Chapters) {
  return {
    [base]: [
      {
        text: heading,
        link: base,
        items: chapters.map(([page, text]) => ({
          text,
          link: `${base}${page}`,
        })),
      },
    ],
  };
}

/**
 * 注記 (`> [!NOTE]`) の見出しの日本語。VitePress の `markdown.container` の見出しは
 * **サイト全体で 1 組**しか持てないので、既定 (英語) のまま作らせ、英語の原稿以外では
 * 後から日本語に置き換える。原稿に見出しを書いたとき (`> [!NOTE] 見出し`) はそちらが残る
 */
const ALERT_TITLE_JA: Record<string, [english: string, japanese: string]> = {
  note: ['NOTE', '注記'],
  tip: ['TIP', 'ヒント'],
  important: ['IMPORTANT', '重要'],
  warning: ['WARNING', '注意'],
  caution: ['CAUTION', '警告'],
};

/** 英語の原稿か。原稿の置き場所 (`…/en/…`) で見る (rewrites の前の、原稿そのものの path) */
function isEnglishSource(env: MarkdownEnv): boolean {
  return /[\\/]en[\\/]/.test(env.path);
}

export default defineConfig({
  title: 'conversensus',
  description: 'グラフで考え, 書き/描き, 対話するための道具',
  cleanUrls: true,
  srcExclude: ['**/shots/**'],
  markdown: {
    config(md) {
      // VitePress の github-alerts が見出しを決めた後に、日本語の原稿でだけ置き換える
      md.core.ruler.after('github-alerts', 'github-alerts-ja', (state) => {
        if (isEnglishSource(state.env as MarkdownEnv)) return;
        for (const token of state.tokens) {
          if (token.type !== 'github_alert_open') continue;
          const titles = ALERT_TITLE_JA[token.meta.type];
          if (titles && token.meta.title === titles[0])
            token.meta.title = titles[1];
        }
      });
    },
  },
  rewrites: {
    'introductory_guide_to_conversensus/ja/:page': 'intro/:page',
    'introductory_guide_to_conversensus/en/:page': 'en/intro/:page',
  },
  locales: {
    root: {
      label: '日本語',
      lang: 'ja',
      themeConfig: {
        nav: [
          { text: '入門', link: '/intro/' },
          { text: 'アプリを開く', link: 'https://app.conversensus.site/' },
        ],
        sidebar: introSidebar('/intro/', 'Conversensus 入門', INTRO_JA),
        outline: { label: 'このページの内容' },
        docFooter: { prev: '前へ', next: '次へ' },
        langMenuLabel: '言語',
        returnToTopLabel: '先頭へ',
        sidebarMenuLabel: '目次',
        darkModeSwitchLabel: '表示の色',
      },
    },
    en: {
      label: 'English',
      lang: 'en',
      description:
        'A tool for thinking, writing/drawing, and conversing with graphs',
      themeConfig: {
        nav: [
          { text: 'Introduction', link: '/en/intro/' },
          { text: 'Open the app', link: 'https://app.conversensus.site/' },
        ],
        sidebar: introSidebar(
          '/en/intro/',
          'Introduction to Conversensus',
          INTRO_EN,
        ),
      },
    },
  },
  themeConfig: {
    socialLinks: [
      { icon: 'github', link: 'https://github.com/yamadamasaki/conversensus' },
    ],
  },
});
