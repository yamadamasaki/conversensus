# participation

- Participation (参加) は, conversensus での共同作業の単位である
- DID を持つアクタは, File ごとに共同作業に参加する
- step2 では, File への参加要請や参加表明は conversensus の外で何らかの形で行われるものとする
- step2 では, 参加するアクタは全員同じ PDS ノードにアカウントを持っているものとする

## participation に関する activity

- actor a が actor a’ を file f に招待する
  - pre
    - $a \in f.participatingActors \land f \in a.participatingToFiles$
  - post
    - $a' \in f.invitingActors \land f \in a’.invitedToFiles$
- actor a が file f への招待を承認する
  - pre
    - $a \in f.invitingActors \land f \in a.invitedToFiles$
  - post
    - $a \notin f.invitingActors \land f \notin a.invitedToFiles$
    - $a \in f.participatingActors \land f \in a.participatingToFiles$
- file f に参加している actor a が参加を取りやめる
  - pre
    - $a \in f.participatingActors \land f \in a.participatingToFiles$
  - post
    - $a \notin f.participatingActors \land f \notin a.participatingToFiles$
- actor a が file f に参加している actor a’ の参加を取り消す
  - pre
    - $a \in f.participatingActors \land f \in a.participatingToFiles$
  - post
    - $a' \in f.participatingActors \land f \in a'.participatingToFiles$

## ワークフロー

1. actor a が file f を作る
    1. actor a は file f に自動的に参加する
2. actor a’ からの希望, または f の任意の共同作業参加者 actor a の意思により, actor a’ を file f の共同作業に招待する
    1. actor a は actor a’ の DID did(a’) を入手する
    2. did(a’) から共同作業への参加 participation p(f, a’) の 招待コード invitation-code(p, a) を生成する
    3. actor a は actor a’ に invitation-code(p, a) を渡す
    4. actor a’ は invitation-code(p, a) を使って, 招待を承認する
3. この後, 共同作業者たちの file f の projection には actor a’ の file f’ を加えるようになる
4. file f の任意の共同作業者 actor a が意図して, あるいは actor a’ 自身の意思によって, actor a’ の file f’ への参加を取り消す
5. この後, 共同作業者たちの file f の projection には actor a’ の file f’ を加えないようになる
6. actor a’ が file f に参加する以前 (あるいは以前に参加を取りやめた後) に行った file f’ に対する (local な) 操作は, file f の他の共同作業者 actor a の file f には project されない. そのような操作の結果に依存する新たな操作は, actor a にエラーを引き起こす. したがって, actor a’ が新たに (あるいは再度) 共同作業に参加する前に, file f の標準的な projection に同期しなければならない

## UI の例

- 送る側は例えば, 左サイドバーの File の欄, あるいはスクリーン右上に invitation ボタンを設置する
  - invitation ボタンをクリックすると, ダイアログを表示する. 中身は,
    - invite されているアクタと invite しているアクタ, 招待コード (or URL), 状態, action の表を表示
      - 状態は, sent, accepted, dismissed (invite した側から), resigned (invite された側から)
        - 招待先に到達しない場合は invalid
      - action は, preview, accept, dismiss, resign (立場によってグレイアウト)
      - 招待コードは長いだろうから, 表示せずに, copy ボタン (OS の paste board に) だけでもいいかも
    - 新たな invitation 作成
      - テキスト・フィールドにハンドル名入力, generate ボタン押下
      - 上の表に招待コードと共に追加表示される
  - 今生成された招待コードをコピーして, 相手に送れば良い
- 受け取る側は例えば, 左サイドバーの一番上の import ボタンの辺りに participate ボタンを設置する
  - participate ボタンをクリックすると, ダイアログを表示する
  - その中の input field に渡された招待コードを入力する
  - 左サイドバーに対象 File が追加される
  - 上述した invitation ボタンも使えるようになる
- 招待コード (あるいは URL), 必要な情報は
  - 招待者の DID
  - 被招待者の DID
  - FileId
  - 実際にはこれらを JSON などで適当にフォーマットして, 圧縮, エンコードしたものでもいい
  - conversensus の web アプリケーション版があれば, これらを URL にエンコードしてもいいかも
