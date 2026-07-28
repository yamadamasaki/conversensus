# mergeBranch テスト仕様

## 何を

`mergeBranch.ts` (step1 Phase 5 p5-3) をテストする。branch を trunk へ merge する調整層。
旧 `mergeBranchToTrunk` の**レコード書替**を置換し、merge を「branch batches を trunk
先端の後へ再スタンプして trunk op-log へ追記する」操作として表現する (設計 §3.3-(i))。

`branchProjection.ts` と同じく純関数 (I/O は deps 経由)。hook 載せ替えは p5-4。

## なぜ

merge は**書き込みを伴う唯一の branch 操作**で、失敗すると trunk のログが壊れる。
壊れ方が「静かに二重適用」「静かに片方が消える」なので、次の 3 点を単体で固定する。

### 1. 追記対象は branch batches だけ (二重適用の防止)

`mergeBranches` が返す `merged` は `[...trunkAfterBase, ...branchBatches]` だが、
**`trunkAfterBase` は既に trunk op-log にある**。設計の「結果 batch を trunk へ追記」を
字面どおり実装すると、id を保てば `UNIQUE(file_id, batch_id)` で無視されて再スタンプが
効かず、id を振り直せば二重適用になる。`mergeBranches` は**対立検出のために呼ぶ**。

### 2. id 保持がべき等性そのもの

clock は再スタンプするが **batch の id は保持する**。同じ branch を 2 回 merge しても、
既に merge 済みの batch は同じ id で trunk に居るので `appendBatch` のべき等性で無視される。
新規採番すると branch の status フラグに頼ることになり、フラグ更新に失敗した瞬間に
二重適用する。単一端末スコープでは remote の rkey 衝突懸念が消えている (§9.2) ので、
保持を妨げる理由が無い。

### 3. branch が trunk の上に乗る (LWW の勝敗)

再スタンプにより branch の clock が trunk 後発編集より大きくなるため、projection の
畳み込みで **branch の編集が勝つ**。git の rebase に近い意味論で、これは設計の意図だが
「trunk 側の後の編集が消えたように見える」挙動でもあるので、テストで明示的に固定する。

## どのように

トランク: 分岐点まで (clock 1-2) + 分岐後の trunk 編集 (clock 3, `n1` を書き換え)。
ブランチ: 分岐後の branch 編集 (clock 3-4, `n1` を書き換え + `n2` を追加)。
= **同じ `n1` を両側が触った並行変更**を含む構成。base は clock 2。

フェイクストアの `appendBatches` は実際の `EventStore` と同じく **batch id でべき等**
(既存 id は無視して件数に数えない)。clock は実物の `LamportClock` を使う。

### 追記と再スタンプ

- **trunk 先端の後へ再スタンプ**: 先端 clock 3 → 4, 5 に載る。`seed` の意味論
  (`+1` しない) なのでちょうど「先端の次」から始まる。
- **元の相対順序が保たれる** (br1 → br2)。branch 内部の順序は意味を持つ。
- **id は保持**。branch op-log 側は元の clock (3, 4) のまま残る — file_id が違うので
  `UNIQUE(file_id, batch_id)` と両立する。
- **timestamp は編集が起きた時刻のまま**。順序付けは `clock → actor → id` (4d-3) なので
  timestamp を書き換える理由が無く、表示の真実性が下がる。
- **`trunkAfterBase` は追記しない**: merge 後の trunk が 3 + 2 件で、`t3` が 1 件のまま
  (再スタンプされて二重に入っていない)。観点 1 の直接の証拠。
- **自端末 clock が trunk 先端より進んでいれば下げない**: `seed` は下限を上げるだけ。
  下げると既存 batch と clock が重なり LWW の勝敗が id 順で決まってしまう。
  (遅れているケースは他のテストが既定で通っている: 初期値 0 < 先端 3。)

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
