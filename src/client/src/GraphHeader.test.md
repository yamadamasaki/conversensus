# GraphHeader のテスト

## 何をテストするか

### 名前と状態 (#276)

- 開いているグラフの File と Sheet の名前を出し、「File / Sheet」の全体を tooltip に持つ
- 状態を印で出す: branch でなければ「trunk」、branch なら名前、merge 済みなら「(merged)」、
  merger のタブなら「merge」
- 未 commit の変更があれば数を出し (「N 変更」)、無ければ出さない

開いているグラフの名前は以前はタブにしか無かった。design language は「ヘッダ = 個々の
グラフを管理する」なので、何を操作しているのか (どの Sheet の、どの流れか) をヘッダで言う。

### 狭い画面

ヘッダの狭い画面の出し方 (visual language §9.2, #278)。

- 広い画面では、文字のボタン (group にまとめる・commit・merge) が文字を持ち、branch の名前が出る
- 狭い画面 (`compact`) では記号だけにし、名前は `aria-label` と tooltip (`title`) に残す。
  File と branch の名前は tooltip に退け、Sheet の名前と変更の数は残す
- 狭い画面では「PNG で書き出す」を `Ellipsis` の「その他の操作」メニューに入れ、選べば働き、
  メニューは閉じる

## なぜテストするか

iPhone の幅では、文字のボタンを並べるとヘッダが溢れ、右端の commit・merge が押せなくなる。
記号だけにしても**名前を落とさない**ことが要点で、落とすと読み上げで何のボタンか分からない。

## どのようにテストするか

- `GraphHeader` だけを描き、`compact` を切り替えて比べる。幅の段の判定は
  `layout/viewportTier.test.ts` が見ている
- `controls` は使う口 (`exportPng`) だけを持つ偽物にする
