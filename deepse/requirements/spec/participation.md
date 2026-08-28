# participation

- Participation (参加) は, conversensus での共同作業の単位である
- DID を持つアクタは, File ごとに共同作業に参加する
- step2 では, File への参加要請や参加表明は conversensus の外で何らかの形で行われるものとする
- step2 では, 参加するアクタは全員同じ PDS ノードにアカウントを持っているものとする

## 名簿

File f の名簿は, 「誰が, いつからいつまで参加していたか」の記録である. 各アクタの op-log からの projection によって導かれるので, **各参加者が自分の手元で独立に計算する**.

- $f.participatingActors$ は, ある時点で f に参加しているアクタの集合を表す
- 参加期間が記録されているので, 他のアクタの op-log を同期するときは, **そのアクタが参加していた期間の op-log だけ**を対象とする

名簿を完全に同期することはできない. actor a が actor a' を招待した直後, まだ同期していない actor b の名簿には a' がいない. この食い違いは許容し, b は単に「a' の参加を知らなかった」ものとして扱う. したがって b の projection には, 同期するまで a' の操作は現れない.

## participation に関する activity

- actor a が actor a' を file f に招待する
  - pre
    - $a \in f.participatingActors \land f \in a.participatingFiles$
  - post
    - $a' \in f.invitedActors \land f \in a'.invitedFiles$
- actor a が file f への招待を承認する
  - pre
    - $a \in f.invitedActors \land f \in a.invitedFiles$
  - post
    - $a \notin f.invitedActors \land f \notin a.invitedFiles$
    - $a \in f.participatingActors \land f \in a.participatingFiles$
- file f に参加している actor a が参加を取りやめる
  - pre
    - $a \in f.participatingActors \land f \in a.participatingFiles$
  - post
    - $a \notin f.participatingActors \land f \notin a.participatingFiles$
- file f に参加している actor a が actor a' の招待/参加を取り消す
  - 承認の**前後を問わず**, 同じ「取り消し」として扱う
  - pre
    - $a \in f.participatingActors \land f \in a.participatingFiles$
    - $a' \in f.invitedActors \lor a' \in f.participatingActors$
  - post
    - $a' \notin f.invitedActors \land f \notin a'.invitedFiles$
    - $a' \notin f.participatingActors \land f \notin a'.participatingFiles$

被招待者が招待を明示的に断る activity は設けない. 承認しなければよい.

## ワークフロー

1. actor a が file f を作る
    1. actor a は file f に自動的に参加する
2. actor a’ からの希望, または f の任意の共同作業参加者 actor a の意思により, actor a’ を file f の共同作業に招待する
    1. actor a は actor a’ の DID did(a’) を入手する
    2. did(a’) から共同作業への参加 participation p(f, a’) の 参加コード participation-code(p, a) を生成する
    3. actor a は actor a’ に participation-code(p, a) を渡す
    4. actor a’ は participation-code(p, a) を使って, 招待を承認する
3. この後, 共同作業者たちの file f の projection には actor a’ の file f’ を加えるようになる
4. file f の任意の共同作業者 actor a が意図して, あるいは actor a’ 自身の意思によって, actor a’ の file f’ への参加を取り消す
5. この後, 共同作業者たちの file f の projection には actor a’ の file f’ を加えないようになる
6. actor a’ が file f に参加していない期間に行った file f’ に対する (local な) 操作は, file f の他の共同作業者 actor a の file f には project されない
    1. その op-log は a’ 自身の repo には残る. 他の参加者に project されないだけである
    2. その期間の状態を残しておきたければ, 別の File としてコピーする
    3. そのような操作の結果に依存する新たな操作は, actor a にエラーを引き起こす. したがって, actor a’ が新たに (あるいは再度) 共同作業に参加する前に, file f の標準的な projection に同期しなければならない

## UI の例

- 送る側は例えば, 左サイドバーの File の欄, あるいはスクリーン右上に invitation ボタンを設置する
  - invitation ボタンをクリックすると, ダイアログを表示する. 中身は,
    - invite されているアクタと invite しているアクタ, 参加コード (or URL), 状態, action の表を表示
      - 状態は, sent, accepted, revoked (取り消された), resigned (invite された側から)
        - 招待されていないアクタが承認しようとした場合は invalid
      - action は, preview, accept, revoke, resign (立場によってグレイアウト)
      - 参加コードは長いだろうから, 表示せずに, copy ボタン (OS の paste board に) だけでもいいかも
    - 新たな invitation 作成
      - テキスト・フィールドにハンドル名入力, generate ボタン押下
      - 上の表に参加コードと共に追加表示される
  - 今生成された参加コードをコピーして, 相手に送れば良い
- 受け取る側は例えば, 左サイドバーの一番上の import ボタンの辺りに participate ボタンを設置する
  - participate ボタンをクリックすると, ダイアログを表示する
  - その中の input field に渡された参加コードを入力する
  - 左サイドバーに対象 File が追加される
  - 上述した invitation ボタンも使えるようになる
- 参加コード (あるいは URL), 必要な情報は
  - 招待者の DID
  - 被招待者の DID
  - FileId
  - 実際にはこれらを JSON などで適当にフォーマットして, 圧縮, エンコードしたものでもいい
  - conversensus の web アプリケーション版があれば, これらを URL にエンコードしてもいいかも

> **用語**: ここでいう「参加コード」は File の共同作業に参加するためのものである. PDS のアカウントを作成するための「招待コード」(→ [spec-step2](../spec-step2.md) の「アカウントを作成する」) とは別物である.

## 未決

- 参加コードは秘密ではない (被招待者の DID を含むだけ) ので, 第三者が入手した場合にどう防ぐか
- 相互に取り消し合った場合の名簿の扱い
