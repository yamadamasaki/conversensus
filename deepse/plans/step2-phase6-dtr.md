# step2 Phase 6: DtR graph

親: [step2-implementation](./step2-implementation.md) §3 Phase 6 /
仕様: [dialogueToResolveGraph](../requirements/spec/dialogueToResolveGraph.md)・[merging](../requirements/spec/merging.md) /
前提: [phase3-conflict](./step2-phase3-conflict.md)・[phase3-t7-branch-sync](./step2-phase3-t7-branch-sync.md)

## 1. なぜやるか

**完了基準 2 の唯一の担い手である。**

> 2. 一方が branch を切って merge し、競合したときに DtR graph が起動し、双方の承認で再 merge される

1 と 3 は Phase 2 で揃った。Phase 3 が器 (競合の検出・3 段の扱い分け・fork・branch/merge の同期) を
作ったので、ここに残るのは **DtR の中身**である。

## 2. コードで固めた事実

計画には無いが、着手前にコードを読んで分かったこと。**どれも設計の形を変える。**

### 事実 A: DtR の sheet は、何もしなければ普通のタブとして並ぶ

`projectFile` は `sheet.create` を持つ sheet を**すべて** `GraphFile.sheets` に出し、サイドバーは
それを素直に描く。`activeSheetId` の既定は `sheets[0]` である。DtR のグラフ本体を新しい
sheet scope に置く (U6 で確定) と、**除外しない限り通常のシートとして並ぶ**。

`foldBranches` の結果 (`BranchMeta.sheetId`) から DtR が指す sheetId を引けるので、
**除外の材料は既にある**。

### 事実 B: 判断ログに DtR の op を足すと、古い版は batch ごと捨てる

`recordToJudgmentBatch` は **op が 1 つでも語彙に合わなければ `null`** を返す (判断は複数 op の
原子性を前提にしているため、一部だけ通さない)。そして一括依頼は **1 batch に複数の
`participation.invite` を入れる** (`useParticipation` の `invite`)。

→ **DtR の op を名簿の op と同じ batch に混ぜてはならない。**混ぜると、DtR を知らない版の
手元では**名簿の更新ごと失われる**。

一方 `foldParticipation` の `switch` には `default` が無く、**知らない `kind` は黙って素通りする**
(`reject` は各 case の中でしか呼ばれない)。したがって DtR の op が同じ collection にあっても
**名簿の「捨てた op」には入らず**、Phase 1 で直した警告 (「名簿に反映できなかった判断がある」) が
誤って出ることはない。

### 事実 C: U7 の「7 種類」は、既存の 3 カテゴリの上に乗る

U7 は resolve graph が扱う競合を 7 種類と数え、うち 2 つ (**edge の接続先**、**グループの所属関係**) を
「conversensus 側で解決したが、ユーザの意図に合わない可能性があるもの」として別枠に置いていた。

実装を見ると、`isParallelStructureOp` は **`node.setParent` と `edge.reconnect` を含む**。
`OP_CATEGORY` でも両方 `structure` である。つまりこの 2 つは**すでに structure の並行変更として
検出されている**。resolve graph は新しい分類を作らず、**既存の 3 カテゴリ (content / structure /
layout) をそのまま使える**。

### 事実 D: merge の cancel は、今の器では表せない

- `BRANCH_STATUS` は `creating` / `open` / `merged` / `closed`。**`creating` は定義だけで参照が
  1 件も無い** (未使用の枠)
- `statusChanged` の呼び出しは close と merge だけで、**merged から戻す経路が無い**
- Phase 3 の決定 ②: 「trunk op-log への追記に **revert の経路は無い**」

→ 仕様の「原因となった merge をキャンセルし、merge 前の最後の commit の状態に戻る」は、
**打ち消しの op を新たに決めない限り実装できない。**

### 事実 E: fork からの起動は、凍結された記述だけが頼り

