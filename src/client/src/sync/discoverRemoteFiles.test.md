# discoverRemoteFiles.test.ts — 未知ファイル発見・materialize のテスト仕様

## 何を

`discoverRemoteFiles` (remote の batch op-log から未知ファイルを発見しローカル正典へ
materialize する調整層, step1 Phase 4e-2b) を検証する。

## なぜ

新規ファイルの跨端末伝播 (4e 設計 §1.11 D-4 / §3.2b) は、この関数が remote の fileId を
列挙してローカル未存在のものを見つけ、genesis を含む batch 群を書き込むことで成立する。
`receiveRemoteBatches` (開いているファイル 1 つの差分受信) と対の関係にあり、責務境界が
崩れると二重書き込みや発見漏れが起きる:

- **既知ファイルへは書かない**: 開いているファイルは受信 (a) が担う。両方が書くと
  責務が重なり、どちらの不変条件が破れたか切り分けられなくなる (べき等性で実害は
  出ないが、境界はテストで固定する)。
- **fileId ごとに束ねて 1 回で書く**: marker 経路 (`POST /files/:id/batches/received`) は
  fileId 単位のエンドポイントなので、束ねずに 1 batch ずつ書くと HTTP 往復が膨れる。
- **失敗は throw で伝える**: 静かに握り潰すと発見漏れが恒久化する (W3d5-7 の
  「400 が無言」事故の反省)。呼び出し側 (useFileSheetOperations) が warn を出す。
  途中まで書けた部分成功は、追記のべき等性により次回契機の再実行で無害に回収される。

## どのように

依存 (`listRemoteFileIds` / `pullRemoteForFile` / `listLocalFileIds` / `appendReceived`) を
注入し、呼び出しを記録して検証する。PDS もデーモンも要らない純粋な単体テスト。

- **未知ファイルの materialize**: 未知 fileId ごとに束ねて `appendReceived` へ渡ること。
  発見順を保つこと。
- **既知ファイルは本体を取得すらしない** (Phase 7 p7-3): `pulledFor` (本体を取得した
  ファイルの列) に既知ファイルが現れないことを固定する。`skippedKnownFiles` に計上される。
- **未知ファイル無し / remote 空**: 取得も書き込みも起きない。
- **列挙にだけ現れて batch が取れないファイルは materialize しない**: 列挙は rkey から
  fileId を読むだけなので本体が取れない食い違いが起きうる。空のファイルを正典に作ると
  「中身の無いファイル」が Sidebar に現れる。
- **書き込み失敗は throw**: 失敗した fileId 以降は書かれず、例外が伝播する。
  それ以前に書けた分は残る (部分成功の許容)。

## 全件取得から「列挙 → 未知だけ取得」へ (Phase 7 p7-3)

p7-2 までは **repo 全体の batch を落としてから既知ファイルの分を JS で捨てて**いた
(`skippedKnown` = 捨てた batch 数)。既に持っているファイルの履歴を毎回転送する形だった。
p7-3 では rkey が `v1~<fileId>~…` であることを使って:

1. `listRemoteFileIds()` で fileId を列挙する (1 ファイル 1 リクエスト・各 1 レコード)。
2. ローカル既知を除く。
3. **残った未知ファイルの分だけ**本体を取る。

結果の `skippedKnown` (batch 数) は `skippedKnownFiles` (ファイル数) に変えた —
**既知ファイルの batch はもう 1 件も落とさない**ので、batch 数を数えるフィールドは
常に 0 の飾りになる。名前を変えることで単位の変化を型と読み手に伝える。

取得結果の fileId フィルタは残している (孤児 batch 防止 D-4 を rkey の正しさに
依存させない防御)。食い違いは `console.warn` に件数を出す (§3.6)。

実機での発見経路 (実 PDS からの pull → Sidebar 表示) は 4e-4 の実機 e2e で検証する
(このテストは調整ロジックのみを固定する)。
