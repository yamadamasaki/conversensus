# mergeBranch テスト仕様

## 何を

`mergeBranch.ts` (step1 Phase 5 p5-3 / step3 Phase 1 S1-4) をテストする。branch を trunk へ
merge する調整層。merge を「branch の batch の**写し**を trunk 先端の後へ追記する」操作として
表現する (設計 §3.3-(i))。**写しは merge した人自身の batch** で、新しい id と merge した人の
点 (clock・seq・deps) を持ち、`copyOf` で元の batch の点を指す (step3 Phase 1 D2)。

`branchProjection.ts` と同じく純関数 (I/O は deps 経由)。hook 載せ替えは p5-4。

## なぜ

merge は**書き込みを伴う唯一の branch 操作**で、失敗すると trunk のログが壊れる。
壊れ方が「静かに二重適用」「静かに片方が消える」なので、次の 3 点を単体で固定する。

### 1. 追記対象は branch batches だけ (二重適用の防止)

`mergeBranches` が返す `merged` は `[...trunkAfterBase, ...branchBatches]` だが、
**`trunkAfterBase` は既に trunk op-log にある**。設計の「結果 batch を trunk へ追記」を
字面どおり実装すると `trunkAfterBase` が二重に入る。`mergeBranches` は**対立検出のために呼ぶ**。

### 2. `copyOf` の集合がべき等性そのもの

同じ branch を 2 回 merge しても、trunk に既にある写しの `copyOf` が「写し済みの元」の集合に
なっているので、2 回目は何も写さない。branch の status フラグに頼ると、フラグ更新に失敗した
瞬間に二重適用する。

step2 までは写しが**元と同じ id**を持ち、`appendBatch` のべき等性でこれを得ていた。しかし
それは「書いた人の名前で merge した人が clock を振る」ことでもあり、因果の点の前提
(actor の番号を振るのはその actor だけ) を崩すので、step3 Phase 1 で写しを merge した人自身の
batch に改めた。

2 人が並行に同じ branch を merge すると、同じ元を指す写しが 2 組できる。どちらを採るかは
畳み込み (`orderBatches`) が全順序で決める (`shared/src/events/project.test.md`)。

### 3. branch が trunk の上に乗る (LWW の勝敗)

写しの clock が trunk 後発編集より大きくなるため、projection の
畳み込みで **branch の編集が勝つ**。git の rebase に近い意味論で、これは設計の意図だが
「trunk 側の後の編集が消えたように見える」挙動でもあるので、テストで明示的に固定する。

## どのように

トランク: 分岐点まで (clock 1-2) + 分岐後の trunk 編集 (clock 3, `n1` を書き換え)。
ブランチ: 分岐後の branch 編集 (clock 3-4, `n1` を書き換え + `n2` を追加)。
= **同じ `n1` を両側が触った並行変更**を含む構成。base は clock 2。

フェイクストアの `appendBatches` は実際の `EventStore` と同じく **batch id でべき等**
(既存 id は無視して件数に数えない)。発番器は実物の `CausalClock` を使う。

### 写しの追記

- **trunk 先端の後へ載る**: 発番器を trunk (先端 clock 3) と branch (先端 clock 4) の両方に
  追随させるので、写しは 5, 6 に載る。branch を見てから書いた写しなので、branch の元より後に
  振られるのが Lamport の受信規則である
- **元の相対順序が保たれる** (br1 → br2 の `copyOf`)。branch 内部の順序は意味を持つ。
- **写しは新しい id を持ち、branch 側の元はそのまま残る** (clock 3, 4 のまま)
- **timestamp は編集が起きた時刻のまま**。順序付けは `clock → actor → id` (4d-3) なので
  timestamp を書き換える理由が無く、表示の真実性が下がる。
- **`trunkAfterBase` は追記しない**: merge 後の trunk が 3 + 2 件で、`t3` が 1 件のまま
  (写されて二重に入っていない)。観点 1 の直接の証拠。
- **自端末 clock が trunk 先端より進んでいれば下げない**: 復元は下限を上げるだけ。
  下げると既存 batch と clock が重なり LWW の勝敗が id 順で決まってしまう。
  (遅れているケースは他のテストが既定で通っている: 初期値 0 < 先端 3。)

### 先読み (`previewMerge`, Phase 3 T1)

merge は不可逆である — branch の batch の写しは trunk op-log へ追記され、
**revert の経路が無い** (branch が MERGED になるだけ)。人が押す操作の前に何が起きるかを
見せるため、検出だけを行う入口を割り出した。

- **🔴 op-log を一切変えない**: trunk / branch のログ、branch メタ、commits のどれも
  動かない。**適用しないことがこの関数の存在理由**なので、conflicts が返ることより先に
  ここを固定する。deps の型 (`MergePreviewDeps`) も読み取りだけに絞ってある。
- **適用したときと同じ対立を返す**: 先読みと適用が別の答えを出すなら見せる意味が無い。
  同じ計画づくり (`buildMergePlan`) を通していることの裏取り。
