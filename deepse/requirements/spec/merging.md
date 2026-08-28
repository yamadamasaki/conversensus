# merging

共同作業においては, 次の二種類の op-log merge が発生する.

- explicit merging
  - branch/commit/merge のワークフローにおいて, branch を sheet (trunk) に合流させる
  - ユーザの意図のもとに実行される
  - 関係者は, その File の共同作業者全員 (trunk にも影響するので)
  - merge 自体はしょっちゅう起こるものではないが, 競合の割合は高い (ある意味で競合を想定した上でブランチを切っている)
  - git の merge に近い
  - step 1 での実装は以下の通り
    - content (`node.setContent` / `node.setProperties` / `edge.setLabel` / `edge.setProperties`): 並行変更を対立として**検出**する. 解決自体は clock 順の last-write win (LWW) → step 2 でこの検出を DtR graph として実体化する
    - layout: LWW のみ. 対立にはしない → step 2 では競合判定の対象にしたい (未決)
    - structure: 追記して projection に委ねる (clock-LWW). **対立の検出はしていない** → step 2 で競合の定義から決める必要がある
- implicit merging
  - 共同作業参加者のそれぞれの PDS にある op-log を読み込んで, projection し, 合流させる
  - ユーザの意図に関わらず実行される (「同期」ボタンのようなものを使わない限り)
  - 関係者は, 各共同作業参加者 (「同期」ボタンのようなものを使わない限り, 自動で実行され, 通知だけを受け取る)
  - merge 自体は頻繁に起こるが, 競合の割合は比較的少ないものと予想される (十分に explicit merging が行われていれば)
  - github の push/pull に近いが, 以下の点は大きく違う
    - upstream/downstream という一対多の構造ではなく, 共同作業参加者の repo 間の多対多の構造である
    - トリガが push/pull のような明示的なコマンドではなく, 定期的なポーリングやリアルタイム同期のような暗示的なものである
  - step 1 では存在しなかった

step 2 では, 以下のようにする. これは, ある種の実験である.

- explicit merging は, merge の失敗による対話グラフの起動によって競合を解決する (あるいはしない)
- implicit merging は, merge できない場合には fork し, actor にはそれを通知する
  - actor は通知を受け取って, 必要ならば対話グラフを起動して, 変更を取り込む
