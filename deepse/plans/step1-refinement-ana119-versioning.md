# step1 refinement ANA-119: バージョン管理の問題点 — 診断

> 対象: Linear ANA-119「バージョン管理の問題点」(GitHub #187) とその 5 つの子課題。
>
> - ANA-120 差分表示がかなり混乱しているように見えるので, 再度仕様をまとめて, 再実装する
> - ANA-121 ghost ノードから/へエッジが引けてしまう
> - ANA-122 merge 時にコメントが書けない
> - ANA-123 merge 時に trunk との衝突を解決する方法を明確にして, 確定し, それに基づいて実装したい
> - ANA-124 layout の変更もバージョン管理対象としたい
>
> ANA-119 の本文には「そもそもの設計に問題があれば, 見直したい」とある。本書は**まず構造を
> 特定し, 直す単位を決める**ためのものである (ANA-107 / ANA-118 と同じ進め方)。
>
> **2026-08-09: §8 の未決事項はすべて確定した (§9 決定記録)。§4 の方針は決定である。
> 差分表示の仕様は `deepse/requirements/operation-manual-for-dev.md`「ブランチの作成と利用」
> に書かれた (§3-5 の欠落を解消)。実装スライス (§5) に進んでよい。**

---

## 1. 結論

子課題 5 件のうち **3 件 (ANA-120 / ANA-124 と, ANA-122 の半分) が同じ 1 個の構造から出ている。**

**原因 A: 正典は op-log なのに, バージョン管理だけが「2 つの Sheet を比べる」旧世界に残っている。**

step1 でグラフの正典は操作ログ (op-log) になった。ところが差分表示・コミット対象・
「変更があるか」の判定はすべて `computeOperations(base: Sheet, current: Sheet)`
(`src/client/src/sync/computeOperations.ts`) — **projection 済みの Sheet 同士の比較**である。
この関数は意味フィールド (content / properties / nodeType / parentId / label / source / target)
しか見ない。

その結果:

| 子課題 | 症状 | 原因 |
|---|---|---|
| ANA-124 | layout の変更がバージョン管理されない | **原因 A**。op-log には `node.setLayout` が載っていて remote にも出ているのに, 差分計算が Sheet の意味フィールドしか見ない |
| ANA-120 | 差分表示が混乱している | **原因 A + 基準の取り違え**。画面のハイライトは「分岐点」基準, commit 対象は「直近コミット」基準で, **2 つが食い違ったまま同時に表示されている** |
| ANA-122 | merge 時にコメントが書けない | **原因 B**。merge は batch の再スタンプ追記としてだけ表現され, **merge それ自体を指す記録が無い** |
| ANA-121 | ghost からエッジが引けてしまう | 局所的な描画バグ (構造とは無関係)。ghost ノードが本物と同じ接続ハンドルを描いている |
| ANA-123 | merge 戦略の確認 | 質問。**実装は問い合わせの想定どおり**である (§2.5 に回答) |

---

## 2. 診断

### 2.1 差分が layout を見ていない (ANA-124)

`computeOperations` (`computeOperations.ts:16`) はノードについて

```
content / properties / nodeType / parentId
```

だけを比べ, **`Sheet.layouts` を一度も参照しない**。エッジも同様に
`source / target / label / properties` だけである。

一方 op-log 側は layout を一級に扱っている (`unified.ts` の `OP_CATEGORY`):

- `node.setLayout` / `edge.setLayout` は **`layout` カテゴリ**
- `isSyncable` が false になるのは `presentation` だけなので, **layout は remote にも push される**

つまり**ログには載っているのに, バージョン管理からだけ抜け落ちている**。実害は表示だけでは
ない — commit 可否は `pendingOps.length === 0` で判定される (`useBranchOperations.ts:548`)
ので, **ノードを動かしただけのブランチは「変更なし」となり commit できない**。

ANA-124 の「layout も人間にとっては semantic な情報だから」という主張は, **op-log の設計とは
既に一致している**。ずれているのは差分計算だけである。

### 2.2 差分の基準が 2 つあり, 食い違ったまま同時に出ている (ANA-120)

`useBranchOperations` は基準になる Sheet を 2 つ持っている。

| state | 何 | 何に使われるか |
|---|---|---|
| `branchOriginalBase` | **分岐点** の Sheet | 画面のハイライト (`addedNodeIds` / `updatedNodeIds`, :169) と ghost 削除表示 (:194) |
| `lastCommitBase` | **直近コミット時点** の Sheet | `pendingOps` (:228) = commit ダイアログの中身と commit 可否 |

どちらも `computeOperations` を通すが**基準が違う**。したがって, 1 回 commit した後に
編集を続けると:

- 画面のハイライト = 分岐点からの差分 (= merge 対象) が出続ける
- commit ダイアログ = 直近コミットからの差分 (= commit 対象) が出る

**同じ画面で 2 つの異なる差分が同時に意味を持っている。** ANA-120 の「かなり混乱している
ように見える」はこれである。

ANA-120 が提案している仕様は, **状態によって基準を 1 つに決める**ものである。

| ブランチの状態 | 表示すべき差分 | 意味 |
|---|---|---|
| 無変更 (分岐直後 / merge 済み) | 表示しない | — |
| 変更中 | 直近コミット (無ければ分岐点) からの差分 | **commit 対象** |
| commit 済み | 分岐点からの差分 | **merge 対象** |

この 3 状態は今のコードからも導ける (`pendingOps.length > 0` → 変更中,
`newCommitsSinceMerge > 0` → commit 済み, どちらでもなければ無変更) が,
**状態という概念自体がコードに存在しない**。基準が 2 つ並列に生きているのはそのためである。

> 補足: `lastCommitBase` は commit 直後に `setLastCommitBase(activeSheet)` と
> **その場の Sheet を控えている** (:566)。再オープン時は `readBranchSheets` の
> `atLastCommit` としてログから導出される (:283) ので, **同じ値に 2 つの由来がある**。
> 原因 A を直せばこの控えも要らなくなる。

### 2.3 merge に記録が無い (ANA-122)

commit は `makeCommit(id, message, actor, branchBatches)` で **message を持つラベル付き
オフセット**として保存される (`useBranchOperations.ts:560`)。

merge は `mergeBranchOnOplog` が **branch の batch を trunk 先端の後ろへ再スタンプして
追記する**だけで (:433), merge それ自体を指す記録は残らない。残るのは
`BranchMeta.status = MERGED` だけである。

したがって「いつ・誰が・何のために merge したか」は**どこにも書けない**。ANA-122 の
「commit コメントと同様に必須にしたい」は, UI に入力欄を足す話ではなく
**merge を一級の記録にする**話である。

### 2.4 ghost が本物と同じ接続点を持っている (ANA-121)

ghost (削除予定の表示) は `toFlowAndGhostNodes` (`graphTransform.ts:391`) が
`draggable: false` / `selectable: false` を付けて作る。しかし React Flow で
**接続を止めるのは `connectable` であって `selectable` ではない**。

さらに `EditableNode` の ghost 分岐は `<Handle type="source" …>` を**そのまま描いている**
(`EditableNode.tsx:69-71`。`GroupNode` :80, `ImageNode` :180 も同型)。ハンドルがあるので
掴んでドラッグでき, 新しいエッジが引ける。

引けてしまうと何が起きるか: ghost は**存在しないノード**なので, そのエッジは
「base にしか無いノードを指すエッジ」として trunk へ載りうる。孤児エッジを作る経路である。

これは構造原因とは無関係な局所バグで, **単独で直せる** (§5 の S1)。

### 2.5 merge 戦略 (ANA-123 への回答)

問い合わせの 2 点に答える。**どちらも想定どおりである。**

> 今の branch から trunk への merge 戦略は, 「イベント列の論理時間による順序付直列化」に
> なっていますか?

**なっている。** `mergeBranchOnOplog` は branch の batch を **trunk 先端の後ろへ再スタンプ**
して追記し, 解決は `projectBatches` の **clock 順の決定論的な畳み込み**に委ねている
(`merge.ts` 冒頭 D7)。順序の全順序は `clock → actor → id` で, 端末をまたいでも一意である。

> 複数の merge 自体の競合は LWW になっていますか?

**なっている。** 再スタンプで後から merge した側が必ず大きい clock を持つので, 同じ target を
触っていれば後勝ちになる。カテゴリ別の規則は `merge.ts` の D7 に明記されている。

| カテゴリ | 規則 |
|---|---|
| content | LWW + **並行変更を「対立」として検出**する (`MergeConflict`) |
| layout | LWW のみ (対立にしない) |
| structure | 追記して projection に委ねる (clock-LWW)。add-wins OR-Set の厳密化は将来課題 |

ただし **検出した対立は `console.warn` に出るだけ**で画面には出ない
(`useBranchOperations.ts:441`, 「可視化は後続 phase」)。ANA-123 は「それならそのままでいい」
と書かれているので**戦略は確定でよい**。

> 対立検出が走る範囲 (2026-08-09 に確認): `mergeBranches` の呼び出しは全コードで 1 箇所
> (`mergeBranch.ts:104`) で, それを呼ぶのは branch → trunk の merge 実行時だけである
> (`useBranchOperations.ts:434`)。したがって **通常の trunk 編集でも remote 受信
> (`appendReceived`) でも, 検出も warn も一切走らない** — cross-device の並行 content 編集は
> 今も静かに LWW で決着している。これは Phase 5 §9.1 が cross-device branch を範囲外に
> したことの帰結で設計とは整合する。可視化を別課題として切り出すときは
> **「merge 時」と「受信時」の 2 経路がある**ことを前提にすること。

### 2.6 差分ハイライトの色が仕様書と逆だった (ANA-120 の「[バグ]」)

仕様書には「追加 = オレンジ `#f97316` / 変更 = グリーン `#22c55e`」と書かれていたが,
実装は**逆**である。

| | 追加 | 変更 |
|---|---|---|
| 実装 | グリーン `#16a34a` | オレンジ `#f97316` |
| 旧仕様書 | オレンジ `#f97316` | グリーン `#22c55e` |

該当箇所は `EditableNode.tsx:124-127` / `GroupNode.tsx:135` / `ImageNode.tsx:252` /
`graphTransform.ts:126` / `GraphEditor.tsx:257`。「変更のグリーンが機能していない」という
観察は, **変更が実際にはオレンジで出ている**ことによる取り違えと考えられる。

ただし「変更ハイライトが出ないケース」自体は別に実在する — `updatedNodeIds` は
`computeOperations` の `node.update` だけを拾う (`useBranchOperations.ts:169-186`) ので,
**ノードを動かしただけでは出ない**。これは §2.1 (原因 A) と同じ穴で, S2 で解消する。

---

## 3. 前提の確認 (コードで確認済)

1. **op-log には layout が載っており remote にも出る** (`OP_CATEGORY`, `isSyncable`)。
   ローカル限定なのは `presentation` (node.setStyle / edge.setStyle / edge.setLabelOffset) だけ。
2. **commit は差分を持たない** — ログ位置 (`at`) と message を持つラベルである
   (`useBranchOperations.ts:558` のコメントが明示している)。したがって「差分の定義を
   変える」ことは既存 commit を壊さない。
3. **branch の 3 時点はすべて 1 回の読取からログで導出できる** (`readBranchSheets`:
   `current` / `base` / `atLastCommit`)。基準を状態から決める設計はこの上に乗せられる。
4. **branch op-log は remote へ push しない** (設計 §9.2 の不変条件)。バージョン管理の
   変更は remote 同期の設計に触らない。
5. **`deepse/architecture/step1.md` と Phase 5 設計に「差分表示の仕様」は書かれていない。**
   差分は UI の実装として育っており, 仕様として決めた記録が無い。ANA-120 が
   「再度仕様をまとめて」と言っているのはこのためである。

---

## 4. 設計方針 (草案 — §8 の確定待ち)

### D1: 差分を Sheet 比較ではなく **op-log の区間**から導出する

`computeOperations(base: Sheet, current: Sheet)` を捨て, 「**この clock 区間に積まれた op**」
を差分の定義にする。branch op-log は既にこの形で存在している。

- **layout が自動的に差分に入る** (ANA-124 が消える)
- 「意味フィールドを列挙して比較する」重複が消える — 比較の網羅性を人手で保つ必要が無くなる
- 表示に必要な集合 (追加 / 変更 / 削除の id) は op の kind から直に引ける

**差分は 2 段構えで求める (2026-08-09 確定)。**

1. 基準〜現在の **op 区間から候補 target を集める** (ここで layout が自動的に入る)
2. その target について **区間を畳んだ結果の値を基準の値と比べ, 実際に違うものだけを差分とする**

2 段目があるので, **同じ値に戻した編集 (undo を含む) は差分に出ない**。

> なぜ「undo だけ消して偶然の一致は残す」ができないか: undo は `useEventStore.ts:71-88` で
> **逆イベントを普通の編集としてログに追記**する (`dispatch` と同じ `onEvent` 経路)。
> 「これは undo だ」という印はどこにも残らないので, 「(0,0)→(100,100) して undo」と
> 「(0,0)→(100,100) してから手で (0,0) へ戻した」は **op-log 上で同一**になる。
> 区別するには op / batch にスキーマを足すしかなく, remote へ出る op に「UI の操作履歴」を
> 持ち込むことになる (受信側で他端末の undo をどう扱うかまで決める必要が出る)。
> 一方 net 比較で消える差分は **commit しても merge しても trunk が変わらない**ので,
> 出さなくても利用者の行動は変わらない。実務上の決め手は `NODE_ADDED` → undo で,
> 素の op 区間だと**存在しないノードのハイライト**を出す羽目になる点である。

これは「Sheet 比較に戻る」ことではない。**候補集合は op-log の区間から取る**ので layout は
自動的に入り (ANA-124 は解消), 意味フィールドを人手で列挙する重複も消える。

> **実装 (S2) での確定 (2026-08-09)**: 1 段目の「op 区間から候補を集める」は**実装しない**。
> `current` は op-log の projection ではなく**編集中のメモリ上の Sheet** で, op-log には
> tap が非同期に書くため, op 区間を正典にするとハイライトが 1 flush 遅れる。そして
> **結果は同じになる** — projection は op で決まるので「区間の op に触れられていない target」
> は値も変わらない。op 区間は候補集合を絞る最適化にすぎない。
>
> 代わりに **比較するフィールドを op の語彙 (`OP_CATEGORY`) に対応させる**ことで、
> 「列挙の網羅性」の問題に対処した。**presentation は比較しない** (ローカル限定で
> `isSyncable` が false, `toSheet` も Sheet に載せない)。
>
> 併せて**正規化**が要る。projection 由来の Sheet と React Flow を往復した Sheet は
> 「省略」と「既定値の明示」が食い違うので, 素朴に比べると全ノードが「変更」に見える:
>
> - node layout: `x ?? 0` / `y ?? 0` / `width ?? 160` / `height ?? 80` (`DEFAULT_NODE_STYLE`)
> - edge layout: `pathType ?? 'bezier'` (`DEFAULT_EDGE_PATH_TYPE`)
> - 数値は `Math.round` (op-log が丸めて記録するので, 丸めで消える差は差分ではない)
> - properties は `undefined` と `{}` を同一視し, キー順に依存しない

### D2: **ブランチの状態**を一級の概念にし, 基準を状態から決める

ANA-120 の提案をそのまま採る。

```
無変更   = 直近コミット (無ければ分岐点) 以降に op が無い
変更中   = op がある                       → 基準 = 直近コミット (無ければ分岐点)
commit済 = op が無く, commit が 1 件以上ある → 基準 = 分岐点
```

基準を 1 つに決めることで, 画面のハイライトと commit / merge 対象が**常に一致**する。
trunk 側では差分を表示しない (提案どおり)。

> **実装 (S3) での確定 (2026-08-09)**: 状態は `BRANCH_DIFF_STATE` (trunk / unchanged /
> editing / committed) として `useBranchOperations.ts` に置き, 判定は純粋関数
> `resolveBranchDiffState(isTrunk, hasPendingChanges, commitCount)` に切り出した。
>
> - **`pendingChanges` が状態判定の入力を兼ねる** — 「変更中」= 直近コミット基準の正味の
>   差分が空でないこと, そのもの。判定用に別の計算を足していない
> - 起点 (`diffBase`) を状態から 1 つ決め, **ハイライト・ゴースト・commit ダイアログの
>   すべてを同じ `changes` から導く**。従来は 3 箇所が個別に `computeSheetChanges` を
>   呼んでおり (うち 2 箇所が分岐点基準, 1 箇所が直近コミット基準), これが食い違いの実体だった
> - merge ボタンの活性条件も `diffState === COMMITTED` に置き換えた
>   (旧: `pendingChanges.length === 0 && newCommitsSinceMerge > 0` — 意味は同じだが,
>   条件が仕様の状態名で読めるようになる)
>
> **積み残し (S3 の範囲外, 既存の挙動)**: merge 済み branch を**再オープンして**編集を
> 続けた場合, 「commit 済み」の起点は `readBranchSheets` の `base` = **元の分岐点**に戻る
> (同一セッション中は `afterMerge` が merge 時点を起点に差し替えているので正しい)。
> 再オープン後は merge 済みの内容まで差分に出る。直すには merge 時点をログから導ける
> ようにする必要があり, S4 (merge を一級の記録にする) で `commits` に merge が載れば
> 自然に導出できる。→ **S6 で解消 (2026-08-10)**。

### D3: merge を message を持つ一級の記録にする (ANA-122)

commit と同じ形 (`makeCommit`) で **merge コミット**を trunk 側に記録する。message は必須。
merge の再スタンプ追記自体は今のままでよい (§2.5 で戦略は確定)。

**記録先は既存の `commits` テーブル (2026-08-09 確定)。** commit は既に「差分を持たない
ラベル付きオフセット」として `commits` に入っている (`eventStore.ts:87`, 列は
`id / file_id / message / at / author_actor`)。ここに **`kind` (`commit` | `merge`) と
由来 branch id を足す**だけでよい。

- trunk の op-log に projection 非影響の op を新設しなくてよい
- branch メタに持たせる案と違い, **trunk の履歴から commit と merge が一列に引ける**
- `saveCommit` / `getCommits` がそのまま使える

副次的な効果として, ブランチの close 条件「merge されていないコミットが存在しない」を
`newCommitsSinceMerge` カウンタ (`useBranchOperations.ts:164`) ではなく
**commits の並び (最後の merge 以降に commit があるか)** から導けるようになる。D2 の
「状態を一級にする」と同じ方向である。

> **実装 (S4) での確定 (2026-08-09)**: `Commit` に `kind` (`commit` | `merge`) と
> `sourceBranchId` に加えて **`sourceAt` を持たせた** (設計時に挙げていなかった)。
>
> **理由**: merge コミットは trunk 側に入るので `at` は **trunk の clock** を指す。一方
> 「その merge が branch のどこまでを取り込んだか」は **branch op-log の clock** で、
> 両者は別の file_id の別系列である。`sourceBranchId` だけでは「どの branch を」しか
> 分からず、**「どこまでを」が復元できない**。上に書いた「最後の merge 以降に commit が
> あるか」は branch 側の位置と比べる話なので, `sourceAt` が無いと導出自体が成立しない。
>
> - 互換: `CommitSchema` の `kind` は `.default('commit')`。既存の commit 行 (kind 列が
>   無い時期のもの) と, branches テーブルへ列展開されている base コミットがそのまま通る
> - DB: `commits` に `kind` / `source_branch_id` / `source_at` を足し, 既存 DB 向けに
>   `migrateSheetIdColumn` と同型のべき等 ALTER を入れた
> - UI: merge は**確認ダイアログをやめて理由の入力ダイアログにした**。理由の入力そのものが
>   確認であり, 二段構えにして得るものが無い
> - 追記が 0 件の merge (再 merge・空 branch) でも**記録は残す**。「merge した」事実は
>   追記の有無と独立に起きている

### D4: ghost を接続不可にする (ANA-121)

ghost ノードに `connectable: false` を付け, 各ノード実装の ghost 分岐のハンドルを
`isConnectable={false}` にする。**ハンドル自体は消さない** — ghost エッジの端点として
座標が要るためである。

---

## 5. 実装スライス (草案)

| # | 内容 | 解消 | 依存 |
|---|---|---|---|
| S1 | ghost を接続不可にする | ANA-121 | なし。**先に入れてよい** ✅ 完了 |
| S2 | 差分に layout を含め net 比較にする (`computeSheetChanges`) | ANA-124 | D1 ✅ 完了 |
| S3 | ブランチ状態を導入し, 基準を状態から決める | ANA-120 | S2 ✅ 完了 |
| S4 | merge コミット (message 必須, `commits.kind`) | ANA-122 | D3 ✅ 完了 |
| S5 | 複数選択ドラッグの移動が op-log に載らない穴を塞ぐ | ANA-124 の残り | なし ✅ 完了 |
| S6 | 再オープン時の merge 基準を trunk の merge コミットから導く | S3 の積み残し | S4 ✅ 完了 |
| — | ANA-123 は回答のみ (実装変更なし) | ANA-123 | — |

S1 は独立している。S2 → S3 の順に依存する。S4 と S5 は独立。S6 は S4 に依存する
(merge コミットの `sourceAt` が要る)。

### S6 の根拠と実装 (2026-08-10)

S3 が積み残した「merge 済み branch を**再オープン**すると起点が元の分岐点に戻る」問題。
同一セッション中は `afterMerge` が merge 時点を控えているので正しかったが、**その控えは
React の state / ref なのでアプリを閉じると消える**。merge 済みコミット数も
セッション内の ref (`mergedCommitCounts`) に積んでいたため、開き直すと
**merge 済みの内容まで「次の merge の対象」として差分に出ていた**。

S4 で merge が `commits` に載り `sourceAt` (branch op-log 側の取り込み位置) を持つように
なったので、merge 時点をログから導ける。

- `lastMergeSourceAt(trunkCommits, branchId)` — trunk の履歴から**最後の merge の
  `sourceAt`** を引く。`at` は trunk 側の位置なので branch の切り出しには使えない。
  2 回以上 merge していれば最大値を採る (配列順に依存しない)
- `readBranchSheets` に `atLastMerge` を追加 (3 時点 → 4 時点)。**未 merge なら分岐点と
  同じ値**になるので、呼び出し側は「merge 済みか」で場合分けしない
- `newCommitsSinceMerge` は `countCommitsAfter(branchCommits, lastMergeAt)` で導出。
  **`mergedCommitCounts` ref は消えた** (D3 が副次効果として予告していたとおり)
- `afterMerge` の in-memory 更新は残す — merge した直後の値は「いま画面に出ている内容」
  そのもので、再オープン時に同じ値をログから導き直す。追加の非同期読取を merge の
  経路に持ち込まない

**確認**: `lastMergeSourceAt` の結果を undefined に固定すると再オープンのテスト 2 件が
落ちる (= テストが S6 の実装を実際に検証している)。

### S5 の根拠 (2026-08-09 発見, 要実機確認)

`onNodeDragStop` は第 2 引数 `node` しか見ていない (`GraphEditor.tsx:402`)。@xyflow/react v12 は
第 3 引数 `nodes` でドラッグ対象全部を渡すが, ハンドラはそれを無視している。したがって
**複数ノードを選択してまとめてドラッグすると, 掴んだ 1 個以外の移動が op-log に載らない**。
S2 で layout を差分に入れても, この分だけは差分に出ないまま残る。

同じ箇所は `NODE_REPARENTED` も単一ノード前提なので, 複数選択してグループへドロップした
場合も同様に取りこぼす可能性がある。実装前にテストか実機で裏を取ること。

> **実装確定 (2026-08-10)**: 型で裏を取った。`@xyflow/react` の
> `OnNodeDrag = (event, node, nodes) => void` (`types/nodes.d.ts:36`) で, 第 3 引数は
> `@xyflow/system` の `getEventHandlerParams` が `dragItems` から組み立てた**ドラッグ
> 対象すべて**。各要素は元のノードを spread して `position` だけ最新に差し替えたもの。
> `getDragItems` は「選択されている or 掴んだノード」かつ「親が選択されていない」ものを
> 集めるので, **選択された親と一緒に動く子は入らない** (子の相対座標は変わらないので
> 記録も不要 = 正しい)。
>
> 決めたこと 3 点:
>
> 1. **ドロップ先はノードごとに自分の中心で解決する**。掴んだノードの結果を全員へ
>    適用すると, 離れたノードが見た目と無関係なグループへ入る。また選択の中に解決先の
>    祖先が混ざると循環する (ノードごとなら `resolveDropTarget` が自分と子孫を候補から
>    外すので起きない)
> 2. **イベントは直前までのイベントを適用した状態に対して順に組み立てる**。
>    `NODE_REPARENTED` は `recalculateParentBounds` を通ってグループの position を
>    動かしうるので, 2 個目以降の相対座標を元のグループ位置から求めるとずれる
>    (テストで数値固定: 上へ 45 ずれる例)
> 3. **判断は `graph/dragStop.ts` へ出す**。`GraphEditor.tsx` にはテストが無く,
>    `coords.ts` / `grouping.ts` / `deletion.ts` と同じ「純関数へ出して単体テスト」の形に
>    揃えた。ドラッグ中のハイライトも同じ `resolveDropTargets` を共用する
>
> **積み残し**: undo の粒度。ノード 1 個につき 1 イベントなので undo も 1 個ずつ戻る。
> まとめて戻すには `NODES_DELETED` のような複数形イベント (`NODES_MOVED`) が要る。
> 記録漏れという穴自体は塞がっているので別課題とする。

### 実機で確かめたいこと (S2 の後)

`recalculateParentBounds` は `applyEvent` の中だけで走り (`applyEvent.ts:78, 85, 94, 208`),
**再計算されたグループのサイズは op-log に書かれない**。そのため子を編集した後,
グループが「変更」として出続ける可能性がある。値としては本当に見た目が変わっているので
誤検知とは言い切れないが, 実機で確認して不自然なら別課題にする。

---

## 6. 受入基準 (草案)

### 共通

- `bun test` / lint / typecheck が通る
- 変更した各モジュールに `.test.ts` と `.test.md` が揃っている
- **差分表示の仕様**は `deepse/requirements/operation-manual-for-dev.md`「ブランチの作成と
  利用」に記述済み (2026-08-09)。実装はこの記述と一致すること

### S1

- ghost ノードのハンドルからドラッグしてもエッジが作られない単体テスト
- ghost エッジは今まで通り描画される (端点として使うハンドルを消していない)

### S2

- ノードを動かしただけで差分が出る / commit できるテスト (ANA-124 の核)
- 意味フィールドの変更が今までと同じ集合を返す回帰テスト
- **同じ値に戻した編集 (undo を含む) が差分に出ない**テスト (D1 の 2 段目)
- 同じノードを複数回動かしても差分が 1 個に集約されるテスト

### S3

- 3 状態それぞれで基準が切り替わるテスト
- **commit 直後に起点が分岐点へ切り替わる**テスト
- trunk では差分が出ないテスト
- 画面のハイライトと commit ダイアログの内容が同じ集合を指すテスト

> **訂正 (2026-08-09, 実装時)**: ここには当初「**commit 直後に画面のハイライトが消える**
> テスト」と書いていたが、これは §4 D2 の表とも仕様書 (`operation-manual-for-dev.md`
> 「ブランチの作成と利用」) とも矛盾していた。仕様は「commit が完了すると差分の起点が
> 分岐点に切り替わり, 分岐点の内容との差分が同じように表示される (= 次の merge の対象)」で、
> **消えるのは `pendingChanges` (次の commit の対象) の方**である。D2 と仕様書を正とした。

### S4

- message 無しでは merge できないテスト
- merge 記録が `commits` に `kind='merge'` として残り, 履歴から引けるテスト
- **`at` (trunk 側) と `sourceAt` (branch 側) の両方を指すテスト** (上の実装確定を参照)
- 旧スキーマ (kind 列なし) の DB を開いても既存行が読めるテスト

### S5

- 複数ノードを選択してドラッグすると, 全ノード分の移動が op-log に載るテスト

### S6

- merge 済み branch を**開き直す** (hook を作り直し op-log だけ引き継ぐ) と, 起点が
  merge 時点になり merge 済みの変更が差分に出ないテスト
- 開き直した後の編集・commit が「merge 後の分」だけを指すテスト
- `lastMergeSourceAt` が `at` ではなく `sourceAt` を返し, 他 branch の merge を見ず,
  複数回 merge では最大値を採るテスト

---

## 7. 非目標

- **content 対立の可視化** (§2.5)。今は `console.warn` のみ。別課題として切り出す
- **structure の add-wins OR-Set 厳密化**
  — `src/shared/src/events/merge.ts:10` (冒頭 D7 のコメント) が将来課題と明記している。
  出所は `step1-phase5-branch-oplog.md:48`「spike (`spikes/o3/branchAsLog.ts`) の意味論は
  参照だけする」で, spike には OR-Set があるが本実装は clock-LWW に落としてある
- **branch の remote 同期**
  — `step1-phase5-branch-oplog.md:319-321` (§9.2) の不変条件「branch file_id の batch は
  local (daemon EventStore) 専用。remote へ push しない」。サマリは同 :349, 構造で成立
  させた記録は同 :373 (branch tap に `remoteQueue` を渡さない)
- **per-sheet branch の見直し** (Phase 5 §9.5-1 の決定)

---

## 8. 未決事項 → すべて確定済 (2026-08-09)

| # | 問い | 結論 |
|---|---|---|
| 1 | 同じ値に戻した編集を差分に出すか | **出さない**。op 区間 + net 比較の 2 段構え (D1) |
| 2 | merge コミットをどこに記録するか | **既存の `commits` テーブルに `kind` 列を足す** (D3) |
| 3 | content 対立の可視化を範囲に入れるか | **入れない** (§7 のまま。別課題へ) |
| 4 | layout 差分の粒度 | **しきい値は設けない**。target 単位の畳み込みが自然な集約 |

4 の根拠 (コードで確認済):

- `onNodeDragStart` で位置を控え, **`onNodeDragStop` で `NODE_MOVED` を 1 件だけ dispatch**
  する (`GraphEditor.tsx:363, 402-441`)。ドラッグ中の `onNodeDrag` はハイライトのみ
- 1 GraphEvent = 1 batch (`toUnified.ts:360`) なので **ドラッグ 1 回 = op 1 個**
- 位置が変わっていなければ dispatch しない (`GraphEditor.tsx:431`), 値は `Math.round` で
  整数化済み (`toUnified.ts:41`) — 微小な揺れは元から op にならない
- したがって残る集約は「区間内の同じ target への `setLayout` は最後の 1 件だけが効く」だけで,
  これは D1 の 2 段目と同じ機構で足りる

---

## 9. 決定記録

| 日付 | 決定 | 論拠 |
|---|---|---|
| 2026-08-08 | ANA-123 の merge 戦略は**現状のままで確定**とする | 問い合わせの想定 (論理時間による直列化 / merge 競合は LWW) と実装が一致していることをコードで確認 (§2.5)。issue 本文も「それならば, そのままでいい」としている |
| 2026-08-09 | 差分は **op 区間で候補を集め, net 比較で確定する** (§8-1) | 「undo だけ消して偶然の一致は残す」は今のログでは原理的に不可能 (undo は印の無い逆イベント追記)。net 比較なら undo は確実に消え, 消える側の差分は commit/merge しても trunk が変わらないので実害が無い |
| 2026-08-09 | merge コミットは **`commits` テーブルに `kind` 列を足して記録する** (§8-2) | commit が既に「差分を持たないラベル」として同テーブルにある。trunk の op-log に projection 非影響 op を新設せずに済み, trunk の履歴から commit と merge を一列に引ける |
| 2026-08-09 | content 対立の可視化は**今回の範囲外** (§8-3) | 別課題へ。切り出す際は「merge 時」と「受信時」の 2 経路があることを前提とする (§2.5 の補足) |
| 2026-08-09 | layout 差分に**しきい値を設けない** (§8-4) | ドラッグ 1 回 = op 1 個であることをコードで確認。恣意的な閾値を持ち込む理由が無い |
| 2026-08-09 | 差分ハイライトの色は**実装を正とする** (追加 = 緑 `#16a34a` / 変更 = 橙 `#f97316`) | 仕様書の記述 (追加 = 橙 / 変更 = 緑 `#22c55e`) と実装が逆だった。diff の慣習 (追加は緑) に合う実装側を採り, 仕様書を訂正した。「変更のグリーンが機能していない [バグ]」はこの取り違えである |
| 2026-08-09 | layout だけの変更は**「変更」と同じ扱いで表示する** | 画面の規則を 1 つに保つ。何が変わったかの内訳は commit ダイアログ側で見せる |
| 2026-08-09 | merge 理由は **commit と同様に必須** | ANA-122 の記述に合わせ, 仕様書 (「記述できる」= 任意) の側を訂正した |
| 2026-08-09 | merge コミットに **`sourceAt` (branch 側の取り込み位置) も持たせる** (D3) | merge コミットの `at` は trunk 側の clock で, branch 側とは別系列。`sourceBranchId` だけでは「どの branch を」しか分からず「どこまでを」が復元できない。D3 が副次効果として挙げた「最後の merge 以降に commit があるか」の導出も `sourceAt` 無しでは成立しない |
| 2026-08-09 | merge の**確認ダイアログをやめ, 理由の入力ダイアログに置き換える** | 理由が必須になった以上, 入力そのものが確認である。二段構えにして得るものが無い |
| 2026-08-09 | S3 の受入基準「commit 直後にハイライトが消える」は**誤り**として訂正 (§6) | §4 D2 の表とも仕様書とも矛盾していた。commit 後は起点が分岐点へ切り替わり差分は出続ける (= 次の merge の対象)。消えるのは `pendingChanges` の方 |
