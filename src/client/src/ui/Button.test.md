# ui/Button.test.tsx

## 何を

- `IconButton` の `label` が **アクセシブルな名前** (`aria-label`) と **tooltip** (`title`) の両方になる。アイコンの svg は読み上げから外す
- `aria-pressed` を渡せばトグルとして読まれる
- `Button` は種類 (主・副・記号・破壊的) を class で持つ。`type` は常に `button`

## なぜ

visual language §4: アイコンだけのボタンは名前と tooltip を **必ず** 持つ (iOS には hover が無く、
v1.0.0 では記号だけのボタンが何をするか分からなかった — UI/UX review §2.1)。`label` を必須の
prop にして、名前の付け忘れを型で止める。ここではその label が実際に両方へ渡ることを確かめる。

見た目 (hover・無効・トグルの on) は CSS にあり、happy-dom では検査できない。class の付け方だけを見る。