explicit merge は `previewMerge` で競合を**取り直せる**。implicit merge の側は取り直せない —
畳み直すと「今の競合」になり、そもそも競合が消えていることがある (`merging.md`)。
`ForkOrigin` は両側の `op` / `actor` / `clock` と `baseAt` を凍結して持ち、畳み込みが
`OpSchema` にかけて復元する (合わなければ記述だけ落とす)。**resolve graph の材料は
ここから作る。**

### 事実 F: 意味論の op が、器の op と同じカテゴリに同居している

`OP_CATEGORY` は op を 5 つに分ける (structure / content / layout / presentation / **file**)。
この `file` に **`sheet.*` / `file.*` (器) と `branch.*` / `commit.add` (意味論) が同居**している。
T7 で私が書いたコメントがそれを言っている。

> branch / commit のメタ (T7)。file 構造と同じく**グラフの畳み込みから外す**

つまり意味論の op は「**LPG ではない**」という否定形でしか分類されていない。否定形では
「シートという器」と「バージョン管理という意味論」が同じに見える。

**畳み込みは既に分かれている** — `foldFileStructure` の `switch` は `sheet.*` / `file.*` しか
持たず、`branch.*` は `foldBranches` が拾う。**実装はレイヤを知っているのに、型と分類が
それを言っていない。**

分割の代償は小さいことも確かめた。`EVENT_CATEGORIES` の消費者は `Category` 型だけで、
**op のカテゴリは永続化されていない** (op-log に載るのは `kind` であってカテゴリではない)。
`isFileOp` の呼び出し元は 3 箇所 (`projectBatches` / `foldFileStructure` / `applicability`)。

### 事実 G: U6-P1 が branch 案を退けた根拠は失効している (2026-09-19, D3 の着手時に判明)

U6-P1 は「DtR の器は trunk の fileId 内の新しい sheetId でよい」を Go とし、あわせて
こう書いている。

> **旧案 (DtR graph を branch として書いて読み戻す) を実装してはならない**という判断
> (事実 5: **branch batches は remote へ出ない**ので local で完結して通ってしまう)

**この根拠は T7-2 で覆った。**`branchLog.ts` 自身がそう記している — 「step1 では local 専用
だった (§9.2) が、**step2 Phase 3 T7-2 で remote へ push する**ようになった」。

器を sheet にした判定 (①他 actor から読める ②既存 projection が壊れない ③File が増えない)
は**そのまま有効**である。失効したのは**branch 案を退けた部分だけ**である。

**これが D3 に効く。**再 merge の機構 (`buildMergePlan`) は `BranchMeta` を要求し、
**2 本の op-log** (`trunkFileId` と `branchFileId`) の batch id を突き合わせて差分を取る。
**sheet はこの機構に渡せない。**したがって D3 は次のどちらかになる。

- **解決グラフを branch にする** — 再 merge は既存の merge をそのまま使える。
  dialogue graph は sheet のままでよい (対話は器を要るが merge の対象ではない)。
  仕様の「DtR graph は Sheet の branch と**同じレベルで**サイドバーに表示される」とも揃う
- **sheet のまま、「別 sheet の内容を元の sheet へ取り込む」機構を新しく作る** —
  merge 機構の拡張になる

### 仕様の未実装条件: 「その後の変更がなければ」

> 呼び出された actor 全員が承認したら (**そして, その後の変更がなければ**), 再 merge が可能になる

D2 の `canRemergeAt` は `satisfiedAt < clock` しか見ておらず、この括弧を満たしていない。
判定材料が判断ログの**外** (DtR グラフの内容が最後に動いた位置) にあるためである。**D3 で補う。**

## 3. 中心の判断: 機構と見せ方を分ける

**利用者の判断 (2026-09-18)。**

> step 2 のここまでの段階で, branch/commit/merge, {explicit,implicit}-merge, それらの競合の解消は
> 普通の人にとっては複雑で, もう一度見直す (少なくとも UX のレベルで) 必要がありそう

