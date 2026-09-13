# step2 Phase 3 T7: branch / commit / merge の op-log 昇格と同期

親: [step2-phase3-conflict](./step2-phase3-conflict.md) §7 /
アーキテクチャ: [step2](../architecture/step2.md) §4.2・§4.3・§6 /
仕様: [merging](../requirements/spec/merging.md)「記録するもの / しないもの」 /
前提の出所: [step1-phase5-branch-oplog](./step1-phase5-branch-oplog.md) §8・§9

## 1. なぜやるか

アーキテクチャ §4.2 と仕様 `merging.md` は、**branch / commit / explicit merge と fork を
batch collection に置く** (同期する) と決めている。いまはどれも**相手に届かない**。

- fork は T6 で書けるようになったが、器が branch なので**書いても手元に残るだけ**
- Phase 6 の DtR は「双方の承認で再 merge」を要求する。**相手に branch と merge が
  見えなければ承認する対象が現れない** (§6)

## 2. コードで固めた事実

### 事実 A: いまは 2 層とも手元専用である

| | 置き場 | 同期 |
| --- | --- | --- |
| branch / commit / fork のメタ | daemon の SQLite (`branches` / `commits` テーブル) | しない (エンドポイントは local daemon 専用) |
| branch 上の編集 | branch 専用 file_id の op-log | しない (branch の tap に `remoteQueue` を渡していない) |

step1 Phase 5 §9.2 の不変条件「branch file_id の batch は local 専用」がこれで、
**T7 はこの不変条件を外す作業である**。step1 はこの不変条件で C1 / H1 / H2 を
「発生しない」形で片付け、**3 つとも cross-device の段の前提条件として申し送った**。

### 事実 B: C1 (remote キーの衝突) は構造的に消えている

step1 当時の remote キーは `rkey = batchId` だけで、merge が branch の batch を
同じ id のまま trunk へ書くと 1 つのキーを奪い合った (C1)。**Phase 7 で rkey が
`v1~<fileId>~<clock>~<batchId>` になった**ので、fileId と clock が違えば別のキーである。
merge の再スタンプ (trunk へ、別の clock で) は衝突しない。

### 事実 C: 発見は branch file_id を File として取り込む (H2 の再発)

`discoverRemoteFiles` は、**batch が 1 件以上あり `file.remove` を持たない未知の fileId を、
シート数を見ずに**取り込む。branch 専用 file_id を push すると、**自分の別の端末で
サイドバーに branch が File として並ぶ**。

一方ローカルの一覧 (`listOplogFiles`) は **0 シートの projection を落とす**
(branch の op-log は `sheet.create` を持たないので 0 シートになる, step1 §8.4)。
**同じ基準を発見に足せば、メタの到着を待たずに自己完結で除外できる。**

> **⚠️ T7-2 で訂正 (2026-09-13)**: 「サイドバーに branch が File として並ぶ」は起きない。
> サイドバーの一覧 `GET /files` は `listOplogFiles` そのもので、発見が取り込んだ fileId も
> 同じ 0 シート除外を通る (`eventStore.test.ts` の p5-1 が固定済)。発見に基準を足す必要は
> 無く、足すとかえって害がある — T7-2 の節を参照

### 事実 D: 他の参加者の branch は、取りに行く手段が無い

参加者の repo からは**既知の fileId ごとに**引く (`pullRemoteForFile(fileId, did)`)。
branch file_id を知らなければ引けない。**メタが trunk の op-log に載れば、trunk を
畳んだ時点で branch file_id が分かり、そこから引ける** — メタ → batch の順序が自然に成立する。

### 事実 E: 分岐点は clock の数値である (H1 の再発)

`Commit.at` / `base.at` は Lamport clock の数値で、branch の中身は
`batchesUpTo(trunk, clock <= base.at)` で切り出す。**読む人の手元に届いている trunk の
batch が違えば、同じ branch でも分岐点の状態が変わる** — 分岐した人が見ていなかった
低い clock の batch が後から届くと、読む側ではそれも分岐点に含まれる。

### 事実 F: batch の範囲指定は `sheetId` しかない

`BatchSchema` の範囲は `sheetId` だけで、branch を表すフィールドは無い。

### 事実 G: T6 の fork は保存の時点で同一性と理由を失っている (2026-09-13 発見)

