# #73 timeline view の計画

> 親: [step3 timeline view](../architecture/step3/timeline-view.md) / issue #73 (候補一覧 A1)。
> 「グラフ view のアドレス (Phase 3) の上に乗る」([step3-implementation §6](./step3-implementation.md))。

## 0. 決めたこと (利用者, 2026-10-12)

| # | 問い | 決定 |
| --- | --- | --- |
| Q1 | 右サイドバーのどこに置くか | **property と切り替え。**右サイドバーの上に「property / timeline」。timeline では上に version tree、下に inspector |
| Q2 | change point (batch) が数百〜数千あるときの出し方 | **operation point の間を「N 件の変更」に畳み、押すと広げる。**選んだ node/edge に関わるものだけに絞るのは仕様どおり |
| Q3 | inspector の「view graph」 | **新しいタブで見るだけ** (read-only)。change inspector から開くときは関係する node/edge を強調する。Deep Link にも時点と強調を載せる |
| Q4 | version tree に出す branch | **開いている branch と merge 済みの branch。**fork (暗黙の merge の競合) と削除した branch は出さない |

## 1. 調べたこと

🔵 = 事実、⚪ = そこからの帰結。

### F1: 履歴の材料は揃っている

🔵 trunk の op-log を畳み込むと (`foldBranches`)、branch (分岐点の commit = `base`、状態)、trunk の commit と
merge (`trunkCommits`)、branch ごとの commit (`branchCommits`) が得られる。commit は `message`・`at`・
`authorActor`・`kind` (commit / merge)・`vector` (切断面) を持つ。

🔵 batch は `actor`・`seq`・`deps`・`timestamp` (表示用の壁時計)・`sheetId`・`ops` を持つ。branch の
batch は branch 専用の op-log (`branchFileId`) にある。

⚪ version tree は **trunk の op-log と、出す branch の op-log だけから純関数で組める**。新しい記録は要らない。

### F2: 過去の時点の姿は出せるが、アクティブな pane は最新しか出せない

🔵 `projectAddress` は vector の切断面で切った姿を出せる。見るだけの pane (`PassivePane` →
`GraphPreview`) はアドレスだけから姿を求める (`loadAddressSheet`)。強調は `PreviewMarks.selected` で付けられる。

🔵 アクティブな pane のアドレス (`App` の `viewAddress`) は常に `cut: 'head'` で、タブの移動
(`useTabNavigation`) も File・Sheet・branch しか見ない。

⚪ 「その時点のタブ」は、**本体を見るだけの pane で描くタブ**として足す。編集の仕組み
(`GraphEditor`・tap) には入れない — 過去の切断面は読み取り専用 (`isReadOnlyCut`) なので、そもそも書けない。

### F3: change point の「その時点」は batch の deps から決まる

⚪ batch b を書いた時点の姿は `{...b.deps, [b.actor]: b.seq}` で切った姿である (書いた人が見ていたもの +
その batch)。commit・merge は `vector` を持つ。分岐点は `base.vector`。

### F4: 選んだ要素の写しは 1 つ

🔵 右サイドバーが読む選択は `PropertyTarget` 1 つ (node か edge)。

⚪ 「選んだ node/edge に関わる change point だけ」は、まずこの 1 つで絞る。複数選択は後で足せる形にしておく。

## 2. スライス

| # | 中身 | 画面 | テスト |
| --- | --- | --- | --- |
| **T1** | 履歴の組み立て (`timeline/buildTimeline.ts`, 純関数)。trunk と branch の線、operation point (分岐・commit・merge)、change point (シートで絞り、選んだ要素で絞る)、畳み (Q2)、各点の切断面 (F3) | 無し | 単体 + 性質 |
| **T2** | その時点のタブ (Q3)。タブのアドレスが vector の切断面を持てば、本体を見るだけの pane で描く。ヘッダは「(時点) 読み取り専用」と言う。Deep Link に切断面と強調を載せる (#251 で外したもの) | 本体・ヘッダ | 単体 + App 結合 |
| **T3** | 右サイドバーの切り替え (Q1) と version tree。いまの線 (trunk / 開いている branch) を強調、畳んだ change point を広げる | 右サイドバー | 単体 + App 結合 |
| **T4** | operation inspector: 種類・コメント・actor・時刻・関係する node/edge・view graph | 右サイドバー | 単体 + App 結合 |
| **T5** | change inspector: batch の op の一覧 (種類と内容・actor・時刻)、関係する node/edge、要素を押すとその時点のタブで強調して開く | 右サイドバー | 単体 + App 結合 |

## 3. 未決 (実装しながら決める既定案)

- **線の並び**: trunk を左、branch を作った順に右へ。縦の順は op-log の畳み込みの順 (clock)。壁時計は表示だけに使う
- **「関係する node/edge」**: operation point は「1 つ前の operation point からその点までの batch が触った要素」、
  change point は「その batch の op が触った要素」。名前は**その時点の姿**から引く (消えた要素も名前が出る)
- **actor の表示**: 名簿のラベル (`labelCache`) を使う。引けなければ DID の短縮
