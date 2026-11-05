# 文書のサイト (docs.conversensus.site)

- 日付: 2026-11-04
- 状態: 決定 (利用者 2026-11-04)

## 決めたこと

| | 選んだもの | 理由 |
| --- | --- | --- |
| 置き場所 | GitHub Pages、独自ドメイン `docs.conversensus.site` | 無料で広告が無い。PR で直して merge すれば出る。VPS (PDS とアプリの配信) の運用を増やさない |
| generator | VitePress | bun / Node で動く (別の言語の道具を増やさない)。日英の切り替えが標準。原稿の生の HTML (`<figure><img>`) と相対パスの図がそのまま通る |
| 配信 | `.github/workflows/docs.yml` | PR では作るだけ (リンク切れで落ちる)。main に入ったら作って出す |

Read the Docs は版ごとの出し分けが強みだが、入門は「いまの使い方」なので要らない。言語ごとに別のプロジェクトになるのも手間。自前の VPS は運用が増える。

## 形

- 原稿は `docs/introductory_guide_to_conversensus/<言語>/` に置く (今のまま)。URL では言語を先頭に出す
  (`/intro/…` が日本語、`/en/intro/…` が英語)。`docs/.vitepress/config.mts` の rewrites で付け替える
- 図は押すと拡大する (medium-zoom, `docs/.vitepress/theme/`)。図の多くは画面全体なので、本文の幅では文字が読めない
- 注記 (`> [!NOTE]` など) の見出しは言語ごとに出す (日本語の原稿では「注記」「注意」など、英語の原稿では NOTE・WARNING)。
  VitePress の見出しの設定 (`markdown.container`) はサイト全体で 1 組しか持てない (locale ごとに分けられない) ので、
  既定の英語のまま作らせ、英語の原稿 (置き場所が `…/en/…`) 以外では markdown の段階で日本語に置き換える
- 英語版 (2026-11-04): 原稿は `introductory_guide_to_conversensus/en/`、トップは `docs/en/index.md`。
  図は `images/en/` (`bun run docs:shots` が英語の画面で撮ったもの)。画面の文言は英語の辞書 (`src/client/src/i18n/en.ts`) の表記に合わせた
- 手元で見る: `bun run docs:dev`。作る: `bun run docs:build` (出力は `docs/.vitepress/dist/`)

## 一度だけ要る設定 (利用者)

1. リポジトリの Settings → Pages → Build and deployment の Source を「GitHub Actions」にする
2. 同じ画面の Custom domain に `docs.conversensus.site` を入れる (`docs/public/CNAME` にも書いてある)
3. DNS に `docs.conversensus.site` → `yamadamasaki.github.io` の CNAME を足す
4. 証明書が出たら「Enforce HTTPS」を入れる

## 次にやること

- ~~アプリから入門へのリンク~~ (PR #337)
- ~~図の軽量化~~: 2 倍の解像度のまま WebP (lossy, 品質 85) にし、合計 8.0 MB → 3.4 MB。変換は撮るときに
  `shots/support.ts` が `sharp` で行う。品質 85 で画面の小さな文字が滲まないことを確かめた
  (lossless の WebP は 4.8 MB で、削れる量が少ない)