Phase 6 は **DtR という概念をさらに 2 つ (dialogue graph / resolve graph) 増やす Phase** であり、
この懸念が最も当たる場所である。そこで、

- **機構を先に作る。**起動・呼び出し対象の記録・承認の畳み込み・再 merge の pre 条件。
  これは見せ方をどう変えても要る
- **見せ方は骨だけにする。**「差し替える前提」と明記して作る。計画も「UI の量が多い」と
  書いており、作り込んでから見直すと捨てる量が大きい

**見直しの実物を先に用意する**という順序でもある。今回の T7 で「同じ競合が画面の 3 か所に出る」
ことが実機で初めて見えたように、見せ方の判断材料は動くものからしか出てこない。

## 4. 決めたこと

1. **merge の cancel は先送りする** (利用者決定 2026-09-18)。**いまは merge をやり切るしかない。**
   - **完了基準 2 に cancel は要らない** (起動・承認・再 merge が揃えば Exit に届く)
   - **止める手段は入口にある。**Phase 3 の決定 ②「事前検査 + 人の確認」。押さなければ branch は
     open のまま。仕様の cancel は「押した**後で**戻す」もので、revert を要求する
   - **追記のみという全体の筋と整合する。**revert は器に関わる決定なので、vector clock
     (step3 の優先事項) と同じく**器を見直すときに一緒に扱う**
2. **⚠️ 「保留」の意味を読み替える。**仕様は
   > 保留の間, trunk には merge されない. branch はそのまま生き続ける

   と書くが、これは **merge がまだ適用されていない前提**であり、Phase 3 の決定 ② と噛み合わない。
   実際には **merge は押した時点で適用される**ので、保留は
   **「trunk には既に入っているが、決着していない」**状態になる。
   利用者から見た意味が違う (「待つ間は安全」ではなく「入った後で話している」)。
   **§5.5 の形で仕様に戻す論点とする。**
3. **承認は判断ログ、グラフ本体は trunk の fileId 内の sheet scope** (U6 で確定済)。
   fileId を新しく切らない (`discoverRemoteFiles` が File として materialize する)
4. **DtR の op は名簿の op と同じ batch に書かない** (事実 B)
5. **DtR の sheet は File のタブに出さない** (事実 A)。除外の基準は「DtR が指す sheetId」
6. **resolve graph は既存の 3 カテゴリの上に作る** (事実 C)。新しい分類を作らない
7. **呼び出し対象は起動時に確定して記録する。**再 merge は pre 条件つきの操作にし、判定は
   名簿への生きた問い合わせではなく**記録された集合**に対して行う (仕様「承認の判定」)
8. **基本語彙 (LPG) / 器 / 意味論の 3 層を、型と分類で表す** (利用者の指摘 2026-09-18)。

   > conversensus の本質は LPG なので, 基本語彙はそれに関するものだけであるのが美しい。
   > その上に branch とか fork とか DtR をきれいに表現できるとよい。意味論のレベルでは,
   > これからも拡張や変更があるかも知れないし, **それらの間は整合性がないこともあるかも
   > 知れない** (…) それは拡張語彙で少しレイヤが異なるということが, **コード上表現されて
   > いると嬉しい**

   | 層 | op | 畳み込み |
   | --- | --- | --- |
   | **基本 (LPG)** | `node.*` / `edge.*` | `projectBatches` |
   | **器** | `sheet.*` / `file.*` | `foldFileStructure` |
   | **意味論 (拡張)** | `branch.*` / `commit.add` | `foldBranches` |

   **値は変えない** — ログに載るのは `kind` であってカテゴリではないので、既存の op-log と
   完全に互換である (事実 F)。**新しい語彙は意味論の層にだけ足し、基本語彙は触らない。**

   **⚠️ この 3 層は `OpSchema` (グラフの op-log) の中の話である。**判断ログは
   **その外側の別の collection** であり、層ではなく collection で分かれている。したがって
   `dtr.*` はこの表には載らない (当初ここに書いていたのは誤りだった → V5)。