fork は `ForkMeta = BranchMeta & { conflictKey, origin }` だが、**daemon の `saveBranch` は
branch の列しか SQLite に書かない**。`conflictKey` と `origin` はどこにも保存されず、
読み戻すと普通の branch になる (`isFork` が偽)。**`ForkOrigin` / `ForkMeta` には
Zod スキーマも無い。**

- 実データ (:3000) の「競合: …」という名前の branch 5 件は、**どれも `origin` /
  `conflictKey` を持たない**
- `writeForks` の重複防止は「読み戻した branch のうち `isFork` のものの `conflictKey`」と
  突き合わせる (`writeForks.ts:86-88`)。**照合相手が常に空なので、重複防止が働いていない**。
  T5 の検出は新着だけを見るので実際に重複するとは限らないが、「fork は二度と復活しない」
  という書く理由そのものの保証が失われている
- **テストでは見えなかった。**`inMemoryDeps` は `saveBranch` でオブジェクトを丸ごと
  保持するので、欠落が起きない

**T7 への影響**: 決定 2「既存の fork を op にして載せ直す」は、fork については
**名前・分岐点・status しか復元できない** (理由と同一性は保存データに残っていない)。
T7 で fork を `branch.create` op に載せれば構造的に直るが、そのためには `ForkOrigin` の
スキーマが先に要る。

## 3. 中心の判断: 同期したとき branch の batch をどこに置くか

| | A: branch 専用 file_id を同期する | B: trunk の fileId 内に branch の範囲を切る |
| --- | --- | --- |
| 形 | いまの file_id のまま push する | `Batch` に `branchId` を足す (`sheetId` と同型) |
| 読み書きのコード | **step1 の branch 経路がそのまま使える** | trunk を読む全経路 (`projectFile` / 競合検出 / 上書きの報告 / 受信) に「branch を混ぜない」除外が要る |
| 発見 | 0 シート基準を足す (事実 C) | 触らない (新しい fileId が生まれない) |
| 参加期間 | trunk の名簿を借りる | trunk と同じ |
| merge | いまの再スタンプのまま (事実 B) | 同じ fileId 内で id が衝突するので**新しい id の採番が要る** |

**A を推す。**

- B は step1 が避けた「trunk の projection が branch で汚れる」を、Phase 3 / 5 で積んだ
  読み取り経路 (競合検出・上書きの報告) すべてに持ち込む。**除外を 1 箇所忘れると退行**になる
- A の弱点だった C1 は事実 B で消え、H2 は事実 C の 0 シート基準で自己完結に塞げる
- アーキテクチャ §4.3 の「新しい fileId を切ってはならない」の実体は**サイドバーに File が
  増えること**で、0 シート基準を発見にも入れれば起きない。§4.3 の文言はこれに合わせて直す

## 4. メタの表現: trunk の op-log に載せる語彙

**file 構造 op と同じ扱い**にする (`isFileOp` で振り分け、専用の畳み込みで処理する前例がある)。

| op | 中身 |
| --- | --- |
| `branch.create` | `target: BranchId`, `name`, `sheetId`, `branchFileId`, `base: Commit`。fork なら `conflictKey` と `origin` も持つ |
| `branch.setStatus` | `target: BranchId`, `status` |
| `branch.remove` | `target: BranchId`。一度消したら戻らない (決定 7) |
| `commit.add` | `target: CommitId`, 所属 (`trunk` か `BranchId`), `message`, `at`, `kind`, `sourceBranchId?`, `sourceAt?` |

- **status は LWW。**2 人が同時に merged / closed を付けたら clock 順で決まる
- **fork は `conflictKey` で 1 つに畳む。**同じ競合を参加者が独立に検出して別々の
  `branch.create` を書くので、畳み込みで同一視する (S4 の決着をここで実装する)
- SQLite の `branches` / `commits` テーブルは**畳み込みの結果**に置き換える
  (読むのは trunk の projection になる)

## 5. 決めたこと (2026-09-13)

1. **中心の判断 (§3) は A — branch 専用 file_id を同期する。**発見に 0 シート基準を足して
   サイドバーに並ぶのを防ぐ。アーキテクチャ §4.3 の「新しい fileId を切ってはならない」は、
   実体が「File が増えること」なのでその趣旨に合わせて文言を直す
