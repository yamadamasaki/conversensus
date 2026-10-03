# step3 Phase 5: merger — 設計

> ステータス: **Q1〜Q9 確定 (2026-10-03、すべて既定案)、実装中** / 作成日: 2026-10-03
> 親: [step3 実装計画](./step3-implementation.md) の Phase 5 (S5-1〜S5-3)。仕様は [merger](../architecture/step3/merger.md)
> (図 `merger.png`)。土台は Phase 3 の multiple モード (見るだけの pane とアクティブな pane) と、Phase 1 の
> 分岐点の vector・`projectAddress`。

## 0. この Phase で入れるもの

| | 変更 | 計画の番号 |
| --- | --- | --- |
| 1 | **explicit merge の merger**: merge 元・merge 先・merge 後の 3 つの graph view と conflict list。差分表示・競合表示・pane 間の選択の連動・右クリックで取り込む | S5-1 |
| 2 | **作業中に merge 先が進んだときの扱い** (O3): merge 先と競合の一覧を作り直し、チェック状態を引き継ぐ | S5-2 |
| 3 | **implicit merge から起動する** (O2): 通知の中の merger の口 | S5-3 |

---

## 1. コードを読んで判明した事実

🔵 = コードで確認 / ⚪ = 推論・仕様の読み・未確認

### F1: merge は「branch の写しを trunk の後ろに足す」で、branch が後勝ちである

🔵 `mergeBranchOnOplog` は branch の (まだ写していない) batch を、merge した人自身の batch として写し、trunk の
先端の後へ追記する (rebase に近い意味論。**branch の編集が trunk の後発の編集に勝つ**)。写しは `copyOf` で元を指し、
写し済みの元を落とすので**何度 merge してもべき等**。写しの写しも元を辿る (`originOf`)。

🔵 競合は `mergeBranches(分岐点のグラフ, 分岐後の trunk, 写す branch)` が求める (`MergeConflict`: content /
structure / layout、target ごと、properties はプロパティ 1 つずつ)。merge を押すと、先読み (`previewMerge`) で
layout 以外の競合があれば**確認を挟み**、理由を入力させてから写し、最後に競合を通知 (`ConflictNotice`) する。
**merger は無い** — 競合は「見せて、了承させて、branch の勝ちで進める」だけである。

### F2: 「merge 後のグラフ」は今の merge が作る結果そのものである

⚪ merge 後の姿 = trunk の最新 + B (branch) の写し、を projection したもの (`mergeBranches` の `merged`)。
**解決のための編集を B の op-log に積めば**、次に merge したときに写しに含まれて trunk に載る。つまり
「merge 後のグラフで編集する」は「trunk の最新の上に重ねて描いた B を編集する」と同じ意味になる。仕様の
「これらの操作は branch 側の op-log に積まれる」と合う。

⚪ 帰結: **解決用の新しい branch は要らない** (Q1)。trunk が途中で進んでも (O3)、merge 後の姿は「trunk の最新 + B」で
作り直せば追随する。

### F3: 競合の同一性の鍵は既にある

🔵 `conflictKeyOf(conflict)` = 種別・対象・揉めた単位・対立した 2 つの batchId (整列済み)。fork の同一性に使っている
(implicit merge で全員が独立に同じ競合を検出しても、同じ鍵になる)。

⚪ 帰結: **チェック状態をこの鍵で持てば、merge 先が進んで一覧を作り直しても、解決済みの競合のチェックは残り、新しい
競合だけが未チェックで増える** (S5-2 の「チェック状態を引き継ぐ」)。

### F4: Phase 3 の multiple モードの見るだけの pane は、選べず、差分も競合も描かない

🔵 `GraphPreview` は `elementsSelectable={false}`、色分けの入力を持たない。アクティブな pane だけが `GraphEditor`。

⚪ 帰結: merger の 元・先 (読み取り専用) は `GraphPreview` を広げて、**選択の表示・差分の色・競合の印 (点線)・右クリックの
メニュー**を足す。選択の正は今までどおりアクティブな pane の React Flow に置き (Phase 3 U1 の判断)、見るだけの pane には
「いま選ばれている id」を外から渡す。見るだけの pane で選んだら、アクティブな pane に「外から選ばせる口」で伝える
(`GraphEditorControls` に足す)

### F5: implicit merge の競合は fork として凍結されている

🔵 implicit merge (受信) で競合を保留すると、fork (`ForkMeta` = 中身の空の branch + 凍結した競合の記述 `origin`) を書く。
fork の分岐点は**検出時点の手元のログ**。通知 (`ConflictNotice`) は fork の到着も出す。