9. **merge は写しのまま (案 A) を維持する** (利用者決定 2026-09-19)。

   T7-4 の §6a が登録した「**B へ移る合図**」— *「merge を取り消す / 承認されるまで効かせない
   (DtR の「双方の承認で再 merge」)」* — が **D3 で発火した**。§6a は「遅くとも Phase 6 の
   設計で判断する」と定めていたので、ここがその時点である。

   **判断: A のまま進める。**pre 条件は「写しを書かない」ではなく「**書いた写しを projection の
   手前で落とす**」で表せる (U6-P2 spike の `admissible`)。`Commit` に `dtrId` を足し、
   写しが既に持つ `mergedIn: CommitId` から辿る — これは §6a が **B へ移るために**用意した
   印そのものなので、移行の妨げにならず、むしろその経路を先に使うことになる。

   | | 触る | 触らない |
   | --- | --- | --- |
   | A (採用) | `CommitSchema` / `branchLog.Commit` / `makeMergeCommit` / 各 projection 経路 | `BatchSchema` / lexicon / `batchMapper` / SQLite |
   | B (見送り) | trunk を読む**全経路** (projection・競合検出・上書きの報告・先読み・受信・server) | — |

   **⚠️ 調査で出た、A の見積もりを押し上げる事実**: 絞り込みを挿せる**単一の関所が無い**。
   trunk を projection する経路は `useFileSheetOperations` (2) / `conflicts.ts` /
   `overwrites.ts` / `mergeBranch.ts` (2) / server の `eventStore.ts` (2) に散っている。
   規則が散ると T0 で踏んだ「**写しは放っておくとずれる**」に近い形になるので、
   **適用点を 1 箇所に畳む工夫が D3 の設計の中心**になる。

   ### 適用点の決着 (2026-09-19, 調査の結果)

   **「7 箇所」は粗い見立てだった。**絞り込むべきは**表示の projection だけ**で、
   実際には **trunk 表示の 2 箇所** (`useFileSheetOperations` の `swapProjection` と
   `loadFile`) に収まる。

   | 経路 | 絞り込む? | なぜ |
   | --- | --- | --- |
   | trunk 表示 (`projectFile` ×2) | **する** | ここが人の見る画面である |
   | branch 表示 (`readBranchSheets` → `branchSheet`) | **不要** | trunk を分岐点までしか載せない (`clock <= base.at`)。承認前の再 merge の写しは分岐点より後なので**そもそも入らない** |
   | `conflicts` / `overwrites` / `mergeBranch` | **しない** | 解析の経路。**生のログが要る** |
   | server の `projectSheet` / 一覧 | **しない** | `projectSheet` は呼び出し元 0 件 (死んだコード)、一覧は名前引きのみ。**server に判断ログは無い** |

   **⚠️ 取得口 (`fetchBatches`) に置く案は否決した。**当初の第一候補だったが、実害が 2 つある。

   1. **`buildMergePlan` が同じ口を使う。**そこで落とすと `trunkIds` (べき等性の判定集合)
      から承認前の写しが消え、**2 回目の merge が同じ写しを再追記する**。T7 の
      「id を保つのは再 merge のべき等性のため」が崩れる
   2. **tap の `fetchLocal` が同じ口。**そこで落とすと `readBranchMeta` の畳み込みからも
      消え、**DtR 自身の merge コミットが branch/commit の記録から見えなくなる**

   **落とすのは読みであって書きではない** — op-log は追記のみという全体の筋のとおり。

   ### 判断ログの供給経路

   同期サイクルは毎回名簿を読み、畳んだ `Participation` を `onRoster` で上へ渡している。
   **その場に生の判断 batch (`seen.batches`) もある**ので、`foldDtr` までを tap の中で
   済ませ、**結果**を渡す (`participation` を結果として渡しているのと対称。生のログを
   フックに漏らさない)。受け手は `projectedForeignRef` らと同じく **ref** で持つ —
   表示の projection は安定参照を要求する `useCallback` の中なので、state にすると
   callback が張り直される。

   **~~未決 V7~~ 決着 (2026-09-19): 分からないときは通す (fail-open)。**`loadFile` は
   同期サイクルより前に走りうるし、未ログイン・オフラインでは判断ログが**正当に見えて
   いない**。そこで落とすと **merge 済みの内容が画面から消える**方の失敗になる。
   仕様が「本人の手元でも捨てられる」と言うのは **DtR が見えていて未承認**の場合であって、
   データが無い場合とは別である。読めない判断データを黙って落として縮退するのは
   `templatesOf` (知らない template id を落とす) や名簿の「読めた範囲で作る」と同じ筋。

   ### 仕様の 2 つの条件は、効かせる場所が違う

   > 呼び出された actor 全員が承認したら (**そして, その後の変更がなければ**),
   > 再 merge が可能になる

   | 条件 | 効かせる場所 | 根拠 |
   | --- | --- | --- |
   | 承認が**この操作より前に**記録されている | **畳み込みの手前** (表示の projection) | 仕様が「満たさない再 merge は**畳み込みの段階で捨てられる**」「早まった再 merge を出しても**それを出した本人の手元でも捨てられる**」と明記している |
   | **その後の変更がなければ** | **書く側の関門** (再 merge を組み立てる前) | 仕様はこれを「再 merge が**可能になる**条件」として書いており、捨てる pre 条件としては書いていない。判定に**解決 branch の op-log の先端**が要るので、表示のたびに別のログを読むことになり筋が悪い |

   **分ける理由は「誰の手元でも同じ結論になるか」の要否である。**承認の条件は端末をまたいで
   一致しなければならない (再 merge は trunk を書き換える) が、「その後の変更」は書く本人の
   手元で見えていれば足りる — 変更があったのに書いてしまっても、**承認の条件は依然として
   畳み込みが判定する**ので、勝手に trunk が書き換わることはない。

