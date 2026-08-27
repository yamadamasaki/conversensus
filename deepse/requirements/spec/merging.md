# merging

共同作業においては, 次の二種類の op-log merge が発生する.

- explicit merging
  - branch/commit/merge のワークフローにおいて, branch を sheet (trunk) に合流させる
  - ユーザの意図のもとに実行される
  - 関係者は, その File の共同作業者全員 (trunk にも影響するので)
  - merge 自体はしょっちゅう起こるものではないが, 衝突の割合は高い (ある意味で衝突を想定した上でブランチを切っている)
  - git の merge に近い
  - step 1 では last-write win (LWW) で解決している
- implicit merging
  - 共同作業参加者のそれぞれの PDS にある op-log を読み込んで, projection し, 合流させる
  - ユーザの意図に関わらず実行される (「同期」ボタンのようなものを使わない限り)
  - 関係者は, 各共同作業参加者 (「同期」ボタンのようなものを使わない限り, 自動で実行され, 通知だけを受け取る)
  - merge 自体は頻繁に起こるが, 衝突の割合は比較的少ないものと予想される (十分に explicit merging が行われていれば)
  - github の push/pull に近いが, 以下の点は大きく違う
    - upstream/downstream という一対多の構造ではなく, 共同作業参加者の repo 間の多対多の構造である
    - トリガが push/pull のような明示的なコマンドではなく, 定期的なポーリングやリアルタイム同期のような暗示的なものである
  - step 1 では存在しなかった

step 2 では, 以下のようにする. これは, ある種の実験である.

- explicit merging は, merge の失敗による対話グラフの起動によって衝突を解決する (あるいはしない)
  - → 対話グラフ
- implicit merging は, LWW ポリシによって衝突を解決し, 通知し, 対応を促す
  - → 出来事ブラウザ
