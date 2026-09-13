# branchFold のテスト仕様

## 何を

trunk の op-log にある `branch.create` / `branch.setStatus` / `commit.add` から、branch
(fork を含む) の一覧とコミットを畳み込む `foldBranches` を見る。

## なぜ

T7 は branch のメタを daemon の SQLite から trunk の op-log へ移す (設計
`step2-phase3-t7-branch-sync.md`)。**誰の手元でも同じ一覧が出る**ことがこの移動の目的
なので、主題は「入力の並び・重複・複数の参加者による独立な書き込みに結果が左右されない」
ことである。

もう一つの主題は **fork の同一性**である。T6 の fork は保存の時点で `conflictKey` と
`origin` を失っていた (設計 事実 G)。ここではそれを op に載せて畳むので、
**同じ競合の fork が参加者の数だけ並ばない**ことを固定する。

## どのように

### branch

- **作成直後は open**: `branch.create` は status を持たない。作られた branch は開いている。
- **同じ id の `branch.create` は最初の 1 回だけ**: branch の実体 (名前・分岐点・専用 file_id) は
  作った時点で決まり、後から変える op は無い。
- **status は LWW、投入順に依存しない**: 並びをわざと崩して投入し、clock の大きい方が残ること。
- **居ない branch への `setStatus` は無視する**: branch を勝手に作らない。

### fork

- **`conflictKey` と正しい `origin` を持てば fork**: `isFork` が真になる。
- **同じ `conflictKey` の fork は 1 つに畳む**: 参加者が独立に同じ競合を検出し、それぞれ別の
  `BranchId` で書く状況を再現する (`spec/merging.md` の S4)。
- **別名に対する `setStatus` も正の fork に効く**: 後から来た fork の id は別名として覚える。
  bob が自分の書いた fork を閉じても、畳んだ結果の 1 つの fork が閉じなければ、
  人によって「閉じた / 開いている」が食い違う。
- **`origin` の中の op が不正なら記述だけ落とす**: 他の参加者が書いたログを信用しない。
  **同一性では畳む** (重複は防ぐ) が、**理由の無い fork を理由付きのように見せない**
  (`isFork` は偽)。先に来たのが壊れた方でも、後から正しい方が来ても、正は先に来た方である —
  正を入れ替えると並びに依存してしまう。

### commit

- **`branchId` の有無で trunk / branch に振り分ける**。
- **同じ commit は 1 回に数える**: 複数の経路 (自分の書き込みと相手からの受信) で届きうる。

## 性質 (fast-check)

- **並びを入れ替えても結果は変わらない**: 順序は `orderBatches` (clock → actor → id) だけで
  決まり、入力の並びをどこでも使っていないこと。
- **同じ batch が 2 回届いても変わらない (冪等)**: 受信は同じ batch を何度も持ってくる。
- **同じ `conflictKey` の fork は常に高々 1 つ**: 上の例を一般命題にしたもの。

### 生成器

**小さなプールから引く。**branch の id は 2 つ、`conflictKey` は 2 つと「無し」、clock は
1〜4、actor は 2 人、batch の id は 6 つ。広く引くと衝突が起きず、「同じ id の create」
「同じ `conflictKey` の fork」「同じ clock での並び (actor と id による決着)」という、
この畳み込みが決めている境界を一度も通らない。

**ただし log の中で batch の id は一意にする。**同じ id で中身の違う batch は実在しない
(保存が `UNIQUE(file_id, batch_id)`)。当初はそれも許して「その方が厳しい」としていたが
誤りだった — (clock, actor, id) が完全に同点になり、入力の並びが結果に出るのは畳み込みの
不具合ではなく入力の不正である。

## 性質テストが見つけた不具合

**冪等性が破れていた。**1 つの batch の中で `setStatus` が `create` より前にあると、1 回目は
「まだ居ない branch」として無視されるが、同じ batch を 2 回渡すと 2 回目には居る branch に
効いてしまう。受信は同じ batch を何度も持ってくるので、実際に起こりうる。
**畳み込みの中で batch を id で重複除去**し、batch の集合の関数にして直した。この反例は
「同じ batch が再び届く」の例のテストとして残してある (乱数が毎回そこを引く保証は無い)。
