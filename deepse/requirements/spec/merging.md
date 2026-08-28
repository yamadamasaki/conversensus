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
    - layout: LWW のみ. 対立にはしない → step 2 では後述の通り検出して通知する
    - structure (`node.add` / `node.remove` / `node.setParent` / `edge.add` / `edge.remove` / `edge.reconnect`): 追記して projection に委ねる (clock-LWW). **対立の検出はしていない** → step 2 で後述の通り定義する
- implicit merging
  - 共同作業参加者のそれぞれの PDS にある op-log を読み込んで, projection し, 合流させる
  - ユーザの意図に関わらず実行される (「同期」ボタンのようなものを使わない限り)
  - 関係者は, 各共同作業参加者 (「同期」ボタンのようなものを使わない限り, 自動で実行され, 通知だけを受け取る)
  - merge 自体は頻繁に起こるが, 競合の割合は比較的少ないものと予想される (十分に explicit merging が行われていれば)
  - github の push/pull に近いが, 以下の点は大きく違う
    - upstream/downstream という一対多の構造ではなく, 共同作業参加者の repo 間の多対多の構造である
    - トリガが push/pull のような明示的なコマンドではなく, 定期的なポーリングやリアルタイム同期のような暗示的なものである
  - step 1 では存在しなかった

## structure の競合

step 1 では content の並行変更しか対立として検出していない. step 2 では structure の競合を以下のように定義する.

structure の競合は content の競合とは種類が違う. content は「同じ場所に違う値が二つ」という対称な衝突だが, structure には**片方の操作がもう片方の前提を壊す**という非対称なものが含まれる.

### 削除依存 (非対称)

**branch の操作が参照している要素を, trunk 側が分岐後に削除している. またはその逆.**

| | trunk 側 | branch 側 | 何が起きるか |
| --- | --- | --- | --- |
| S1 | node N を削除 | node N に edge を張る | edge の端点が消える (dangling edge) |
| S2 | node N を削除 | node N の内容を編集 | 編集が宙に浮く |
| S4 | グループ G を削除 | node N をグループ G に入れる | 所属先が消える |

### 並行変更 (対称)

**同じ対象に対する, 一つしか持てない値の並行変更.** content の競合と同型なので, 既存の検出器の対象を広げればよい.

| | trunk 側 | branch 側 |
| --- | --- | --- |
| S3 | edge E の source を A→B に付け替え | edge E の source を A→C に付け替え |
| S5 | node N をグループ G に入れる | node N をグループ H に入れる |

### op の粒度

現在の op は変更をまとめすぎているので, 競合の判定が粗くなる. step 2 で以下を分ける.

- `node.setProperties` / `edge.setProperties` は properties 全体を置換する. そのため, A が `foo` を, B が `bar` を編集しただけで競合と判定され, しかも負けた側のキーが丸ごと消える. ユーザから見ると**触ってもいないプロパティが消える**
  - step 2 で **キー単位の op (`node.setProperty` / `edge.setProperty`)** を追加し, 競合判定をキー単位にする
  - 既存の op-log には `setProperties` が積まれているので, projection は新旧の両方を読む (画像の `image` / `imageBlobCid` と同じ形)

### 検出後の既定の振舞い

競合を検出しても, DtR graph で決着するまでの間はグラフが表示できなければならない. その間は **add-wins (削除より追加を優先し, 要素を消さない)** を既定とする.

**判断を保留するなら, 情報を消さない方に倒す**というのがネガティブ・ケイパビリティの方針と一致するからである. clock-LWW のままだと, 削除が後に来た場合に DtR で議論する前に対象が消えてしまう.

### layout の競合

layout も競合判定の対象とする. ただし **検出して通知するだけで, DtR graph は起動しない**.

共同編集中に二人が同じノードを動かすことは日常的に起きるので, これを毎回「対話して決着すべき競合」として上げると DtR がノイズで埋まる. 一方で検出しないと, 位置が飛んだ理由がユーザにわからない. 通知だけがその中間である.

したがって競合の扱いは 3 段になる.

| 種別 | 扱い |
| --- | --- |
| content | DtR graph を強制起動 |
| structure | 通知し, そこから手動で選択的に DtR graph を起動 |
| layout | 通知のみ. DtR graph は起動しない |

## step 2 の方針

step 2 では, 以下のようにする. これは, ある種の実験である.

- explicit merging は, merge の失敗による対話グラフの起動によって競合を解決する (あるいはしない)
- implicit merging は, merge できない場合には fork し, actor にはそれを通知する
  - actor は通知を受け取って, 必要ならば対話グラフを起動して, 変更を取り込む