10. **resolve graph は branch、dialogue graph は sheet** (利用者決定 2026-09-19)。

    事実 G のとおり、U6-P1 が branch 案を退けた根拠 (branch batches が remote に出ない) は
    T7-2 で失効した。**2 つのグラフは役割が違うので器も分ける。**

    | | 器 | なぜ |
    | --- | --- | --- |
    | **dialogue graph** (対話) | trunk の fileId 内の **sheet** | 対話は器を要るが **merge の対象ではない**。U6-P1 の判定 (①②③) がそのまま効く |
    | **resolve graph** (解決) | **branch** | 「実際に競合しているグラフを可視化し、**競合を解消するために編集できる**」= trunk の編集可能な作業複製そのもの。再 merge は `mergeBranchOnOplog` をそのまま使える |

    **新しい merge 機構を作らない**のが決め手である。`buildMergePlan` は `BranchMeta` と
    2 本の op-log を要求するので、sheet のままだと分岐点・べき等性・再スタンプを
    **全部作り直す**ことになる。仕様の「DtR graph は Sheet の branch と**同じレベルで**
    サイドバーに表示される」「利用者からは**特殊な branch のように感じられる**かもしれない」
    とも揃う。

    **D1 の記録の形を直す** — `dtr.open` に `resolveBranchId` を足す。`branchId` (この DtR を
    必要にした原因) と**別物**なので、名前で取り違えないようにする。**レコードはまだ
    1 件も書かれていない**ので、いま直せば移行は要らない (D0 で `branchId` を足したときと
    同じ理由)。

## 5. 未決 — 設計の中で決める

