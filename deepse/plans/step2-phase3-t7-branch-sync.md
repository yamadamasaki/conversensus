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
| **T7-1** | 書き込みを trunk の op-log へ、読み取りを畳み込みの結果へ (SQLite を置き換える) | 単体 |
| **T7-2** | branch file_id を push する + 発見に 0 シート基準 | 単体 |
| **T7-3** | 参加者の branch を引く (畳み込みから branch file_id を得て、trunk の名簿でフィルタ) | 単体 |
| **T7-4** | 2 人が merge したときの畳み方 | 単体 + 性質 |
| **T7-5** | fork の到着の通知 (未決 4 次第) | 単体 + 実機 |
| **T7-6** | 既存データ (未決 2 次第) | 単体 |
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

## 7. Exit

1. alice が切った branch が、bob の branch 一覧に出る
2. alice が branch で編集した中身が、bob に見える
3. alice が merge すると、bob の trunk に取り込まれ、両者で status が merged になる
4. 片側が書いた fork が相手に届き、**1 つだけ**現れる
5. **どの端末でも branch file_id が File としてサイドバーに並ばない**
