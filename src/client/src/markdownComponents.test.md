# markdownComponents.test.tsx

## 何を

node の本文の Markdown の描き方 (`MARKDOWN_COMPONENTS`, #287) — 画像 (`img`) とリンク (`a`) の部品。

## なぜ

本文は共有相手が書く。

- **画像を読み込むと、開いた人の IP と時刻が画像の置き場に伝わる** (書き手が置き場を持っていれば、誰がいつ
  開いたかが分かる)。読み込まず、押せば開けるリンクにする (利用者判断 2026-10-07)。画像 node の外部 URL は
  対象外 — node を置いた人が画像として置いたもの
- **リンクが同じタブで移ると、編集中の画面を離れる**。新しいタブで開き、`noopener` で開いた先からこの画面を
  触らせず、`noreferrer` でこの画面の URL を渡さない

## どのように

部品を直接描いて見る。**react-markdown を通しては見ない** — `EditableNode.test.tsx` が `react-markdown` を
`mock.module` で差し替えていて、それはプロセス全体に効く (#265)。同じプロセスで本物を import すると、順序に
よってモックが返る。`EditableNode.test.tsx` の側で、`ReactMarkdown` にこの `components` が渡ることを見ている。

- **画像は img を作らずリンクにする**: 読み込まないことそのもの。リンクの文字は「画像: 代替の文字」、無ければ URL
- **画像のリンクも新しいタブ・`noopener noreferrer`**
- **URL が落とされていれば文字だけ**: react-markdown の `urlTransform` が `javascript:` などを空にして渡す。
  空の `href` のリンクを作らない
- **リンクも URL が落とされていれば文字だけ**: 本物の react-markdown で `[j](javascript:…)` を描くと `href=""` で
  届いた (実際に描いて確かめた)。空の href は押すとこの画面を新しいタブで開くだけなので、リンクにしない
- **リンクは新しいタブ・`noopener noreferrer`**、**書き手の `target` / `rel` を上書きする**: Markdown から
  これらは書けないが、部品として渡された値に負けないこと
