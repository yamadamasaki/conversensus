# fileDeletion.test.ts — ファイル削除の書き込み経路

## 何を

ファイル削除を op-log の `file.remove` (tombstone) として書き込む経路を検証する。
`nextTombstoneClock` (clock の決め方)、`buildTombstoneBatch` (batch の組み立て)、
`deleteFileByTombstone` (読み → push の手順) の 3 つ。

## なぜ

ANA-127「local で削除しても PDS にあるから復活してしまう?」の修正本体である。
元の実装はローカル DB の行を物理削除し (`DELETE /files/:id`)、PDS 側は **legacy の
`files` コレクション**を消しに行っていた。正典である `batches` コレクションには触れて
いなかったため、次回起動の discovery が「ローカルに無い = 未知ファイル」と判定して
PDS から materialize し直し、削除が取り消されていた (設計 §2.1)。

したがってこのモジュールが守るべき性質は「削除したことが op-log に残る」であり、
テストもそこに集中する。

## どのように

### clock の決め方が本質 (`nextTombstoneClock`)

tombstone の clock は **既存の最大 clock + 1** でなければならない。「一意ならよい」
のではない。他端末の削除検出は `listBatchFileHeads` が各ファイルの**最大 rkey に着地する**
性質に乗っており (Phase 7 p7-3)、rkey は `v1~<fileId>~<clock12>~<batchId>` で clock 順に
並ぶ。tombstone が最大 clock を持たないと着地点が tombstone にならず、他端末は本体を
引くまで削除に気づけない — 毎回の起動で削除済みファイルを転送することになる。

- **空 op-log で 1**: 発番の下限。
- **最大 clock + 1**: 複数 batch の最大値を取る。
- **投入順に依存しない**: 「最後の要素の clock + 1」ではないことを固定する。
  op-log は clock 昇順で返ってくるとは限らない (受信直後など)。

### batch の形 (`buildTombstoneBatch`)

- **`file.remove` 1 件**であること。
- **actor と clock** が載ること。
- **`sheetId` を持たない**こと — file 構造 batch は sheet scope を持たない (W3c2 §2.1)。
  載ると projection が content として扱おうとする。
- 組み立てた batch が `isFileDeleted` で削除済みと判定されること。**この 2 つの実装が
  食い違うと、削除したのに削除済みと認識されない**ので、書き手と読み手を繋いで固定する。

### 手順 (`deleteFileByTombstone`)

- **宛先ファイルの op-log を読み、そのファイルへ push する**。fileId が読みと書きで
  一致することを明示的に見る — このモジュールが存在する理由が「tap が activeFile に
  束ねられていて、削除は開いていないファイルにも掛かる」ことなので、宛先の取り違えは
  このコードで最も起こりやすい欠陥である。
- **失敗を握り潰さない**: push の失敗、op-log 読み取りの失敗のどちらも throw する。
  呼び出し側 (`handleDeleteFile`) は throw されたら UI からファイルを消してはいけない —
  消すと「画面には無いが次の起動で戻る」という ANA-127 そのものの状態になる。
- **読み取りが失敗したら push しない**: clock が決まらないまま tombstone を書くと、
  最大 clock を割り込んで上記の着地点の性質が壊れる。

## テスト対象外

- **remote への実際の送出**。`push` は deps で受けており、実体は呼び出し側が組み立てる
  provider (local、ログイン中は fanout) である。fanout の挙動は
  `fanoutSyncProvider` 側のテストが持つ。
- **discovery が tombstone をどう扱うか**。読み手側の話なので `discoverRemoteFiles` の
  テストが持つ。