2. **既存データは op にして載せ直す。**手元の `branches` / `commits` の行と branch file_id の
   batch を、一度だけ trunk の op-log へ移す。Phase 3 の実 PDS 試験で書いた fork を失わない
3. **分岐点は clock の数値のまま。**読む人の手元に届いた trunk の batch によって分岐点の状態が
   ずれうることは**既知の制約として記録する**。vector clock は step3 の第一候補として保留中
   なので、それと揃える
4. **fork の到着の通知は T7 に含める。**受信で未知の fork を畳んだら通知する
5. **事実 G (T6 の fork の欠落) は T7 の中で直す。**fork を `branch.create` op に載せれば
   構造的に直る。SQLite に列を足す別の修正は、T7 で保存先ごと置き換えるので捨てる作業になる。
   **T7 が入るまで重複防止は働かないまま**であることを受け入れる
6. **既存の fork は普通の branch として載せ直す。**名前・分岐点・status は残し、
   fork としての同一性と理由は保存データに無いので復元しない (決定 2 の fork への適用)
7. **branch の削除は `branch.remove` op にし、一度消したら戻らない** (`file.remove` と同じ
   remove-wins)。同期する以上、手元の行を物理的に消すだけでは畳み直せば復活し、相手の手元
   からは最初から消えない。相手の repo にある branch の編集記録そのものは消せないので、
   畳み込みで見えなくする。**削除は畳み込みの最後にまとめ、別名を解決してから当てる** —
   見つけた時点で当てると、削除が作成より前に並ぶ log で同じ競合の fork が復活する

### 設計者が決める技術的な点 (実装時に単体で固める)

- **2 人が同じ branch を merge したとき。**それぞれが別の clock で再スタンプするので、
  同じ batchId が trunk に 2 つの clock で届く。手元は `UNIQUE(file_id, batch_id)` で先着を
  残すので、**届く順で projection の順序がずれる**。merge を 1 回に畳む規則
  (merge コミットで同一視し、小さい clock を採る等) を決める
- **branch file_id の参加期間**: branch には名簿が無い。trunk の名簿でフィルタする

## 6. スライス

| | 内容 | 検証 |
| --- | --- | --- |
| **T7-0** ✅ | 語彙 (`branch.create` / `branch.setStatus` / `commit.add`) と畳み込み `foldBranches` (fork の同一視・status の LWW) | 単体 + 性質 (計 1719 緑) |
| **T7-1** ✅ | 書き込みを trunk の op-log へ、読み取りを畳み込みの結果へ (SQLite を置き換える) | 単体 (計 1729 緑) |
| **T7-2** ✅ | branch file_id を push する + ~~発見に 0 シート基準~~ 送信キューの鍵と bootstrap の 0 シート除外 | 単体 |
| **T7-3** ✅ | 参加者の branch を引く (畳み込みから branch file_id を得て、trunk の名簿でフィルタ) | 単体 (計 1737 緑) |
| **T7-4** ✅ | 2 人が merge したときの畳み方 (§6a: 写しに `restampedBy` / `mergedIn`) | 単体 + 性質 (計 1750 緑) |
| **T7-5** ✅ | fork の到着の通知 | 単体 (計 1765 緑)。実機は T7-7 |
| **T7-6** ✅ | 既存データ (SQLite の branch / commit を op-log へ載せ直す) | 単体 + 性質 (計 1776 緑) |
| **T7-7** | 2 アカウントの実 PDS で通しで確認 | 実 PDS |

### T7-0 で分かったこと (2026-09-13)

- **スキーマの置き場は `unified.ts`。**`BRANCH_STATUS` / `COMMIT_KIND` / `CommitSchema` を
  `branchLog.ts` から移した。`branchLog.ts` は `project.ts` を実行時に読み、`project.ts` は
  `unified.ts` を読むので、`OpSchema` のためにここから `branchLog.ts` を読むと循環する
  (Phase 5 P3 と同じ形)。パッケージの入口を実行時に読み込んで確かめた
- **fork の記述の中の op は op-log の段では検証しない。**`OpSchema` で検証すると fork を運ぶ
  `branch.create` が自分自身を含む再帰になる。仕様は記述を「畳み込みの入力ではない」と
  定めているので、`foldBranches` が読み出すときに検証し、合わなければ記述だけ落とす
