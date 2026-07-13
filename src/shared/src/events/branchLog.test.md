# branchLog.test.ts — ブランチ/コミットログドメインのテスト仕様

## 何を

`branchLog.ts` の `tipClock` / `makeCommit` / `batchesUpTo` / `branchSheet` を検証する。

## なぜ

O3 spike で確定した再定義 —「コミット = ログ上のラベル付きオフセット、ブランチ = base + 追記 batches」— を production 型で固定する。現行 `branchState.ts` のレコード複製方式 (createBranch/createMainBranch/fetchBranchSheetFromPds) のドメイン概念を置換する Phase 2 の要。

## どのように

- **tipClock**: batches 中の最大 clock (ログ先端) を返し、空なら 0 になることを確認する。
- **makeCommit**: 現在の先端を指すコミット (オフセット) を作ることを確認する。コミットは「どの clock までを含むか」を表す。
- **batchesUpTo**: base コミット時点 (clock <= base.at) までの batches を切り出すことを確認する。ブランチの分岐点を決める。
- **branchSheet**: base 時点の trunk batches にブランチ側 batches を重ねて projection すると、
  - base より後の trunk 変更は含まれず (分岐後の trunk は見えない)、
  - ブランチ側の変更・追加が反映される
  ことを確認する。ブランチの状態がログの projection として導出できる証拠。
