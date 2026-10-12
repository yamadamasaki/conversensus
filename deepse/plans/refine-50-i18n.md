# #50 i18n の計画

> 親: issue #50 (候補一覧 A6)。下ごしらえは言葉の表 ([visual language §7](../architecture/step3/visual-language.md), #274)。

## 0. 決めたこと (利用者, 2026-10-12)

| # | 問い | 決定 |
| --- | --- | --- |
| Q1 | 画面の言語の決め方 | **ブラウザに従い、切り替えも置く。**初回はブラウザの言語 (辞書に無ければ en)。左サイドバーの下に切り替えを置き、選んだものを端末に覚える |
| Q2 | 文言の置き方 | **自前の型付きの辞書。**依存を増やさない。ja を正とし、他の言語は同じ形を型で強制する |
| Q3 | 訳す範囲 | **画面の文言だけ。**開発者向けのコンソールの記録と、op-log に書かれるデータ (既定の Sheet 名・Toulmin の種類名など) は訳さない |
| Q4 | 辞書のキー | **意味の名前** (`t.header.copyLink`)。ja の文を直してもキーは変わらず、場所ごとに訳し分けられる |
| — | 言語の追加 | 辞書を 1 つ書き、一覧に 1 行足せば足せる。型が「全部のキーがあり、引数の形も同じ」を強制する |

## 1. 調べたこと

🔵 = 事実、⚪ = そこからの帰結。

### F1: 文言は 87 ファイル・約 450 か所に散っている

🔵 多いのは `Sidebar` (44)・`GraphHeader` (22)・`InvitationDialog` / `ConflictNotice` / `useFileSheetOperations` (19)。
フックの中 (`useFileSheetOperations` の知らせなど) にもあり、React の外 (純関数・hook の非同期処理) から引く口が要る。

⚪ 辞書は**モジュールに置いた現在の言語**から引けるようにし、React からは購読して描き直す (`useSyncExternalStore`)。

### F2: 概念の語は英語のまま (言葉の表)

🔵 File・Sheet・branch・commit・node などは画面でも英語で出す (§7)。

⚪ en ではこれらの語はそのまま、ja で日本語の部分だけを訳す。訳がぶれない。

### F3: テストは日本語の文言で要素を引いている

🔵 単体・App 結合・E2E は「File を削除」などの日本語で引く。happy-dom の `navigator.language` は `en-US`、Playwright の
既定の locale も `en-US`。

⚪ ブラウザに従うと、テストが en で描かれて全部落ちる。**テストは ja に固定する** (単体・App 結合は preload で、
E2E は `locale: 'ja-JP'`)。en は辞書の形の検査と、en で描く数件のテストで見る。

## 2. 設計

- `client/src/i18n/`
  - `ja.ts`: 正の辞書。画面ごとに入れ子 (`header`・`sidebar`・`timeline`…)。値は文字列か、引数を取る関数
  - `en.ts`: `Messages` (= `ja` の形) を満たす。関数の引数も同じ
  - `locale.ts`: 言語の一覧、ブラウザの言語からの選択、端末への保存、現在の言語の保持と購読
  - `useT()`: React から引く。言語を替えると描き直す。`t()`: React の外から引く
- `<html lang>` を現在の言語に合わせる (読み上げ・ブラウザの翻訳の提案)
- 日時は `Intl` に言語を渡す (timeline の時刻など)

## 3. スライス

| # | 中身 | テスト |
| --- | --- | --- |
| **I1** ✅ | 仕組み (`i18n/`) と切り替えの UI、テストを ja に固定 | 単体 (選択・保存・形の一致) |
| **I2** ✅ | ヘッダ・タブ・右サイドバー・timeline | 単体 + en で描くもの |
| **I3** ✅ | 左サイドバー・検索・Folder | 同上 |
| **I4** ✅ | ダイアログ (ログイン・招待・参加・commit・確認・入力・知らせ) | 同上 |
| **I5** ✅ | 知らせ (競合・上書き・新しい版・保存先・同期の状態) とグラフの編集 (メニュー・空の状態・property editor) | 同上 |
| **I6** ✅ | フックの中の文言 (知らせ・確認) と残り。日本語の文言が画面に残っていないかの検査 | 単体 + E2E (en で描いて日本語が出ない) |

## 4. 記録 (2026-10-12)

### 仕組み (I1)

- `client/src/i18n/`: `ja.ts` (正)・`en.ts`・`messages.ts` (`Messages` 型・`messages()`・`useMessages()`)・`locale.ts`・
  `LanguageSwitcher.tsx` (左サイドバーの下)
- React の外 (フックの非同期処理・純関数) は呼んだ時点の言語で `messages()` を引く。`App` が `useMessages()` で購読するので、
  言語を替えると画面全体が描き直される
- テストは ja に固定 (`src/test-setup.ts` で `navigator.languages`、E2E は `locale: 'ja-JP'`)。en は
  `i18n/enRendering.test.tsx` (部品ごと、日本語が残らない) と `tests/i18n.spec.ts` (本物のブラウザで通し) で見る

### 移したもの (I2〜I6)

ヘッダ・タブ・右サイドバー・pane・timeline / 左サイドバー・File の詳細・検索・同期の状態・知らせの帯 / ダイアログ /
競合・上書き・新しい版の知らせ・property editor・node と edge のメニュー・画像・保存領域・境界の知らせ /
App・branch と File の操作の知らせと確認・ログアウト・参加の誤り・参加依頼の問題・画像と取り込みの誤り。
timeline の時刻と `Intl` の書き方も言語に従う。

### 移さなかったもの (Q3)

- **op-log に書かれるデータ**: 新しい File の既定の名前「無題」、group の既定の名前「グループ」、base commit の説明
  「〜の分岐点」、Toulmin などの種の template の名前
- **開発者向け**: コンソールの記録、内部の不変条件の例外、調査用の検査 (`remoteBatchChecks`)、ラベルの解決の警告

### 途中で見つかったこと

- **E2E の fixture が persistent context に `locale` を渡していなかった** (`tests/fixtures.ts`)。設定の locale はどの
  テストにも効いておらず、エンジンの既定の言語で開いていた。渡すように直した
- WebKit の E2E で、他のテストが作った File が一覧に見えていた。「テストごとに新しいプロファイル」の前提と食い違う。
  i18n の E2E は利用者の名前を除いて見るようにしたが、プロファイルの分離そのものは調べていない (残す)
- worker は端末に覚えた言語を読めない (`localStorage` が無い) ので、保存領域を開けない理由は札で送り、画面の側で文に
  する (`local/storageFailure.ts`)
- 利用者が付けた名前 (`NameHighlight`) に `translate="no"` を付けた。ブラウザの自動翻訳に書き換えさせない

### 残すこと

- 名簿の「反映されなかった」の知らせ (`rejectedNote`) は読んだ時点の言語の文を state に持つので、言語を替えても
  名簿を開き直すまで前の言語のまま
- 文言の言い回しは ja の正を移しただけで、en の訳の見直しはしていない