- **性質テストが冪等性の不具合を見つけた。**batch の中で `setStatus` が `create` より前にあると、
  1 回目は無視されるが、同じ batch を再び渡すと 2 回目に効く。受信は同じ batch を何度も
  持ってくるので実際に起こりうる。**畳み込みの中で batch を id で重複除去**して直した
- **`fork.ts` に生の NUL 文字が混ざっていた。**`conflictKeyOf` の区切り `join('\x00')` が
  エスケープではなく生のバイトで、grep (ugrep) がファイルごとバイナリ扱いして **`makeFork` が
  検索から消えていた**。`'\u0000'` のエスケープ表記に直した (値は同じなので `conflictKey` は不変)
- 変異で確認: 重複除去を外すと冪等性の 2 件、fork の同一視を外すと 4 件、別名の解決を外すと
  1 件が落ちる

### T7-1 で分かったこと (2026-09-13)

- **書き込みの口を出来事ごとに分けた。**`saveBranch(meta)` は作成も状態の変更も同じ関数で
  表していたので、op にするには差分から意図を推し量るしかない。`branchMetaRecorder` は
  `branchCreated` / `statusChanged` / `removed` / `commitAdded` の 4 つで、trunk の tap の
  `record` から作る。**sheetId を渡さない** — 渡すと content batch としてシートの projection に混ざる
- **コミットの宛先は file_id ではなく `branchId` の有無になった。**以前は `saveCommit(fileId, …)` で
  branch のコミットを branch 専用 file_id に、merge を trunk に書き分けていた。いまはどちらも
  trunk の op-log に載り、畳み込みが `trunkCommits` / `branchCommits` に振り分ける。
  `mergeBranch` の `recordCommit` は file_id も branchId も取らない — merge を branch 側に
  書く経路そのものを作らない
- **merge コミットの `at` は記録の batch を積む前に求める。**`branch.setStatus` / `commit.add` も
  trunk の clock を進めるが、グラフの位置ではないので merge 位置に数えない
- **削除で branch 専用 op-log の行が残る。**以前の server 側 1 tx の削除は SQLite のメタ行から
  branch file_id を引いていたので、メタを op-log に移すと効かない (404 を成功扱いにしている)。
  見えなくなるのは畳み込みによる。ローカルの掃除は T7-2 以降 (発見の基準と合わせて) で扱う
- **fork の既定の器は tap の中で組み立てる。**以前は api を直に使うモジュール定数だったが、
  記録先がこの File の trunk の tap になったので、tap が作り直されたら器も作り直す
- `invertEvent` の網羅性検査が branch の 4 種を拾った。file 構造と同じく undo を通さないので
  「反転不可」の枝に入れた
- 変異で確認: merge で status を記録しないと 5 件、commit に branchId を付けないと 2 件、
  fork を記録しないと 2 件、削除を記録しないと 1 件、fork の既存一覧を読まないと 1 件が落ちる。
  **fork の既定の器 (`useEventSyncTap` の配線) を直接見るテストは無い** — T7-7 の実機で確かめる

### T7-2 で分かったこと (2026-09-13)

- **branch の tap に `remoteQueue` を渡すだけで push は成立した。**`FanoutSyncProvider` が
  branch file_id で remote へ積み、catch-up も同じ tap の同期サイクルで走る。名簿は渡さない
  (参加者の branch を引くのは T7-3)
- **発見に 0 シート基準は足さなかった (事実 C の訂正)。**サイドバーの一覧は既に 0 シートを
  落としていて、発見が branch file_id を取り込んでも File としては並ばない。逆に発見の側で
  弾くと、取り込まれないので既知集合に入らず、**起動のたびに branch の本体を引き直す**。
  取り込めば別の端末にも branch の中身が手元に来る
- **代わりに C1 が送信キューに残っていた。**`RemoteSyncQueue` の重複排除の鍵が batch id
  だけで、merge は branch の batch を**同じ id のまま** trunk へ再スタンプする。branch 分が
  保留中 (オフライン等) に merge すると、**trunk 分が黙って捨てられ**、次の catch-up まで
  相手に届かない。rkey と同じく (fileId, batch id) の組を鍵にした。事実 B は remote の
  キーについては正しかったが、手前のキューには及んでいなかった