⚪ 帰結: implicit merge の競合は、merge 後の姿 (trunk) に**もう畳まれている** (後勝ちで決着済み)。merger を開いても
「これから merge する branch」が無い。O2 は「merge 元/先が何を指すか」を決める必要がある (Q8)

### F6: 差分の色は branch の表示で既にある

🔵 `computeSheetChanges(base, sheet)` と、`GraphEditor` の `addedNodeIds` / `updatedNodeIds` / `deleted*` (ゴースト) が
branch の差分表示をしている。

---

## 2. 設計

### 2.1 merger のセッション

```ts
type MergerSession = {
  fileId; sheetId;
  branchId: BranchId;          // merge する branch (B)
  startedAt: VersionVector;    // merger を開いた時点 (merge 元の姿を固定する, Q4)
  checked: string[];           // 解消したとユーザが判断した競合 (conflictKeyOf)
};
```

- merger は**新しいタブ**で開く (仕様: 進行中の作業を邪魔しないように)。タブに `merger` を持たせる (`panes` は 3 つ)
- 3 つの pane:
  - **merge 元** = B を `startedAt` で切った姿 (読み取り専用, Q4)
  - **merge 先** = trunk の head (読み取り専用。動く, O3)
  - **merge 後** = trunk の head + B の head (アクティブ、編集できる)。編集は B の op-log へ (Q1)
- 配置は仕様の図: 上に 元・先、下に 後・conflict list。右サイドバーはアクティブな pane (後) を対象にする

### 2.2 表示

- **元・先**: 互いとの差分 (追加・削除・変更) を branch と同じ方法で色分け。**競合の対象は点線で囲う**
- **後**: merge 先との差分を branch と同じ方法で色分け
- **選択の連動**: どれかの pane で選んだ要素 (同じ id) を、他の pane でも選ばれた見た目にする

### 2.3 操作

- **右クリックの「取り込む」** (元・先の pane): 選んだ要素 (複数可) を、その pane の姿に**後で揃える** (Q9)。後の
  `GraphEditor` の dispatch を通すので undo / redo できる
- **conflict list**: 競合ごとにチェック・対象の名前・差異 (両側の値)。コメント入力。**すべてにチェックが入ったら
  merge が押せる**
- **merge**: 後の編集 (未コミット) があればコメントを message にして commit し、B を trunk へ merge する (Q3)。
  merge の後はタブを閉じ (または結果を見せる)、B は merged になる

### 2.4 merge 先が進んだとき (S5-2, O3)

- 受信 (や別のタブの書き込み) で trunk が進んだら、**先と後を作り直し、競合を計算し直す**。チェックは `conflictKeyOf` で
  引き継ぐ (F3)。新しく現れた競合は未チェックで足され、merge ボタンはまた押せなくなる
- 消えた競合 (後の編集や trunk の変化で解けたもの) は一覧から外す

### 2.5 implicit merge からの起動 (S5-3, O2 → Q8)

既定案: **fork を B とみなす**。merge 元 = fork の分岐点 (受け取る前の自分の姿)、merge 先 = trunk の head (受け取った後)、
merge 後 = trunk の head + fork。解決の編集は fork の op-log へ積み、merge で trunk に載せる。競合の一覧は fork の凍結した
記述 (`origin`) から出す (fork は中身が空なので、計算し直しても競合は出ない)。

---

## 3. スライス (案)

| | 内容 | 検証 |
| --- | --- | --- |
| **S5-0** | merge 後の姿 (`trunk head + B`) と競合・差分を求める純関数、チェック状態の引き継ぎ (`conflictKeyOf`) | 単体 + 性質 |
| **S5-1a** | merger のタブ (3 pane + conflict list の配置)、explicit merge で競合があれば merger を開く | App 結合 |
| **S5-1b** | 見るだけの pane の差分の色・競合の印・選択の連動 | App 結合 |
| **S5-1c** | 右クリックで取り込む (undo できる)、conflict list のチェックと merge | App 結合 + 実機 |
| **S5-2** | merge 先が進んだときの作り直しとチェックの引き継ぎ | 単体 + App 結合 |
| **S5-3** | implicit merge (fork) から merger を開く | App 結合 + 実機 |

---

## 4. 着手前に訊くこと (Q)

