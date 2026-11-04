import { defineConfig } from 'vitepress';

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

/** 入門の章の並び (原稿のファイル名と、目次の題) */
const INTRO_JA = [
  ['what_is_conversensus', 'conversensus って何'],
  ['lets_get_started', '始める'],
  ['the_place_where_graph_lives', 'グラフの置き場所'],
  ['thinking_with_graphs', 'グラフで考える'],
  ['evolving_graph', '成長するグラフ'],
  ['interact_with_graphs', 'グラフで対話する'],
  ['graph_kata', 'グラフのカタ'],
] as const;

export default defineConfig({
  title: 'conversensus',
  description: 'グラフで考え, 書き/描き, 対話するための道具',
  cleanUrls: true,
  srcExclude: ['**/shots/**'],
  // 注記の見出し (原稿は GitHub と同じ `> [!NOTE]` で書く)。英語版を足すときは locale ごとに上書きする
  markdown: {
    container: {
      noteLabel: '注記',
      tipLabel: 'ヒント',
      importantLabel: '重要',
      warningLabel: '注意',
      cautionLabel: '警告',
    },
  },
  rewrites: {
    'introductory_guide_to_conversensus/ja/:page': 'intro/:page',
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
        sidebar: {
          '/intro/': [
            {
              text: 'Conversensus 入門',
              link: '/intro/',
              items: INTRO_JA.map(([page, text]) => ({
                text,
                link: `/intro/${page}`,
              })),
            },
          ],
        },
        outline: { label: 'このページの内容' },
        docFooter: { prev: '前へ', next: '次へ' },
      },
    },
  },
  themeConfig: {
    socialLinks: [
      { icon: 'github', link: 'https://github.com/yamadamasaki/conversensus' },
    ],
  },
});
