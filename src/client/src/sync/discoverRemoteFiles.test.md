# discoverRemoteFiles.test.ts — 未知ファイル発見・materialize のテスト仕様

## 何を

`discoverRemoteFiles` (remote の batch op-log から未知ファイルを発見しローカル正典へ
materialize する調整層, step1 Phase 4e-2b) を検証する。

## なぜ

新規ファイルの跨端末伝播 (4e 設計 §1.11 D-4 / §3.2b) は、この関数が remote の repo 全体を
走査してローカル未存在の fileId を見つけ、genesis を含む batch 群を書き込むことで成立する。
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

依存 (`pullRemote` / `listLocalFileIds` / `appendReceived`) を注入し、呼び出しを記録して
検証する。PDS もデーモンも要らない純粋な単体テスト。

- **未知ファイルの materialize**: 複数ファイルの batch が混在する pull 結果から、
  未知 fileId ごとに束ねて `appendReceived` へ渡ること。発見順を保つこと。
- **既知ファイルは書かずに数える**: `skippedKnown` に計上され、書き込みは起きない。
- **未知ファイル無し / remote 空**: 何も書かない。
- **書き込み失敗は throw**: 失敗した fileId 以降は書かれず、例外が伝播する。
  それ以前に書けた分は残る (部分成功の許容)。

実機での発見経路 (実 PDS からの pull → Sidebar 表示) は 4e-4 の実機 e2e で検証する
(このテストは調整ロジックのみを固定する)。