- **名簿の起点 (bootstrap) が branch file_id にも genesis を書いていた。**0 シートを見ずに
  「自分だけが書いた op-log」なら書くので、branch の op-log が通ってしまう。T7-2 で branch が
  別の端末に materialize されると判断ログに File でない起点が並ぶので、一覧と同じ 0 シート
  除外を入れた。**既に bootstrap を済ませた端末では過去に書かれている可能性がある** (無害だが
  判断ログに残る。消す口は無いので記録だけ)
- 変異で確認: キューの鍵を batch id に戻すと 1 件、branch の tap に `remoteQueue` を渡さないと
  1 件、bootstrap の 0 シート検査を外すと 1 件が落ちる
- **⚠️ T7-4 への申し送り (T7-2)**: 送信キューは著者で絞る (S0)。他人の branch を merge すると、
  再スタンプした batch の actor は元の著者のままなので**自分の repo へ送られない**。
  2 人目が merge を行う形を T7-4 で決めるときに、この制約とぶつかる

### T7-3 で分かったこと (2026-09-13)

- **branch の tap は trunk の受信をそのまま使えない。**違いは 2 点で、`useEventSyncTap` に
  `trunkFileId` を足して切り替えた
  - **名簿は trunk のものを読む。**判断ログは trunk の fileId にしか無い。branch の fileId で
    読むと名簿が空になり、誰の repo も読まない
  - **参加者の受信は「集めて (`collectParticipantBatches`) 追記する」だけにする。**
    `receiveParticipantBatches` は implicit merge の競合を検出して fork を書き、既定の器は
    その tap の `record` なので、**branch で走らせると fork が branch の op-log に書かれる**。
    branch と trunk の対立は explicit merge が検出する。上書きの報告と `onRoster` も trunk 側の役目
- **届いても画面に出る契機が無かった (計画に無かった穴が 2 つ)。**受信はローカル正典に
  着地するだけで、画面は自分からは読み直さない
  - **branch 一覧**はシートの切り替えでしか読み直していなかった。相手の `branch.create` は
    trunk の受信で届くので、trunk の差し替え (`receiveEpoch`) を契機に足した。
    **これが無いと Exit 1 が成り立たない**
  - **開いている branch** は開いた時点の projection のまま。branch の tap の `onReceived` で
    `selectBranchFromOplog` を呼び直す。未 flush の編集が残っている間は見送る (trunk の
    `reprojectAfterReceive` と同じ判断)。組み直しは tap の callback より後で定義されるので
    ref で繋いだ (callback を安定参照に保つため)
- **branch の受信の書き込み口に差し替え口が無かった。**trunk は `deps.pushReceivedBatches` を
  通すが branch の tap は既定の実 fetch を使っていた。`BranchOplogDeps.appendReceived` を足し、
  開いている branch の組み直しを単体で通せるようにした
- **テストの名簿には `history` が要る。**参加期間は `participating` ではなく `history` の
  出来事 (accept など) から導かれるので、名前だけの名簿では相手の編集が期間の外として落ちる
- 変異で確認: 名簿を branch の fileId で読むと 1 件、branch の受信の分岐を外すと 2 件、
  `onRoster` を branch でも呼ぶと 1 件、一覧の読み直しから `receiveEpoch` を外すと 1 件、
  受信後の組み直しを止めると 1 件が落ちる。型検査・lint 緑, テスト 1737 件緑
- **まだ見ていないもの**: 相手が merge した status が、**開いている branch** の表示に反映される
  こと (一覧は読み直すが、`activeBranch` は開いた時点のメタのまま)。Exit 3 と合わせて T7-7 の
  実機で確かめる

## 6a. T7-4 の設計: 2 人が merge したとき (2026-09-13)

