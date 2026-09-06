# step2 Phase 3 設計: 競合と器

仕様: [merging](../requirements/spec/merging.md)
計画: [step2-implementation](./step2-implementation.md) §3 Phase 3
前提: [step2-phase2-sync](./step2-phase2-sync.md) (多アクタ同期。完了)

> **step2 で最大の Phase である。**当初は「競合の 3 段構え」だけだったが、2026-08-30 の
> レビューで **「DtR が乗る器を作る Phase」** に拡張された (計画の事実 5 / 6)。
> DtR graph も fork も、この Phase が作る土台の上にしか乗らない。

## 0. この Phase が決めること

1. 競合を **3 段** (content / structure / layout) に扱い分ける
2. 決着までグラフを消さない — **add-wins 化**
3. **fork を書く**。implicit merge そのものは書かないが、fork は判断の記録なので書く
4. **器**: branch / commit / merge を op-log へ昇格し、同期対象にする

## 1. コードを読んで判明した、この Phase の形を決める事実

### 事実 A: ⚠️ implicit merge は競合を **1 件も検出していない**

`mergeBranches` の呼び出し元は **explicit branch merge だけ**である
(`mergeBranch.ts:126`。リポジトリ全体でここ 1 箇所)。

Phase 2 が作った受信経路は「名簿を読む → 参加期間で絞る → ローカル正典へ追記 →
再 projection」であって、**競合という概念がどこにも無い**。多アクタで同じノードを同時に
編集しても、いま起きるのは clock-LWW による黙った上書きだけである。

**したがって Phase 3 の最初の仕事は「検出の改良」ではなく「検出器を受信経路に持ち込む」
ことである。**この順序を取り違えると、add-wins も fork も置き場所が無い。

### 事実 B: 競合は `console.warn` にしか出ていない

```
src/client/src/hooks/useBranchOperations.ts:518
  `[branch] merge: ${result.conflicts.length} 件の対立を LWW で確定`
```

`conflicts` を受け取る `.tsx` は 1 つも無い。**通知 UI はゼロから作る。**
仕様が求める 3 段のうち、structure と layout は通知が本体なので、ここが無いと
「検出したが誰にも届かない」で終わる。

### 事実 C: `mergeBranches` は op 列しか受け取らないので、カスケード削除が見えない

```ts
export function mergeBranches(trunkAfterBase: Batch[], branchBatches: Batch[]): MergeResult
```

削除依存の検出 (`collectRemoveDependencies`) は **`node.remove` / `edge.remove` の
`target` だけ**を `removed` に入れる。ところが projection の `node.remove` は
**子孫ノードと端点を失うエッジをカスケード削除する** (`project.ts` の `applyOp`)。

したがって**グループを 1 つ消すと、子ノードとそのエッジも消えるのに、その id は
`removed` に入らない**。子ノードを前提にした相手側の op は削除依存として検出されない。

計画の言う「`mergeBranches` が base のグラフを受け取る形にする (シグネチャ変更)」は
この帰結である。判定の入力が「op に書かれた id」ではなく
**「分岐点の状態にカスケードを当てた集合」**になる (仕様 `merging.md` の S1' / S2')。

### 事実 D: projection は remove-wins + clock-LWW である

`node.remove` は対象と子孫を `nodes` から即座に消す。add-wins の入口はどこにも無い
(`sheet.create` / `sheet.remove` だけが add-wins だが、これはシート単位の別の判断である)。

**add-wins 化は projection の意味論を変える**ということである。競合検出の話ではない。

### 事実 E: layout は競合判定に一切入っていない

`collectParallelChanges` が見るのは `isContentOp` と `isParallelStructureOp`
(`node.setParent` / `edge.reconnect`) だけで、**`node.setLayout` はどちらにも入らない**。
`prerequisitesOf` も layout を対象外と明記している。

仕様は layout を「検出して通知するだけ」と定めるので、**判定の系列を 1 本増やす**ことになる。
削除依存には混ぜてはならない (混ぜると DtR がノイズに埋まる)。

### 事実 F: merge は競合を検出しても止まらない (適用点は「即時」である)

`mergeBranch` は `mergeBranches` から `conflicts` を受け取った後、**無条件に**
`appendBatches` する。staged (保留して人に見せる) の経路は存在しない。

計画が「シグネチャ変更と**同じスライス**で staged / 即時を決める」と言うのは、
どちらも `mergeBranches` の呼び出し規約を変えるからである。別々にやると同じ経路を
2 回作り直す。

### 事実 G: branch batches は remote へ出ない — 明示的にそう書いてある

