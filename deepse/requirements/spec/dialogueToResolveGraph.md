# dialogue to resolve (DtR) graph

dialogue to resolve (DTR) graph は, 基本的には LPG であるが, 以下のタイミングで作られる, 競合解決を目的とした特殊なグラフである (ユーザからは, 特殊な branch のように感じられるかもしれない).

1. explicit merge で content に競合が生じた場合 → 強制的に起動
2. explicit merge で structure に競合が生じた場合 → とりあえず merge されるが, 競合が通知されるので, そこから手動で選択的に起動
  1. structure の競合の定義と, 決着までの間の既定の振舞い (add-wins) は [merging](./merging.md) を参照
  1. (1) と (2) は同時に起こる場合がある. その時には, 強制的に起動し, その中で (2) も通知される
3. implicit merge で競合が生じた場合 → とりあえず fork (暫定的な branch) されるが, 競合が通知されるので, そこから手動で選択的に起動

git/github で言えば conflict resolution で, それぞれのサービス/ツールでサポートしているような機能に相当する.

DtR graph は, conversensus がアルゴリズム的に解決できないような競合を共同作業者 (1, 2), あるいは同期の受入れ側 (3) が主体になって解決するためのものである.

DtR graph は実際には二つのグラフから成る.

一つは dialogue のためのグラフで, これを dialogue graph と呼ぶことにする. もう一つは resolve のためのグラフで, これを resolve graph と呼ぶことにする.

DtR graph は, 以下のような操作に紐づけられ, 不変レコードとして永続化され, 参照可能となる.

- (1), (2) の場合には, この競合を引き起こした merge 操作 (op-log) に
- (3) の場合には, この競合によって作られた fork に
  - implicit merge そのものは op-log に書かない (冪等な導出なので記録すべきものがない) が, その競合が作る fork は判断の記録なので書く. → [merging](./merging.md) の「記録するもの / しないもの」

## dialogue graph

dialogue graph は, グラフの競合 (それは実際にはコミュニティ内での何らかの衝突や, 問題の発生を意味している可能性がある) の解決を行うための対話を行うグラフである.

基本的には任意のグラフで構わない.

template 機構が導入されたら, その一つの例として toulmin model を用いた template を提供する予定である (→ step 2).

## resolve graph

resolve graph は, 実際に競合しているグラフを可視化し, 競合を解消するために編集できるグラフである.

merge 先となる現時点での trunk の上に, trunk と merge 対象である branch の間での競合 (branch における変更によって, branch 切り出し後に行われた他の変更が壊れる = 依存している) が表示される. UI としての実装の詳細は設計と並行して考えるが, 競合には以下のような種類がある.

- edge の label
- edge の property
- node  の label
- node の 内容
- node の property

なお, 現時点で node は label を持たない. node の label は [template](./template.md) で追加されるものなので, resolve graph の実装は template の label 追加に依存する.

conversensus 側で解決したが, ユーザの意図に合わない可能性があるもの.

- edge の接続先 (source, target)
- グループの所属関係 (これは本当にここに含まれるか, 確認が必要)

誰がこの node/edge を最後に変更したかを, 小さなアイコンで示せるといいかもしれない (→ step 3)

これらも含めて, resolve graph のすべての要素は追加/削除/編集可能である (競合を避けるために, 既存の他の要素の変更が必要となる可能性があるため).

## DtR graph

DtR graph は, dialogue graph, resolve graph の他に以下の操作が可能である.

- この解決に参加してほしい actor の呼び出し (通知自体は step 2 では他の手段で行う. → step 3)
  - デフォルトの呼び出し対象の actor は
    - explicit merge の場合は, 共同作業者全員
    - implicit merge の場合は, 自分だけ
      - explicit merge と違い, 全員が集まる必要はない. 誰を呼ぶかは場合によるので, まずは自分だけが入っていればよい, という判断である
      - あるいは競合している操作を行った actor たち
    - 起動された resolve graph を見て, 対象を追加/削除できる
- 呼び出された actor ごとのこの解決に対する承認
- この DtR graph のキャンセル
  - DtR graph 自体は (op-log として) 保存されるが, 原因となった merge をキャンセルする
    - branch を切り, 変更を加えながら commit を繰り返し, merge 前の最後の commit の状態に戻る
- 更新した DtR graph の再 merge
  - 呼び出された actor 全員が承認したら (そして, その後の変更がなければ), 再 merge が可能になる
  - 承認しない actor がいたら, **普通はそのまま (保留) である**. 呼び出し対象から外して先に進むこともできるが, それは「外して進もう」と判断した場合の選択であって, 既定の振舞いではない
  - 再 merge で, 再び競合が起きる可能性もある. その場合は, このプロセスが繰り返される
- 分岐 (→ step 3)
  - この merge 直前の状態を新たな File として分岐 (fork) する
- 保留
  - キャンセルも, 再 merge も, 分岐もされないまま放置する
  - 保留の間, trunk には merge されない. branch はそのまま生き続ける
  - その間も, 元の trunk は (branch/commit/merge を含め) 操作を積み重ねて進んでいく可能性がある. したがって保留が長引くほど再 merge は難しくなる
  - 左サイドバーで「未決着の merge がある」ことが見えるべきである

dialogue graph から競合対象の要素を指したい場合, 各要素は id を持っているので, 少なくとも File の中では参照できる. URI のような仕組みは step 2 では要らない (→ step 3).

DtR graph は, Sheet の branch と同じレベルで, 左サイドバーのブラウザに表示される. ただし, 通常の branch とは異なることをユーザが認知できるべきである.