- **trunk へ新しく載る件数**: 再 merge では 0 になる (べき等性が先読みからも見える)。
- **🔴 グループを消した trunk と、子を編集した branch の対立を拾う**: T1 のシグネチャ変更の
  主眼。分岐点のグラフを渡していないと 0 件になる。

**先読みは助言であって保証ではない。**先読みと適用の間に trunk は動きうるので、
適用側は読み直して計画を組み直す。ここで 0 件でも適用時に対立が出ることはある。
だから「先読みの結果を持ち回って適用する」形にはしていない — 古い計画を適用するより、
組み直して適用するほうが安全である。

### projection と対立

- **merge 後の trunk projection が branch の編集を含む** (`n1`, `n2`)。
- **🔴 branch の編集が trunk の後発編集に勝つ** — `n1` は「branch による編集」。観点 3。
- **並行 content 変更を `MergeConflict` として検出**: target=`n1`、ours=trunk 側 (`t3`)、
  theirs=branch 側 (`br1`)。検出のみで解決は projection に委ねる (可視化は後続 phase)。
- **対立が無ければ空**: 別ノードを触っただけなら conflicts は `[]`。
- **branch の status を merged にする**。

### べき等 (再 merge)

- **2 回目は `appended` 0 で trunk のログも projection も不変**。観点 2 の核心。
- **既に merge 済みの batch を対立として数え直さない** — 載せるものが無ければ新たな
  対立も無い (自分自身との突き合わせを作らない)。
- **merge 後に branch へ足した編集だけが次の merge で載る** (`br3` のみ、`appended` 1)。
  「べき等 = 何も起きない」ではなく「差分だけ進む」ことを固定する。
- **branch 側に編集が無ければ追記せず status だけ更新する** (空 branch の merge)。

### merge の記録 (ANA-122)

以前は branch の status が MERGED になるだけで、「いつ・誰が・何のために merge したか」が
どこにも残らなかった。merge を commit と同じ「ラベル付きオフセット」として記録する。

- **trunk 側の commits に `kind=merge` として残る** — 理由 (message) と実行者 (actor) を
  持ち、**branch 側の commits には書かない** (merge は trunk の履歴に属する)。
- **🔴 `at` は追記後の trunk 先端、`sourceAt` は branch op-log の先端**を指す。両者は
  別系列の clock なので、片方だけでは merge 位置を復元できない。
- **追記が 0 件でも記録は残る** — 「merge した」という事実は追記の有無と独立に起きている。
- **再 merge でも記録は 1 件ずつ増える**。batch の追記はべき等だが、記録は操作の履歴である。

### merge 時点をログから引く (ANA-119 S6)

`lastMergeSourceAt` / `countCommitsAfter` は merge 記録の**読み手**である。merge 済み
branch を開き直したときの差分の起点をここから導く。以前はセッション内の ref に
merge 済みコミット数を積んでいたので、**アプリを開き直すと起点が元の分岐点に戻り、
merge 済みの内容まで差分に出ていた**。

`lastMergeSourceAt`:

- **一度も merge していなければ undefined**。呼び出し側はこれを「分岐点」として扱う。
- **🔴 返すのは `at` ではなく `sourceAt`**。`at` は trunk 側の位置なので branch op-log の
  切り出しには使えない。テストでは両者を別の値 (at=9 / sourceAt=4) にして取り違えを検出する。
- **他の branch の merge は見ない** — trunk の commits には全 branch の merge が並ぶ。
- **2 回以上 merge していれば最大の `sourceAt`**。配列順に依存しないよう、テストでは
  新しい記録を先に置く。
- **`sourceAt` を持たない古い merge 行は無視する** (S4 以前に書かれた行を想定)。
  持たない行を「0 まで merge した」と読むと、全編集が未 merge 側に倒れて安全側になる。
- **`sourceAt` が 0 (空の branch を merge) は undefined と区別する**。`0` は偽値なので、
  素朴に `??` や truthy 判定で書くと未 merge に化ける。

`countCommitsAfter`: 「前回 merge 以降に commit があるか」= 次の merge の対象があるか。
基準が無ければ全件 (未 merge)、merge 直後は 0 (= 差分状態が「無変更」になる)。

### 写しは merge した人自身の batch (step3 Phase 1 D2)

書いた人と違う人が merge する形 (bob が alice の branch を merge) で固定する — 同じ人の merge
では書いた人と merge した人が一致し、取り違えがテストに出ない。

- 写しの `actor` は **merge した人**、seq は merge した人の連番 (1, 2)
- `copyOf` は元の点 (書いた人の actor と seq) を指す
- `mergedIn` はこの merge で記録した merge コミットの id と一致する。**merge コミットの id を
  写しより先に採番する**のはこのため
- 写しの `deps` は branch の元の点を含む — 写しは元を見てから書かれた
- **写しの写しは、いちばん元の点を指す**。branch に写しが載っていた場合 (branch の上で別の
  branch を merge した等) も、同じ編集の写しが同じ元を指すので、重複の判定がずれない