```ts
src/client/src/hooks/useBranchOperations.ts:191
  // remoteQueue は渡さない = branch batches は remote へ出ない (設計 §9.2)
```

branch は **専用の file_id** の op-log に貯まり、その tap には `remoteQueue` を渡していない。
Phase 2 は「維持する」と決め、**その対価を Phase 3 が払う**と書き残した
(`step2-phase2-sync.md` §7)。

fork を「書く」と決めた以上、**器である branch が同期対象でなければ書いても相手に届かない**。

> ⚠️ branch op-log へ構造 op (`sheet.create` 等) を流してはならないという既存の制約がある
> (branch がファイル一覧に現れてしまう)。同期対象にするとき、この制約が
> `discoverParticipatingFiles` 側にも効く — **「branch の file_id は File ではない」を
> 判別する手段**が要る。Phase 2 が「Phase 3 の器で一緒に決めた方が形が揃う」と
> 送った判断がこれである。

### 事実 H: fork は 1 行も無い。種別を置く場所も無い

`fork` は仕様 (`merging.md` §fork) にあるだけで、実装は存在しない。

batch の scope は `fileId` / `sheetId` の 2 段しかなく、**「この batch は fork である」を
書く場所が無い**。ここで決めた形が Phase 6 の DtR の種別にそのまま効く。

## 2. add-wins 化 (事実 D)

**決着までグラフが表示できなければならない。**clock-LWW のままだと、削除が後に来た場合に
DtR で議論する前に対象が消える。「判断を保留するなら情報を消さない方に倒す」。

- 削除は **tombstone** にして、projection が「消えているが在る」を表せるようにする。
  完全に消すのは決着の後である
- **カスケードも同じ扱いになる。**親が tombstone なら子も tombstone であって、
  消えるわけではない
- ⚠️ **`file.remove` は例外である** (ANA-127 で remove-wins・sticky と決めた)。
  File の削除には「再作成」に相当する op が無いので add-wins にする意味が無い。
  **ここを一緒に倒さない**

> **性質で確かめる。**「add-wins にしても ∀ 配送順で同じ projection になる」は
> Phase 2 の S7 (`convergence.test.ts`) の生成器がそのまま使える。**削除を引く生成器で
> 収束が壊れないこと**が add-wins 化の受入基準になる。

## 3. カスケード削除の推移的検出 (事実 C)

`mergeBranches` に**分岐点の状態**を渡す。判定は次の形になる。

1. 分岐点のグラフを projection する
2. 片側の `*.remove` に**カスケードを当てて**、実際に消える要素の集合を求める
3. その集合を前提にしている相手側の op を削除依存とする

**カスケードの計算を 2 箇所に書かない。**`project.ts` の `applyOp` が持っている規則
(子孫 + 端点を失うエッジ) を切り出して共有する。片方だけが更新される形にすると、
「projection では消えるのに競合としては検出されない」が静かに戻る。

## 4. implicit merge に検出器を持ち込む (事実 A)

受信経路 (`receiveParticipantBatches` → 追記 → 再 projection) の**追記の前**に検出を挟む。

- **「分岐点」は explicit merge と違って自明ではない。**explicit merge には
  `meta.base.at` があるが、implicit merge には無い。**受信した batch の最小 clock の直前**を
  分岐点と見なすのが素直だが、これは決め事である (→ §8 未決 ③)
- **検出は追記を止めない。**implicit merge は導出であって、止めると「相手の編集が
  届かない」になる。止めるのではなく **fork を書いて通知する** (仕様 step 2 の方針)

## 5. layout の競合 (事実 E)

判定の系列を 1 本増やす。`node.setLayout` は「一つしか持てない値」なので
`collectParallelChanges` と同型でよい。

- **削除依存には混ぜない** (`prerequisitesOf` を触らない)
- **DtR は起動しない。**3 段の一番下として、通知にだけ乗せる
- ⚠️ **layout の並行変更は日常的に起きる。**毎回通知しても埋もれるので、
  **通知の畳み方**が要る (同じ対象の連続した layout 競合は 1 件にまとめる、など)。
  ここは UI の設計であって検出の設計ではない

## 6. fork (事実 H)

**fork は op-log に書く。**implicit merge 自体は書かないが、fork は「この競合を保留した」
という判断の記録であり、書かないと同期のたびに解決済みの fork が復活する。

**検出の瞬間に理由を凍結する** (仕様 §fork)。畳み直しでは復元できない —
fork の後も op-log は伸びるし、負けた側がその後に消えていれば競合そのものが再現しない。

凍結するもの (仕様の表):

