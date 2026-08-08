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
> **本書は診断までである。§4 の方針はまだ決定ではない — §8 の未決事項をユーザーと確定
> してから実装スライスに進む。**

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
と書かれているので**戦略は確定でよい**が, 可視化が無いことを別課題として切り出すかは
§8 の未決事項とする。

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

> 副作用として, **同じ値に戻した編集も差分に出る** (Sheet 比較なら消える)。これは
> 「操作ログが正典」という立場の当然の帰結だが, ユーザー体験としては議論の余地がある
> → §8-1。

### D2: **ブランチの状態**を一級の概念にし, 基準を状態から決める

ANA-120 の提案をそのまま採る。

```
無変更   = 直近コミット (無ければ分岐点) 以降に op が無い
変更中   = op がある                       → 基準 = 直近コミット (無ければ分岐点)
commit済 = op が無く, commit が 1 件以上ある → 基準 = 分岐点
```

基準を 1 つに決めることで, 画面のハイライトと commit / merge 対象が**常に一致**する。
trunk 側では差分を表示しない (提案どおり)。

### D3: merge を message を持つ一級の記録にする (ANA-122)

commit と同じ形 (`makeCommit`) で **merge コミット**を trunk 側に記録する。message は必須。
merge の再スタンプ追記自体は今のままでよい (§2.5 で戦略は確定)。

> 「trunk 側に記録する」と書いたが, trunk の op-log に載せるのか branch のメタに載せるのかは
> 決めていない → §8-2。

### D4: ghost を接続不可にする (ANA-121)

ghost ノードに `connectable: false` を付け, 各ノード実装の ghost 分岐のハンドルを
`isConnectable={false}` にする。**ハンドル自体は消さない** — ghost エッジの端点として
座標が要るためである。

---

## 5. 実装スライス (草案)

| # | 内容 | 解消 | 依存 |
|---|---|---|---|
| S1 | ghost を接続不可にする | ANA-121 | なし。**先に入れてよい** |
| S2 | 差分を op-log 区間から導出する (`computeOperations` の置換) | ANA-124 | D1 の確定 |
| S3 | ブランチ状態を導入し, 基準を状態から決める | ANA-120 | S2 |
| S4 | merge コミット (message 必須) | ANA-122 | D3 の確定 |
| — | ANA-123 は回答のみ (実装変更なし) | ANA-123 | — |

S1 は独立している。S2 → S3 の順に依存する。S4 は独立。

---

## 6. 受入基準 (草案)

### 共通

- `bun test` / lint / typecheck が通る
- 変更した各モジュールに `.test.ts` と `.test.md` が揃っている
- **差分表示の仕様を `deepse/requirements/operation-manual-for-dev.md` に書く**
  (今はどこにも仕様が無い, §3-5)

### S1

- ghost ノードのハンドルからドラッグしてもエッジが作られない単体テスト
- ghost エッジは今まで通り描画される (端点として使うハンドルを消していない)

### S2

- ノードを動かしただけで差分が出る / commit できるテスト (ANA-124 の核)
- 意味フィールドの変更が今までと同じ集合を返す回帰テスト

### S3

- 3 状態それぞれで基準が切り替わるテスト
- **commit 直後に画面のハイライトが消える**テスト (今は分岐点基準なので残り続ける)
- trunk では差分が出ないテスト

### S4

- message 無しでは merge できないテスト
- merge 記録が残り, 履歴から引けるテスト

---

## 7. 非目標

- **content 対立の可視化** (§2.5)。今は `console.warn` のみ。別課題として切り出す
- **structure の add-wins OR-Set 厳密化** (`merge.ts` D7 が将来課題と明記)
- **branch の remote 同期** (設計 §9.2 で local 専用と決まっている)
- **per-sheet branch の見直し** (Phase 5 §9.5-1 の決定)

---

## 8. 未決事項 (ユーザーに確認したいこと)

1. **同じ値に戻した編集を差分に出すか** (D1 の副作用)。op-log 由来なら出る,
   Sheet 比較なら消える。「操作の履歴」と「結果の違い」のどちらを差分と呼ぶか。
2. **merge コミットをどこに記録するか** (D3)。trunk の op-log に載せると
   projection に影響しない op が要る。branch メタに持たせると trunk 側の履歴から引けない。
3. **content 対立の可視化を今回の範囲に入れるか** (§7 では非目標としている)。
4. **layout 差分の粒度**。「ノードを 1px 動かした」も差分として数えるか,
   しきい値や集約を設けるか。

---

## 9. 決定記録

| 日付 | 決定 | 論拠 |
|---|---|---|
| 2026-08-08 | ANA-123 の merge 戦略は**現状のままで確定**とする | 問い合わせの想定 (論理時間による直列化 / merge 競合は LWW) と実装が一致していることをコードで確認 (§2.5)。issue 本文も「それならば, そのままでいい」としている |