| | 内容 |
| --- | --- |
| ~~**V1**~~ | **決着 (2026-09-18): 独立した `dtr.*` の op にする。**当初は「`branch.create` への相乗り」を推していたが、**争点の立て方が誤っていた** — 相乗り案も新設案も**どちらも拡張語彙の中の話**であり (`branch.*` は既に基本語彙ではない)、「基本語彙を汚さない」という原則では決まらない。決め手は 2 つ。(a) **意味論どうしは整合しなくてよい** (決めたこと 8) のに、相乗りは DtR を変えるたびに `branch.create` の形を触らせ、**整合性を強制する**。(b) 相乗りの利点と思った再利用は **op の種別を共有しなくても得られる** — 同期は判断ログの collection にそのまま乗り、畳み込みは既存の畳み込みと並べればよく、サイドバーに出すのは畳み込みの**結果**であって op の形ではない。**⚠️ 2026-09-18 訂正**: 当初ここに「同期は `FILE_OP_KINDS` (→ 意味論の層) に入れれば」と書いたが誤りだった。`dtr.*` が載るのは**判断ログ** (`JudgmentOpSchema`) で、グラフの `OpSchema` には入らない (→ V5) |
| **V2** | **resolve graph の見せ方** (U7 から引き継ぎ)。事実 C で分類は既存の 3 つに決まったので、残るのは「trunk の上に競合をどう重ねるか」と「すべての要素が編集可能」の担保 |
| **V3** | **dialogue graph に toulmin を当てるか。**`sheet.create` の `templateIds` で当てられる (Phase 5)。仕様は「template 機構が導入されたら、その一つの例として」と書く |
| **V4** | **保留の可視化。**「未決着の merge がある」を左サイドバーに出す。決定 2 の読み替え (既に trunk に入っている) を踏まえた言葉にする必要がある |
| ~~**V5**~~ | **決着 (2026-09-18): 判断ログの語彙として `dtr.*` を 3 つ置く。** 足し先は `JudgmentOpSchema` であって `OpSchema` ではない — `judgment.ts` の冒頭が既にそう書いている (「DtR の承認 (Phase 6) も同じ『検証して捨てる』畳み込みなので…**`dtr.*` の op はこの union に後から加わる**」)。L0 で整えた 3 層はグラフの op-log の中の分類で、**判断ログはその外側**である。仕様の 4 つのうち **op になるのは 3 つ**: `dtr.open` (起動 + 呼び出し対象の記録) / `dtr.setCallees` (対象の変更) / `dtr.approve` (承認)。**再 merge は判断 op ではない** — trunk を書き換える以上グラフの batch であり、pre 条件は畳み込みの**手前で落とす** (spike の `admissible`)。印は batch のメタに置く (T7 の `restampedBy` / `mergedIn` と同じ形) → D3。`dtr.setCallees` を入れるのは、**保留の出口だから**である — 仕様は「承認しない actor を呼び出し対象から外して先に進むこともできる」と書いており、これが無いと全員が承認するまで DtR に出口が無い |

## 6. スライス

**機構を先に、見せ方は骨だけ** (§3)。

