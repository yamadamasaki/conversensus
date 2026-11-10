# useElementAuthors.test.ts — 開いている File の書いた人のテスト仕様

## 何を

`useElementAuthors` を検証する。開いている File の op-log (trunk と見ている branch) を読んで作者を導き、手元の正典が
変わったら読み直す hook である (#354)。作者の規則そのものは `shared/events/authors.test.ts` が見る。

## なぜ

- avatar は op-log からの導出なので、**読み直さなければ古い作者が出続ける**。自分の編集も受信も正典に書かれてから
  知らせが来るので、その知らせで読み直す
- branch を見ているときは、branch で書いた人も作者である。trunk だけを読むと抜ける
- 関係の無い File の変化で読み直すと、参加している File が多いほど無駄に読む

## どのように

op-log の読み方は差し替える (偽の `fetchBatches`)。ログインしていない形で描くので、表示名と宣言は PDS に引かない。

- trunk と見ている branch の op-log を合わせて作者を導く。表示名は引かず DID のまま
- 見ている File の正典が変わったら読み直す。他の File の変化では読まない。知らせは本物の道
  (`broadcastingBackend` の書き込み) で出す
- File が無ければ読まず、作者も無い