> **決定 (2026-09-13): 案 A に `mergedIn` を足した「B へ移れる A」を採る。**
>
> - **merge は conversensus の第一級の概念である** (利用者の位置づけ)。データ構造として最終的に
>   正しいのは B (merge を判断の記録として持ち、結果を導出する) で、U6-P2 の「判断の畳み込みを
>   述語にしてグラフの畳み込みの前に落とす」や「implicit merge は書かずに導出する」と同じ流れに
>   乗る。A は explicit merge だけが「結果を書き込む」例外として残る
> - それでも今は A を採る。B は trunk を読む全経路 (projection・一覧・競合検出・上書きの報告・
>   先読み) の書き直しで、T7 の範囲を大きく超える
> - **後から B へ移れる条件は「写しから、どの merge による写しかが分かること」**である。
>   op-log は追記のみで相手の PDS からも消せないので、移行は「B の畳み込みが A の写しを
>   認識し、merge コミットの参照から導くものと重複させない」形になる。そのため写しに
>   **`mergedIn: CommitId`** を持たせる (`restampedBy` だけでは 2 人が merge したときに
>   写しを merge コミットへ対応づけられない)。step1 以来の印の無い写しは「trunk と branch の
>   op-log に同じ id がある」ことで特定できる (branch の op-log は削除しても残る)
> - **B へ移る合図**: 次のどれかが仕様に現れたとき。遅くとも Phase 6 (DtR) の設計で merge の
>   承認・取り消しが決まった時点で判断する
>   1. merge を取り消す / 承認されるまで効かせない (DtR の「双方の承認で再 merge」)
>   2. 一部だけの取り込み (cherry-pick) や merge の merge
>   3. vector clock への移行 (写しは写した時点の scalar clock に因果が固定される)
> - **A で足す「同じ id の写しは最小のものを正として置き換える」規則は暫定である。**
>   B に移ると写しが生まれないので不要になる
> - 遅らせたときのコストは、データ量ではなく**畳み込みが扱い続ける形の数** (印の無い step1 の
>   写し / `mergedIn` 付きの写し / B の参照) と、その間に増える「写しを前提にしたコード」である

### 事実

- **merge は branch の batch を「同じ id・元の actor」のまま trunk の新しい clock に積み直す**
  (`mergeBranch.ts`)。id を保つのは再 merge のべき等性のため (2 回目は `trunkIds` で落ちる)
- **ローカル正典は同じ id の 2 つ目の写しを黙って捨てる** (`appendBatch` が `INSERT OR IGNORE`、
  `UNIQUE(file_id, batch_id)`)。clock が違っても区別しない
- **送信キューは actor が自分の batch しか送らない** (S0, `remoteFilter.ts`)。受信の参加期間
  フィルタも `batch.actor` と `batch.clock` で判定する
- `BatchSchema` は「誰が積み直したか」を持つ場所が無い

### 問題は 2 つある (1 の方が重い)

1. **merge が相手に届かないことがある。**merge した人と branch の batch を書いた人が違うと、
   積み直した batch の actor は書いた人のままなので、**merge した人の repo に 1 件も出ない**。
   一方 `branch.setStatus` と merge コミットは merge した人の batch として届く。相手には
   **「merged なのに trunk に中身が無い」**と見える。branch に複数人が書いた場合も、merge した人
   以外が書いた分だけが欠ける。Exit 3 は「alice が自分の branch を merge」なら通るので
   テストの形によっては見逃す
2. **2 人が同じ branch を merge すると手元ごとに結果がずれる。**alice は trunk clock 20、
   bob は 18 で同じ id を積み直す。それぞれの手元は自分の写しを先に持つので相手の写しを捨て、
   **projection の順序が端末ごとに違う**。収束の不変条件が破れる

### 案

| | A: 積み直した人を batch に持たせる | B: 積み直さず参照にする | C: merge した人の新しい batch にする |
| --- | --- | --- | --- |
| 形 | `Batch.restampedBy?: Actor` を足す。id と元の actor は保つ | trunk に複製しない。merge コミット (`sourceBranchId`, `sourceAt`, `at`) を畳み込みが読み、branch op-log の範囲を merge 位置に差し込む | actor を merge した人に、id を `(merge コミット, 元の id)` から決定論的に作る |
| 1 (届かない) | 送信と参加期間の判定を `restampedBy ?? actor` で見る | 消える (branch の batch は書いた人の repo にある) | 消える |
| 2 (ずれる) | **同じ id の写しが複数あれば `(clock, restampedBy)` が最小のものを正とする**。保存も「より小さい写しなら置き換える」にする | 同じ範囲への merge は最小の `at` を採る | 残る。**2 回適用になる** — 間に挟まった trunk の編集を 2 回目が巻き戻す |
| 変更の量 | shared の schema (optional なので移行不要) / `appendBatch` / S0 / 期間フィルタ / merge | **trunk を読む全経路** (projection・競合検出・上書きの報告・受信) が branch op-log を要る。§3 で B を退けた理由と同型 | merge だけ。ただし再 merge のべき等性を失い status に頼る (T7 以前に避けた形) |
| 著者 | 保たれる (表示・上書きの報告は元の actor) | 保たれる | **失われる** (書いた人が merge した人に化ける) |

