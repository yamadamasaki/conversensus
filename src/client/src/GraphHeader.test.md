# GraphHeader のテスト

## 何をテストするか

ヘッダの狭い画面の出し方 (visual language §9.2, #278)。

- 広い画面では、文字のボタン (group にまとめる・commit・merge) が文字を持ち、branch の名前が出る
- 狭い画面 (`compact`) では記号だけにし、名前は `aria-label` と tooltip (`title`) に残す。
  branch の名前は tooltip に退け、変更の数だけを残す
- 狭い画面では「PNG で書き出す」を `Ellipsis` の「その他の操作」メニューに入れ、選べば働き、
  メニューは閉じる

## なぜテストするか

iPhone の幅では、文字のボタンを並べるとヘッダが溢れ、右端の commit・merge が押せなくなる。
記号だけにしても**名前を落とさない**ことが要点で、落とすと読み上げで何のボタンか分からない。

## どのようにテストするか

- `GraphHeader` だけを描き、`compact` を切り替えて比べる。幅の段の判定は
  `layout/viewportTier.test.ts` が見ている
- `controls` は使う口 (`exportPng`) だけを持つ偽物にする