| | 問い | 既定案 → 確定 |
| --- | --- | --- |
| **Q1** | merge 後のグラフでの編集をどこに積むか | **B (merge する branch) 自身の op-log** (F2)。解決用の新しい branch を作らない。仕様の「branch 側の op-log に積まれる」と合い、merge は今の仕組み (B を写して足す) のままで、見えていた姿がそのまま結果になる → **確定: 既定案のとおり (2026-10-03)** |
| **Q2** | merge 後のグラフの初めの姿 | **trunk の head + B** (今の merge の結果と同じ = branch の後勝ち)。競合の箇所は B の値が出ていて、trunk の値を採りたければ先の pane から「取り込む」 → **確定: 既定案のとおり (2026-10-03)** |
| **Q3** | merger の merge ボタン | **後の編集が未コミットなら、コメントを message にして commit してから merge する**。今の「commit 済みでないと merge できない」規則を merger の中では 1 つの操作にまとめる → **確定: 既定案のとおり (2026-10-03)** |
| **Q4** | merge 元の pane が見せる B の姿 | **merger を開いた時点で固定** (`startedAt` の切断面)。後での編集が B に積まれるので、head を見せると元の姿が編集に追随してしまい、比べる相手にならない → **確定: 既定案のとおり (2026-10-03)** |
| **Q5** | チェック状態の置き場 | **タブ (`localStorage`、端末ごと)**。共有は step forward council と一緒に先送り (仕様)。閉じて開き直したら、競合はあるがチェックは空から → **確定: 既定案のとおり (2026-10-03)** |
| **Q6** | explicit merge で競合が無いとき / layout の競合だけのとき | **今どおり merger を開かずに merge する** (確認も今どおり)。仕様の起動条件は「conflict が検出されたとき」で、layout は今も確認で止めない種別 (`requiresConfirmation`) → **確定: 既定案のとおり (2026-10-03)** |
| **Q7** | 画面の配置 | **仕様の図どおり 2×2 固定** (上に 元・先、下に 後・conflict list)。左サイドバーは開いたまま (畳める)。pane の大きさの調整は後で → **確定: 既定案のとおり (2026-10-03)** |
| **Q8** | implicit merge から開くとき (O2) | **fork を B とみなす** (§2.5)。元 = fork の分岐点、先 = trunk の head、後 = trunk + fork、競合の一覧は fork の凍結した記述から → **確定: 既定案のとおり (2026-10-03)** |
| **Q9** | 右クリックの「取り込む」の単位 | **選んだ要素ごとに、その pane の姿に揃える** (本文・label・プロパティ・位置・在否)。後の pane で dispatch するので undo できる。edge を取り込むとき端の node が後に無ければ一緒に取り込む → **確定: 既定案のとおり (2026-10-03)** |

## 5. 未決 (U)

- **U1**: 3 つの pane と conflict list を限られた画面にどう詰めるか (仕様:「工夫したい」)。Phase 5 は 2×2 固定 (Q7)
- **U2**: merge の解決そのものを複数人で行う (step forward council)。仕様が step3 では先送り
- **U3**: 競合の「差異」の見せ方 (値の並置で足りるか、要素の種類ごとに描き分けるか)

---

## 6. 実施記録

### S5-0: merger の姿を求める純関数 (2026-10-03)

- `planMerge` (読みも書きもしない merge の計画) を `mergeBranch.ts` から括り出した。`previewMerge`・
  `mergeBranchOnOplog`・merger が同じ計画を使う
- `mergerSnapshot`: 元 = branch を `startedAt` で切った姿、先 = trunk の最新、後 = trunk の最新 + 写しを仮の点で
  重ねた姿、競合と対象の名前
- `carryChecks` / `allChecked`: チェックは `conflictKeyOf` で持ち、残っている競合のチェックだけを引き継ぐ

#### 分かったこと

- **`startedAt` は全 actor を含む vector でなければならない。**branch の actor だけの vector だと、trunk の genesis の
  batch (シートの作成) まで切断面の外に出て、元の姿が「シートが無い」になる。開いたときの手元の知識を使う
- 写し済みの batch を二重に写しても、projection の D3 (再 merge の写しは承認まで出さない) が消すので姿は変わらない。
  写し済みを落とす処理は見た目の上では防御で、性質では観測できない

#### 検証

単体 (merger 5 件: 性質 2・例 1・チェック 2) と既存の merge のテスト 34 件が緑。写しの点を trunk の下に潜らせる変異で落ちる。

### S5-1a: merger のタブと、競合があれば merger を開く (2026-10-03)

- タブに `merger` (merge する branch・開いた時点・チェック) を持たせた。pane は [元 (開いた時点で切った branch)、
  先 (trunk の最新)、後 (branch の最新, アクティブ)]。同じ branch の merger のタブがあればそこへ移る。保存も読む