**A を推す。**B は正しいが T7 の範囲を大きく超え、C は収束を壊す。

### T7-4 で分かったこと (2026-09-13)

- **印は 4 層を通す必要があった。**shared の `BatchSchema` / ATProto のレコード定義 (`batch.json`) と
  変換 (`batchMapper`) / daemon の SQLite 列 (`restamped_by` / `merged_in`) / merge の書き込み。
  どこか 1 つで落ちると、写しが「書いた人の batch」に戻る。変換は往復テストで固定した
- **判定の入口を `stackedBy` 1 つにした。**S0 と参加期間フィルタが同じ「積んだ人」を見る。
  書いた人を見るべき場面 (表示・上書きの報告) は `actor` のまま
- **merge コミットの id を写しより先に採番する。**`mergedIn` に入れるため
- **`compareCopies` は全順序でなければならない (性質テストが発見)。**当初は (clock, 積んだ人) の
  2 キーで、clock 4 の印の無い写しと、書いた本人 alice が同じ clock 4 で積み直した写しが同点に
  なった。同点だと残る写しが届いた順で決まり、規則を置いた意味が無い。第 3 キーに `mergedIn`
  (印の無い写しを先) を足した。反例は例のテストとして残した
- **置き換えも「変わった」(true) として数える。**受信の着地で画面を差し替える契機 (`appended > 0`)
  に乗せるため。位置が変わると projection の順序が変わる
- 変異で確認: S0 を書いた人で判定すると 2 件、参加期間を書いた人で判定すると 1 件、`restampedBy` を
  付けないと 1 件、`mergedIn` を付けないと 1 件、置き換えをしないと 4 件、第 3 キーを外すと 2 件、
  変換が印を落とすと 1 件が落ちる。型検査・lint 緑, テスト 1750 件緑
- **まだ見ていないもの**: 2 人の merge を実 PDS で通すこと (T7-7)。receive 経路 (`pushReceivedBatches`
  → `appendReceivedBatches`) が置き換えを通すことは `appendBatch` を共有する構造で担保しているが、
  HTTP 境界の `BatchSchema` 検証で印が落ちないことは実機で確かめる

### T7-5 で分かったこと (2026-09-14)

- **T8 が既に半分を埋めていた。**「通知は LWW の勝った側にしか出ない」問題のうち、負けた側に
  「変わった」ことを伝えるのは T8 の控えめな印である。T7-5 が足すのは別の情報 —
  **判断を保留した競合があること** (content / structure の fork) である。これが片側にしか無かった
- **出し方は仕様がほぼ決めていた。**`spec/merging.md` は「merge できない場合には fork し、actor に
  それを通知する。actor は通知を受けて必要なら対話グラフを起動する」と定め、関係者は参加者全員。
  fork の通知は DtR への入口なので、**競合の通知 (`ConflictNotice`) に出す**。T8 の印は残し、
  負けた側で同じ要素が 2 回報告される重なりは許容する (利用者の決定: 「変わった」と「決着が要る」は
  別の情報)
- **検出は受信前後の畳み込みの差分。**`detectArrivedForks` が受信前の手元と受信後で `foldBranches` を
  畳み、初めて現れた `conflictKey` の fork を返す。**自分がこのサイクルで書いた fork** と、**同じ競合の
  fork を既に持っている場合** (両側が同時に検出した) は除く。鍵で比べるので別名も同じ扱いになる
- **受け手は溜める** (`accumulateArrivedForks`)。競合の通知は検出のたびに置き換わるので、同じ state に
  入れると次の検出で消える。同じ競合は先に届いた記述を残す (記述は検出時点で凍結されている)
- **テストの fork は本物の経路で作る。**`foldBranches` は fork の記述をスキーマで検証し、対立した batch の
  id もその中にある。手書きや `${actor}-${clock}` の id だと記述が落ちて普通の branch に化け、
  **「届かない」をテストが見逃す**
