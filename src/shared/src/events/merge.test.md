# merge.test.ts — ログマージのテスト仕様

## 何を

`merge.ts` の `mergeBranches` (ブランチの batches を trunk へ追記するマージ) を検証する。

## なぜ

現行 `mergeBranchToTrunk` (レコード複製) を置換する Phase 2 の中核。conversensus の主題である「コンフリクト = 合意形成の機会」を成立させるため、**content の並行変更を対立として検出**しつつ、layout は静かに解決する (D7) という区別を正確に固定する必要がある。

## どのように

- **content 対立の検出 + LWW**: trunk と branch が同一ノードの content を別の値へ並行変更した場合、対立を 1 件検出し、projection では clock 最大が勝つ (LWW 暫定確定) ことを確認する。
- **layout は対立にしない**: 同一ノードの layout 並行変更は対立 0 件で、projection は clock 最大の値になる (静かな LWW, D7)。
- **同値の並行変更は対立にしない**: 同じ値への並行 content 変更は対立にならない (無意味な対立を出さない)。
- **structure の OR-Set**: ブランチ側で追加したノード・エッジがマージ後も保持される。
- **異なる target は非対立**: 別ノードへの content 変更同士は対立しない (対立は同一 target に限定)。

## 対象外 (将来課題)

- concurrent add/remove の add-wins OR-Set 厳密化 (現状は projection の clock-LWW に委ねる)。