- `useBranchOperations`: 人の判断が要る競合があり、merger を開く口 (`onOpenMerger`) があれば確認の代わりに merger を
  開く。merge の本体を `applyMerge` に括り出し、merger の merge ボタン用に `mergeResolved` (未コミットの解決の編集が
  あればコミットしてから merge, Q3) を足した。**未コミットかは op-log で判る** (merger は branch 自身の表示を動かさない
  ので、表示から数えた変更は当てにならない)
- App: merger のタブは 2×2 (Q7)。後の pane は branch を開いた画面の仕組みの上で、描くシートだけを
  `useMergerSnapshot` の「後」に差し替える。merge 先が進んだら seed し直す (trunk の batch の数の変化)。ヘッダの
  branch の操作は出さない
- `ConflictList`: チェック・対象の名前・両側の値・コメント・merge

#### 分かったこと

- **チェックの鍵を fork の同一性 (`conflictKeyOf`、両側の batch を含む) で作ると、解決の編集のたびにチェックが外れる。**
  直した本文の op と trunk の op の組が新しい競合として現れるため。鍵は merge 先 (trunk) 側の batch だけで作り
  (`mergerCheckKey`)、一覧も同じ鍵でまとめる (`mergerConflicts`)。trunk が進めば鍵が変わって再びチェックが要る (O3)
- App 結合の手数が多い件は、既定の 5 秒の上限で「失敗ではなく時間切れ」になる。merger の件だけ上限を延ばした

#### 検証

単体 1898 件 (チェックの鍵 2 件を追加)・App 結合 36 件 (merger 2 件を追加)・E2E 44 件が緑。

### S5-1b: 見るだけの pane の印と選択の連動 (2026-10-03)

- `GraphPreview` に印 (`PreviewMarks`: 差分・競合・選択) と、押された要素を知らせる口を足した。競合は node を赤の
  点線で囲い、edge は赤の破線にする (差分の色 = 枠と背景の色とは別の描き方)
- 元は先との差分、先は元との差分、後は先との差分 (`diffMarks`)。後の差分は branch の分岐点との差分ではない
- 選択の連動: 選択の正は後の canvas。見るだけの pane で押した要素は `GraphEditorControls.select` で後にも選ばせる
  (Phase 3 U1 の「外から選ばせる口」)。後に居ない要素 (消された) を押したときは押した id を印にする

#### 検証

単体 1900 件 (差分の印 2 件を追加)・App 結合 38 件 (印と選択の連動 2 件を追加)・E2E 44 件が緑。

### S5-1c: 右クリックで取り込む (2026-10-03, Q9)

- `alignToPane(result, pane, ids)`: 選んだ要素ごとに、merge 後をその pane の姿に揃える event の列 (在否・本文・名前・
  プロパティ・位置)。edge を取り込むとき端の node が無ければ連れてくる。node を消すときは繋がる edge を先に消す。
  「揃えた後は pane と同じ」「選ばなかった node は変わらない」を性質で固めた
- 見るだけの pane: 右クリックで「merge 後に取り込む」。⌘ / Ctrl / Shift を押しながら押すと複数を選べ、選んだもの全部を
  一斉に取り込む (仕様)
- `GraphEditorControls.apply(events)`: merge 後の canvas で dispatch する (undo / redo できる)

#### 検証

単体 1903 件 (取り込みの性質 2・例 1 を追加)・App 結合 39 件 (取り込み 1 件を追加)・E2E 44 件が緑。

### S5-2: merge 先が進んだとき (2026-10-03, O3)

仕組みは S5-0・S5-1a で入っていた: merger の姿は正典の知らせ (このタブ + 別のタブ + 受信の着地) で読み直し
(`useMergerSnapshot`)、merge 後は trunk の batch の数が変わったら seed し直し、チェックは trunk 側の batch で作った鍵
(`mergerCheckKey`) で引き継ぐ (`carryChecks`)。trunk 側が新しい batch になった競合は鍵が変わるので、チェックが外れて
merge がまた押せなくなる。S5-2 ではそれを App 結合で通した (別のタブが trunk の同じ node を書き換える)。

#### 検証

App 結合 40 件 (O3 の 1 件を追加) が緑。読み直さない変異と、鍵から trunk 側を外す変異で落ちる。

### S5-3: implicit merge (fork) から merger を開く (2026-10-03, Q8)