- **フックの配線を見るテストが無かった (変異で発覚)。**`onForksArrived` の呼び出しを消しても 0 件しか
  落ちなかったので、`useEventSyncTap` に参加者の repo から fork が届くテストを足した
- **変異の集計で grep が空振りした。**失敗の差分に `conflictKey` (区切りが NUL) が出ると、
  `bun test | grep` がバイナリ扱いで何も出さない。集計には `grep -a` を使う
- 変異で確認: 自分が書いた fork を既知にしないと 1 件、受信前の fork を既知にしないと 2 件、
  結果に到着を載せないと 1 件、通知が到着だけのとき何も出さないと 2 件、溜めるときに上書きすると 1 件、
  フックが呼ばないと 1 件が落ちる。型検査・lint 緑, テスト 1765 件緑
- **まだ見ていないもの**: 実 PDS の 2 アカウントで、LWW で負けた側に通知が出ること (T7-7)

### T7-6 で分かったこと (2026-09-14)

- **T7-1 以降、SQLite にしか無い branch は一覧から消えていた。**読み口が trunk の op-log の畳み込みに
  なったためで、T7-1 から T7-6 までの間の状態である。書き込みは既に op-log だけなので、載せ直しは
  「SQLite にあって op-log に無いもの」を一方向に移すだけでよい
- **判定は畳み込みの結果ではなく生の op で行う。**畳み込みは削除した branch を結果から消すので、
  T7-1 以降に削除した branch (`branch.remove` はあるが `branch.create` が無い) を「無い」と見て作り直す。
  作り直しても remove-wins で見えないままだが、判定を生の op にすれば作り直し自体が起きず、べき等になる
- **op-log に既にある branch は status も含めて触らない。**SQLite の行は T7-1 以前の古い値である
- **commit の置き場は T7-1 以前の書き分けに従う。**branch のコミットは branch 専用 file_id に、merge コミットは
  trunk の file_id に保存されていた。載せ直すときに前者に `branchId` を付ける
- **既存の fork は普通の branch として移る** (決定 6)。SQLite の行は名前と分岐点と status しか持たない
- **走る時機は「trunk を開いて branch 一覧を読む直前」、セッション内で File ごとに 1 回。**File をまたいで
  一括で走らせる形 (bootstrap) は取らなかった — 記録口が開いている File の trunk の tap なので、開いていない
  File には書けない。一覧を読む前に trunk の drain を待つ (`trunkSettled` を file 操作フックから出した)
- **移した branch の中身も remote へ出す。**T7-2 の送信は branch を開いたときにしか走らないので、開かれない
  古い branch は相手に届かない。移した branch の op-log を送信キューの取りこぼし回収に通す (表示は待たない)
- **SQLite のテーブルとエンドポイントは消していない。**載せ直しの読み口として残る。消すのは全端末で載せ直しが
  済んだと言える時点で、step2 の範囲では決めない
- 変異で確認: op-log にある branch を上書きすると 2 件、記録済みの commit を再び書くと 2 件、status を移さないと
  2 件、trunk の commit を移さないと 1 件、branch の commit から所属を落とすと 1 件、フックが載せ直さないと
  1 件、**判定を畳み込みの結果にすると性質テスト (べき等) の 1 件**が落ちる。型検査・lint 緑, テスト 1776 件緑
- **まだ見ていないもの**: 実データ (:3000 の SQLite にある「競合: …」の branch 5 件など) を載せ直すこと (T7-7)

### A で決めること

- **置き換えは「追記のみ」の例外になる。**同じ id の写しが並行に 2 つ生まれるのは並行 merge の
  ときだけで、写しの中身 (ops) は同一なので、変わるのは位置だけである。それでも手元の
  projection が後から動くことは受け入れる
- **期間フィルタは積み直した人の期間で判定する。**元の actor の期間で見ると、離脱した人の
  branch を残った人が merge したときに取り込みが落ちる

## 7. Exit

1. alice が切った branch が、bob の branch 一覧に出る
2. alice が branch で編集した中身が、bob に見える
3. alice が merge すると、bob の trunk に取り込まれ、両者で status が merged になる
4. 片側が書いた fork が相手に届き、**1 つだけ**現れる
5. **どの端末でも branch file_id が File としてサイドバーに並ばない**
