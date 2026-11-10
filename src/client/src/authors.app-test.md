# authors.app-test.tsx — 書いた人の avatar の App 結合 (#354)

## 何を

node を置くと、その op-log から作者が導かれ、node に avatar が出るまでを `<App />` で一周させる。あわせてヘッダの
on/off (#354 の決定: 既定は on)。

## なぜ

作者の規則 (`authorsOf`)・op-log の読み直し (`useElementAuthors`)・avatar の描き方 (`AuthorAvatars`) はそれぞれ
確かめてある。ここで見るのは**つなぎ**である。

- 自分の編集が正典に書かれた知らせで作者が読み直されるか
- React Flow が描く node の部品まで context が届くか
- ヘッダの切り替えが部品へ届くか

## どのように

alice がログインして File を作り、node を 1 つ置く。

- node に avatar が出て、作者は alice の DID。表示名を引いた後は、読み上げが「書いた人: alice.test」になる
- ヘッダの「書いた人」を押すと avatar が消え、もう一度押すと戻る

人を並べる順と agent の印は、部品と規則の試験が見る。edge の avatar (選んだときだけ) は、happy-dom では edge の
位置を測れないので、手で確かめる (計画 authors-354.md W5)。