- 入口は 2 つ: fork を開いて **merge ↑** (fork は空で始まりコミットが無いが、決める入口として押せる)、および競合の通知の
  「相手が保留した競合」の行の **merger で決める**。どちらも merge ↑ と同じ `openMerger` に入る
- fork を branch とみなす (Q8): 元 = fork の分岐点 (検出した人の手元)、先 = trunk の最新、後 = trunk + fork。
  競合は計算し直さず fork に凍結した記述 (`origin`) から作る (`conflictOfFork`)。conflict list の両側の呼び名は
  merge 先 / merge 元ではなく**書いた人の名前** (`forkSideLabels`)
- **解決の編集で競合が増えない**: fork の分岐点は検出した人の手元なので、届いた側の op は分岐点の後の trunk に
  居る。解決の編集をすると、その op と解決の組が計算し直されて競合に出る。凍結した競合と揉めた単位が同じで、
  trunk 側がどちらかの側の batch であるものは同じ競合とみなす (`isSameFork`)。trunk 側が別の batch なら新しい
  競合 (O3)

#### App 結合で見つかった step1〜3 の不具合: 同じ actor の点の重複

File を開く前の判断 (参加の承認) は使い捨ての発番器で振る (`appendJudgment`)。File を開くと tap の発番器が判断ログを
**観測**するが、観測では自分の seq が進まなかった。そのため参加した人の**最初の編集が判断と同じ `(actor, seq)`** に
なり、相手は判断を知っただけで `deps` にその点を載せ、まだ見ていない編集を「見た」ことになっていた。並行の書き換えが
競合ではなく**上書きの報告に分類される** (fork が作られない)。`CausalClock.observe` で自分の点の seq を進めるよう
直した (性質: 同じ actor の発番器が 2 つあっても、相手の点を観測してから振るなら同じ点を 2 度振らない)。

残る窓: tap が判断ログを観測するのは開いてから最初の受信サイクルである (`fileSession.ts` に既に記されている
clock の窓と同じ)。その前に編集すると重複しうる。また `appendJudgment` の使い捨ての発番器は判断ログだけから
復元するので、**グラフの op-log を持っている File を開かずに判断を書くと**、逆向きに重複しうる (コメントは
「手元に 1 件も無い」を前提にしている)。どちらも本 Phase の範囲外として残す。

#### 検証

単体 1911 件 (fork の性質 1・例 4、発番器の性質 1・例 1、通知の入口 1 を追加)・App 結合 41 件 (fork から開く
1 件を追加) が緑。凍結した競合との突き合わせを外す・fork で merge ↑ を押せなくする・fork でも merger を開かない、
の変異のどれでも App 結合が落ちる。発番器の修正を戻すと性質と例が落ちる。

### 実機確認 (2026-10-03, Chrome・1 端末・未ログイン)

explicit merge の通し: node「もと」→ branch b1 で「branch 案」にしてコミット → trunk で「trunk 案」+ node を足す →
b1 で merge ↑ → merger が新しいタブで 2×2 に開く (元・先の競合の node が赤の点線、先で trunk にだけある node が追加の
緑、conflict list 0 / 1) → 先の「trunk 案」を右クリック →「merge 後に取り込む (1)」で後が「trunk 案」→ チェック
(取り込みの後も外れない) + コメント → merge → タブが閉じ、trunk は「trunk 案」+ 足した node。

見つかった不具合 2 件 (直して App 結合に足した):

- **merge の後に戻った branch の画面が古い**: merger と branch のタブは同じ branch を指すので、移っても選び直されず、
  解決の編集が branch の画面に出なかった (op-log は正しく、再読み込みで直る)。merger の merge 後から離れたら branch を
  op-log から組み直す (`reloadBranch`、受信と同じ経路)
- **merger で決めた後に「LWW で確定」の通知が出る**: `mergeResolved` は通知を出さない (`applyMerge` の `notify: false`)

- **見るだけの pane に「ラベル」の口が出る**: 選択が連動する (S5-1b) ので、選択中にだけ出る「ラベル」の口が元・先にも
  現れていた (押しても何も起きない)。`EditableNode` が `useReadOnly()` を見て、読み取り専用ではラベルの口を出さず
  本文の編集にも入らないようにした (単体で固定)

2 回目の通し (b2) で、merge 後での解決の編集「まとめ」→ merge → 戻った b2 の画面が「まとめ」・競合の通知なし、を確かめた。
ラベルの口の修正は単体でだけ確かめている。

fork から開く経路 (S5-3) は 2 人の参加者が要るので実機では通していない (App 結合で通している)。