| | 内容 | いまの `MergeConflict` から |
| --- | --- | --- |
| 種別 | content / structure (削除依存か並行変更か) / layout | `category` + `kind` がそのまま使える |
| 対象 | 要素の id と **その時点で人間に見える形** | id はある。**「見える形」は無い — 足す** |
| 双方の操作 | 対立した 2 つの op と actor と clock | `ours` / `theirs` に `batchId` があるので **actor と clock は導ける** |
| 分岐点 | どこまで畳んだ状態で検出したか | **無い — 足す** |

つまり `MergeConflict` に足すのは実質**「人間に読める形」と「分岐点」の 2 つ**である。

**これは記述であって畳み込みの入力ではない。**唯一の用途は、この fork から DtR を
起動するときの呼び出し対象の既定値を供給することである。他の actor の記述と一致している
必要も無い。

## 7. 器: branch / commit / merge の op-log 昇格と同期 (事実 G)

**工数は DtR 本体より大きい可能性がある** (計画の見立て)。

- 新しい op 語彙 (`branch.*` / `commit.*` / `merge.*`) を判断ログではなくグラフ側の
  batch collection に足す
- branch 専用 file_id を remote へ出す。**`discoverParticipatingFiles` が branch を
  File として materialize しないこと**が不変条件になる (事実 G の ⚠️)
- 既存の `branches` / `commits` テーブルからの移行

## 8. 未決 — **着手前に決める 3 つ**

### ① 語彙変更が Phase 5 と重なる

器の語彙追加と、Phase 5 の `node.setLabel` が同じ「op 語彙を足す」作業である。
**Phase 3 内で語彙追加を先に閉じる**か、**Phase 5 を前倒す**かの判断が要る。

- 前倒す利点: 語彙の追加とマイグレーションを 1 回で済ませられる
- 前倒さない利点: Phase 3 が大きすぎるので、これ以上積まない

### ② merge の適用点 — staged か即時か (事実 F)

いまは即時である。**シグネチャ変更と同じスライスで決める** (別々にやると同じ経路を
2 回作り直す)。

- **即時のまま**: 追記してから通知する。implicit merge とは揃うが、explicit merge で
  「merge したら壊れた」が起きうる
- **staged**: 競合があれば保留して人に見せる。explicit merge の意味論としては素直だが、
  保留した状態をどこに置くか (= もう 1 つの器) が要る

### ③ implicit merge の「分岐点」の定め方 (§4)

explicit merge の `meta.base.at` に相当するものが無い。受信した batch の最小 clock の
直前が素直だが、**受信は複数の actor から同時に来る**ので「1 つの分岐点」に畳めるとは
限らない。fork の記述に載せる値でもある (§6 の表)。

## 9. スライス

| | 内容 | 検証 |
| --- | --- | --- |
| **T0** | カスケードの規則を `project.ts` から切り出して共有する | 単体。projection と検出が同じ集合を出す |
| **T1** | `mergeBranches` に分岐点の状態を渡す (シグネチャ変更) + **適用点を決める** (未決 ②) | 単体。グループ削除で子への依存が検出される |
| **T2** | add-wins 化 (tombstone) | 単体 + **S7 の生成器に削除を厚く引かせて収束を確かめる** |
| **T3** | layout の競合検出 (通知系列を 1 本増やす) | 単体 |
| **T4** | 競合の通知 UI (3 段の出し分け) | 単体 + 実機 |
| **T5** | implicit merge に検出器を持ち込む (未決 ③ を決める) | 単体 + 実 PDS (2 アカウント) |
| **T6** | fork を書く + 理由を凍結する | 単体 + 実 PDS |
| **T7** | 器: branch / commit / merge の op-log 昇格と同期 (未決 ① を決める) | 単体 + 実 PDS |

**T0 が最初なのは順序の問題ではなく正しさの問題である** — カスケードの規則が 2 箇所に
分かれたまま T1 を入れると、「projection では消えるのに検出されない」が固定される。

**T7 は独立に大きい。**T0-T6 で競合と fork が閉じるので、器はそこで切って別 PR にできる。

## Exit

1. content / structure / layout が仕様の 3 段どおりに扱い分けられる
2. 競合が起きてもグラフが消えない (add-wins)
3. グループを消したときに、子への依存が削除依存として検出される
4. implicit merge が競合で fork し、**理由つきで**通知される
5. fork が同期のたびに復活しない

1・4・5 は実 PDS の 2 アカウントで確かめる。

## 未決のまま持ち越すもの

- **通知の畳み方** (§5 の ⚠️)。layout の並行変更は日常的なので、出し方を誤ると埋もれる
- **DtR の起動**は Phase 6。ここでは「手動で起動できる口」までを作る
