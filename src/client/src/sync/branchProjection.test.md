# branchProjection テスト仕様

## 何を

`branchProjection.ts` (step1 Phase 5 p5-2) をテストする。branch の**作成**
(`createBranchOnOplog`) と**読取** (`readBranchSheet`) を op-log 上で成立させる調整層で、
`receiveRemoteBatches` と同型の純関数 (I/O はすべて deps 経由・React 非依存)。

hook への載せ替えは p5-4 なので、ここでは配線の中身だけを単体で固める。

## なぜ

置換対象は `branchState.ts` の PDS レコード複製方式であり、**置換前後で branch の
見え方が変わらないこと**が Phase 5 の前提になる。次の 3 点が壊れると静かにデータが
食い違うため単体で固定する:

1. **複製をしないこと自体が正しさの中心**。旧 `createBranch` は trunk の
   node/edge/layout を `{branchId}_` prefix で 1 件ずつ PDS へ複製していた。op-log では
   **分岐点を指す base コミットを記録するだけ**で分岐時点を再現できる (`batchesUpTo`)。
   複製が残っていると、それが結果を肩代わりして「op-log で動いている」偽の確証を作る。
2. **trunk と branch の分離**。branch batches は branch 専用 file_id にしか無く、trunk の
   projection は branch 編集で動いてはならない (設計 §3.1-B)。
3. **旧経路との一致**。単一端末スコープなので `Commit.at` (scalar offset) がそのまま
   正しく、旧 `fetchBranchSheetFromPds` の結果と意味的に一致するはず — これを golden で
   固定する。

## どのように

### golden 比較の作り方

旧経路は PDS I/O なので単体では呼べない。代わりに**旧経路の意味論を golden として
書き下す**: 「`createBranch` が複製した作成時点の trunk」+「`fetchBranchSheetFromPds` が
読む branch 側の編集」= 期待する Sheet。これと op-log 経路の結果を突き合わせる。

**shape の差は正規化する**。`fetchBranchSheetFromPds` は layouts が空なら key ごと省くが、
`toSheet` は常に `[]` を置く。UI が許容する差 (trunk 側は W3d-2 で既にこの形) なので、
比較は意味内容 (id 順に正規化した nodes/edges/layouts) の指紋で行う。

### createBranchOnOplog

- **base はログ先端 (`tipClock`) を指す**。以後 trunk が伸びても base は動かない。
- **trunk の複製をせず、メタを 1 件保存するだけ**。trunk op-log が 1 件も増えないことを
  併せて確認する (複製の不在を件数で示す)。
- **branch 専用 file_id を採番し branch id / trunk file_id と別物にする**。単一端末なので
  決定論的 id は不要で、無関係な UUID でよい (§9.2)。

### readBranchSheet

- **🔴 golden 一致**: 分岐時点の trunk (n1, n2 + layout) に branch 編集 (n1 の書き換え、
  n3 の追加) を重ねた結果になる。trunk 側の後発編集 (n4) は現れない。
- **base より後の trunk 編集は branch に現れない** (`batchesUpTo` の切り出し)。
- **branch の編集は trunk の projection を変えない** — trunk 側の n1 は書き換わっておらず、
  trunk には n4 が居る。分離 (観点 2) の直接の証拠。
- **シートのメタは引数から与えられる**。branch op-log は `sheet.create` を持たない
  (持たせると branch がファイル一覧に現れる, p5-1) ので projection からは得られない。
  旧 `fetchBranchSheetFromPds` も sheet レコードは trunk のものを読んでいたので同義。
- **🔴 他シートの content は branch に現れない (多シートファイル)**: trunk op-log は
  ファイル全体 (全シート) のログだが、`branchSheet` → `projectBatches` は content op を
  sheetId で仕分けない (仕分けるのはファイル単位の `projectFile`)。絞らずに渡すと
  **他シートのノードが branch のシートに現れる**。旧経路は sheet 参照でフィルタして
  いたので、絞らないと golden と一致しない。**このテストは実装前に書いて実際に落ちた** —
  調整層で絞る必要があることの証拠であり、回帰の検出点。

### readBranchSheets (p5-4 で追加、S6 で 4 時点に)

hook は「現在 / 分岐点 / 直近コミット時点 / 最後の merge 時点」の 4 つを同時に要る
(画面 / — / 未コミット変更の判定 / merge 対象の差分)。旧経路はこれらを PDS スナップ
ショットの控えとして React state に抱えていたが、**op-log ではすべて同じログの切り出し**
なので保持しない。1 回の読取から導出することで、控えの持ち方に起因する食い違い自体を
無くす。

- **base は branch の編集を 1 件も含まない**: 分岐点そのもの。ここが汚れると
  diff ハイライトが「自分の編集を差分として認識しない」方向に壊れる。
- **atLastCommit はコミット位置までの branch 編集だけを含む**: `lastCommitAt` で切り、
  それより後 (未コミット) の編集は入らない。切り出し位置がずれると
  「コミット済みの変更が未コミットとして表示される」ことになる。
- **コミットが無ければ atLastCommit は base に等しい**: 初回コミット前の基準。
- **atLastMerge は merge 位置までの branch 編集だけを含む** (ANA-119 S6): 起点に
  分岐点を使うと、**既に merge 済みの変更まで「次の merge の対象」として出てしまう**。
  切り出し位置は merge コミットの `sourceAt` (branch op-log 側の clock) で与える。
- **未 merge なら atLastMerge は base に等しい**: 呼び出し側が「merge 済みか」で
  場合分けせずに済むようにするための性質。
- **atLastCommit と atLastMerge は別々の位置で切り出せる**: 未コミット変更の基準と
  merge 対象の基準は別物なので、同じ読取から独立に取れることを固定する。

### branch 側の sheetId フィルタ (p5-4 critic 指摘)

branch は 1 シート専用だが、**配線の穴で別シートの content batch が branch op-log に
入りうる** (branch 表示中にシートを追加すると、新シートの編集が branch tap を通っていた)。
混ざったまま projection すると他シートのノードが branch の画面に現れ、merge で
そのまま trunk へ載る。→ trunk 側と同じく `meta.sheetId` で絞る。

- **別シートの batch が混ざっても projection に現れない**。
- sheetId 無し (structure 経路) の batch は残す — 絞りたいのは「他シートの content」
  であって、文脈を持たない batch を落とすことではない。
