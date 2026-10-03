# step3 Phase 5: merger — 設計

> ステータス: **ドラフト (Q1〜Q9 未確定)** / 作成日: 2026-10-03
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

| | 問い | 既定案 |
| --- | --- | --- |
| **Q1** | merge 後のグラフでの編集をどこに積むか | **B (merge する branch) 自身の op-log** (F2)。解決用の新しい branch を作らない。仕様の「branch 側の op-log に積まれる」と合い、merge は今の仕組み (B を写して足す) のままで、見えていた姿がそのまま結果になる |
| **Q2** | merge 後のグラフの初めの姿 | **trunk の head + B** (今の merge の結果と同じ = branch の後勝ち)。競合の箇所は B の値が出ていて、trunk の値を採りたければ先の pane から「取り込む」 |
| **Q3** | merger の merge ボタン | **後の編集が未コミットなら、コメントを message にして commit してから merge する**。今の「commit 済みでないと merge できない」規則を merger の中では 1 つの操作にまとめる |
| **Q4** | merge 元の pane が見せる B の姿 | **merger を開いた時点で固定** (`startedAt` の切断面)。後での編集が B に積まれるので、head を見せると元の姿が編集に追随してしまい、比べる相手にならない |
| **Q5** | チェック状態の置き場 | **タブ (`localStorage`、端末ごと)**。共有は step forward council と一緒に先送り (仕様)。閉じて開き直したら、競合はあるがチェックは空から |
| **Q6** | explicit merge で競合が無いとき / layout の競合だけのとき | **今どおり merger を開かずに merge する** (確認も今どおり)。仕様の起動条件は「conflict が検出されたとき」で、layout は今も確認で止めない種別 (`requiresConfirmation`) |
| **Q7** | 画面の配置 | **仕様の図どおり 2×2 固定** (上に 元・先、下に 後・conflict list)。左サイドバーは開いたまま (畳める)。pane の大きさの調整は後で |
| **Q8** | implicit merge から開くとき (O2) | **fork を B とみなす** (§2.5)。元 = fork の分岐点、先 = trunk の head、後 = trunk + fork、競合の一覧は fork の凍結した記述から |
| **Q9** | 右クリックの「取り込む」の単位 | **選んだ要素ごとに、その pane の姿に揃える** (本文・label・プロパティ・位置・在否)。後の pane で dispatch するので undo できる。edge を取り込むとき端の node が後に無ければ一緒に取り込む |

## 5. 未決 (U)

- **U1**: 3 つの pane と conflict list を限られた画面にどう詰めるか (仕様:「工夫したい」)。Phase 5 は 2×2 固定 (Q7)
- **U2**: merge の解決そのものを複数人で行う (step forward council)。仕様が step3 では先送り
- **U3**: 競合の「差異」の見せ方 (値の並置で足りるか、要素の種類ごとに描き分けるか)

---

## 6. 実施記録

(着手後に書く)
