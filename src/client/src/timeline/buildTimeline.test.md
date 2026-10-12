# buildTimeline のテスト

## 何をテストするか

`buildTimeline` は version tree の中身 (線と点) を op-log から組み立てる (#73 timeline view, 計画 T1)。

- 線は trunk と、出す branch (開いている・merge 済み, Q4) が 1 本ずつ。fork と閉じた branch は出さない
- operation point: trunk の上に分岐と merge、branch の上に commit
- change point: グラフを変えるこのシートの batch。operation point の間の続きは 1 つに畳む (Q2)。
  merge の写し (`mergedIn`) と別のシートの編集は change point にしない
- 並びは op-log の順: change point は「その batch を切断面に含む最初の operation point」の前に置く
- どの点も切断面を持つ。分岐点は base の vector、change point は `cutOfBatch` (書いた人が見ていたもの + その batch)
- 選んだ要素で絞ると、それに触れた change point だけが残り、operation point は残る

## なぜテストするか

version tree は「いつ、どの線で、何が起きたか」を見るためのものなので、**点が別の線や別の位置に
置かれると、履歴を読み違える**。例外は出ず、画面の見た目では気付きにくい。

- merge の写しを change point にすると、branch での編集が trunk でも行われたように見える
- 切断面が違うと、inspector の view graph が別の時点の姿を出す
- 絞りで operation point まで消えると、絞った時に線の形 (分岐・merge) が分からなくなる

## どのようにテストするか

- 例: trunk に 2 つ置き、b1 を切り、trunk で 1 つ変え、b1 で置いて commit し、さらに置いて merge する筋書き。
  merge の写しと別のシートの編集も混ぜる。畳み込みは本物 (`foldBranches`) を使う
- 線の形は「`changes(seq の並び)` / `branch:名前` / `commit:id` / `merge:id`」の文字列の列で比べる
- **性質**: 絞る要素を筋書きの node (n1〜n4) の任意の部分集合から引き、
  - change point の並びが「絞らないときの並びのうち、絞りに触れた batch」**ちょうど**になる (落とさず、重ねない)
  - operation point の並びは絞りによらない
  を確かめる。要素を筋書きの中から引くのは、触れる/触れないの両方に当てるため