| | 内容 | 検証 |
| --- | --- | --- |
| **L0** | **レイヤを型と分類で表す** (決めたこと 8)。`OpSchema` を 基本 / 器 / 意味論 の 3 つに組み替え、`OP_CATEGORY` の `file` を割る。**値は変えない**ので op-log は完全に互換。**DtR を載せる前に層を整える** — 積まれた後ほど動かしにくい。**完了** (2026-09-18)。変異試験で分かったこと: 分類を固定するだけでは**層の振る舞いは固定されない**。「意味論の op はシートのスコープに属さない」は `applicability` 側に置いた | 単体 |
| **D0** | 語彙と畳み込み (V5 で決着)。`dtr.*` を**判断ログの語彙に**足し、DtR の記録と承認の集合を畳む。畳み込みは `foldParticipation` と**同じ collection を別に畳む** — 互いの `kind` を素通りさせる (事実 B) | 単体 + 性質 |
| **D1** | explicit merge の content 競合からの**強制起動**。呼び出し対象の既定値 (共同作業者全員) を記録する。**完了** (2026-09-18)。線引きは `requiresConfirmation` と**共有しない** (あちらは content + structure、こちらは content だけ) / 起動は merge を**適用した後**で、材料は先読みではなく適用結果 / 器 (sheet) を先に、判断を後に書く (2 つのログに原子性が無いので、残りやすい側を先に) / **起動の失敗で merge を失敗と報告しない** (merge は既に trunk に載っている) / `dtr.open` に `branchId` を足した (仕様の「merge 操作に紐づく」「fork に紐づく」を 1 つで表す。レコードが 0 件のうちに形を決めた)。**2026-09-19 に追補**: 決めたこと 10 により、起動時に**解決グラフの器 (branch) も切る**ようになった。`dtr.open` に `resolveBranchId` が加わり、器は 2 つ (解決 = branch / 対話 = sheet)。解決 branch は**競合が起きたシート**から切る (branch は per-sheet なので、別シートから切ると解決の場が別物の複製になる) | 単体 |
| **D2** | **承認**と、再 merge の **pre 条件**。承認しないまま参加を取りやめた actor は自動的に外れる。**完了** (2026-09-19)。`foldDtr` が `Participation` を依存に取る (DtR → 名簿の一方向。`isLocalDid` と同じく省略可能にしない) / 決着は真偽値でなく**位置** `satisfiedAt` で持ち、**離脱も満了の引き金**になる (batch ごとに見る) / 外すのは「**観測できた離脱**」だけ — 名簿に一度も現れない DID は「見えていない」だけなので残す (外すと名簿の食い違いがそのまま判定の食い違いになる) / **全員が去った DtR は決着させない** (空集合を「全員承認」と読まない) / `canRemergeAt` は**同着を許さない** (「より前」の意味) | 単体 + 性質 |
| **D3** | **再 merge**。承認が揃ってから。再び競合したら繰り返す。**前半 (器) と中盤 (表示の門) は完了 (2026-09-19)**。① 解決グラフの器を branch にする (決めたこと 10) ② `Commit.dtrId` + `MergeBranchParams.dtrId` で「どの DtR の決着か」を刻む ③ `admissibleBatches` が承認を経ていない再 merge の写しを **projection の手前**で落とす ④ tap が判断ログから `foldDtr` し、ref 経由で trunk 表示 2 箇所に届ける。**残り: 再 merge の操作本体と、書く側の関門 (「その後の変更がなければ」)。** 配線のテストはその段で入れる — `useFileSheetOperations.test.ts` は `syncRecord` を差し替えて内部 tap を迂回しており `onRoster` が鳴らないので、門だけを先に固定すると偽物だらけのテストになる | 単体 |
| **D4** | **fork からの起動** (implicit)。既定の呼び出し対象は自分だけ。材料は凍結記述 (事実 E) | 単体 |
| **D5** | **見せ方の骨** (V2 / V4)。サイドバーに branch と同じレベルで出し、通常の branch と違うと分かる形。DtR の sheet はタブに出さない (事実 A) | 単体 + 実機 |
| **D6** | 2 アカウントの実 PDS で通しで確認 | 実 PDS |

## 7. Exit

**完了基準 2 が揃う。**

1. alice が branch を切って編集し、trunk と競合する状態で merge する
2. content の競合で **DtR が強制起動**し、呼び出し対象が記録される
3. bob の手元にも DtR が現れ、**双方が承認**する
4. **再 merge** が通り、承認が揃っていなければ pre 条件で捨てられる
5. DtR の sheet が **File のタブに並ばない**
6. 承認しないまま bob が参加を取りやめたら、**残りの全員で判定が進む**
