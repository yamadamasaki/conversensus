# branchLog.test.ts — ブランチ/コミットログドメインのテスト仕様

## 何を

`branchLog.ts` の `tipClock` / `makeCommit` / `batchesUpTo` / `branchSheet` を検証する。

## なぜ

O3 spike で確定した再定義 —「コミット = ログ上のラベル付きオフセット、ブランチ = base + 追記 batches」— を production 型で固定する。現行 `branchState.ts` のレコード複製方式 (createBranch/createMainBranch/fetchBranchSheetFromPds) のドメイン概念を置換する Phase 2 の要。

## どのように

- **tipClock**: batches 中の最大 clock (ログ先端) を返し、空なら 0 になることを確認する。
- **makeCommit**: 現在の先端を指すコミット (オフセット) を作ることを確認する。コミットは「どの clock までを含むか」を表す。種別 (`kind`) は既定で `commit` になり、由来 branch は持たない。
- **makeMergeCommit** (ANA-122): merge それ自体を一級の記録にする。**`at` (trunk 側の先端) と `sourceAt` (取り込んだ branch op-log の先端) の両方を指す**ことを固定する。両者は別の file_id のログで clock も別系列なので、片方だけでは「trunk のどこに、branch のどこまでを」取り込んだかを復元できない。
- **batchesUpTo**: base コミット時点 (clock <= base.at) までの batches を切り出すことを確認する。ブランチの分岐点を決める。
- **branchSheet**: base 時点の trunk batches にブランチ側 batches を重ねて projection すると、
  - base より後の trunk 変更は含まれず (分岐後の trunk は見えない)、
  - ブランチ側の変更・追加が反映される
  ことを確認する。ブランチの状態がログの projection として導出できる証拠。

## 分岐点は vector で切る (step3 Phase 1 D3)

`makeBaseCommit` は `at` に加えて、分岐した時点で actor ごとに**持っていた最大の seq** (`vector`) を
記録する。`isUpTo` / `batchesUpTo` は vector があればそれで切り、無ければ (vector を記録する前の古いコミット) clock で切る。

**step3 Phase 3 S3-1 で、通常の commit と merge の commit も vector を持つようにした** (「merge も切断面の
一つ」— アドレスの切断面で commit・merge の時点を指すため)。Phase 1 ではこのフィールドは `baseVector` で
base コミットだけが持っていた。

| テスト | 固定すること |
| --- | --- |
| 🔴 分岐後に届いた、clock の小さい別の actor の batch は base に入らない | step3-entry §2.1 の穴。scalar で切っていた頃の答えも並べて、何が変わったかを見せる |
| 分岐時に持っていた batch は base に入る | |
| 同じ actor の、分岐時より後の seq は base に入らない | |
| 歯抜けがあっても、持っていた最大の seq まで base に入る | **歯抜けで止めない**。参加期間のフィルタが離脱中の batch を取り込まないので、歯抜けは恒久的に生じうる。止めると、戻ってきた人のその後の編集が base に入らなくなる |
| vector を持たない古いコミットは clock で切る | 互換は取らないが、vector の無い記録を読んでも壊れずに従来の答えになる |
| 通常の commit も vector で切る (S3-1) | 遅れて届いた別の actor の batch は、clock が小さくてもコミット時点に入らない |
| merge の commit は追記後の trunk の切断面を持つ (S3-1) | 「merge の直後」を切断面として指せる |

最初は「歯抜けなく持っていた範囲」(`contiguousFrontier`) で切っていたが、既存のテストの fixture
(seq が飛んでいる) で 15 件落ち、原因を追うと上の恒久的な歯抜けに行き当たった。
