# merge.test.ts — ログマージのテスト仕様

## 何を

`merge.ts` の `mergeBranches` (ブランチの batches を trunk へ追記するマージ) を検証する。

## なぜ

現行 `mergeBranchToTrunk` (レコード複製) を置換する Phase 2 の中核。conversensus の主題である「コンフリクト = 合意形成の機会」を成立させるため、**並行変更を対立として検出**しつつ、layout は静かに解決する (D7) という区別を正確に固定する必要がある。

step 2 で structure の競合検出を追加した (#206)。DtR (dialogue to resolve) graph は structure の競合から選択的に起動されるので、その検出がないと DtR の (2) が成立しない。仕様は `deepse/requirements/spec/merging.md` の「structure の競合」。

## どのように

### content (既存)

- **content 対立の検出 + LWW**: trunk と branch が同一ノードの content を別の値へ並行変更した場合、対立を 1 件検出し、projection では clock 最大が勝つ (LWW 暫定確定) ことを確認する。
- **layout は対立にしない**: 同一ノードの layout 並行変更は対立 0 件で、projection は clock 最大の値になる (静かな LWW, D7)。
- **同値の並行変更は対立にしない**: 同じ値への並行 content 変更は対立にならない (無意味な対立を出さない)。
- **structure の OR-Set**: ブランチ側で追加したノード・エッジがマージ後も保持される。
- **異なる target は非対立**: 別ノードへの content 変更同士は対立しない (対立は同一 target に限定)。

### structure の削除依存 (非対称)

片方が削除した要素を、もう片方が**前提にしている**場合を検出する。判定は「その op が成立するために存在していなければならない要素」(`prerequisitesOf`) 一本で、S1/S2/S4 をまとめて導く。

- **S1**: trunk が消したノードに branch が edge を張る。競合の `target` は **消された要素** であって edge ではないことを確認する — 主題は「何が消えたか」だから。
- **S2**: trunk が消したノードの content を branch が編集する。
- **S4**: trunk が消したグループに branch がノードを入れる。`setParent` の前提は `[対象ノード, 親]` の 2 つだが、消えているのは親だけなので **1 件**であることを確認する。
- **向きの対称性**: branch 側が削除した場合も検出する。このとき `ours`/`theirs` は「削除した/された」ではなく **常に trunk 側/branch 側**であることを固定する — 呼び出し側がどちらのログを追記するかで意味が変わるため。
- **両側が同じノードを消す**: 対立にしない。どちらも消したいだけで、争いがない。
- **消えたノードの layout 変更**: 対立にしない。layout の競合は「通知のみで DtR を起動しない」と決めたので、削除依存の判定に混ぜない。

### structure の並行変更 (対称)

「一つしか持てない値」への並行変更。content の対立と同型なので、検出も同じ経路 (`collectParallelChanges`) を通す。

- **S3**: 同じ edge の端点を別々に付け替える (`edge.reconnect`)。
- **S5**: 同じノードを別々のグループに入れる (`node.setParent`)。
- **同値の並行変更は対立にしない**: content と同じ扱い。
- **別々のノードへの変更は対立しない**: 対立は同一 target に限定。

## 対象外 (将来課題)

- **projection の add-wins 化**。検出はするが、決着までの間の既定の振舞いは現状の clock-LWW のまま。`spec/merging.md` の「検出後の既定の振舞い」で add-wins と決めたが、それは別イシューとする。
- **カスケード削除の推移的な検出**。`project.ts` の `node.remove` は子孫と端点を失う edge をカスケード削除するが、`mergeBranches` は base のグラフを受け取らないので「削除された親の子孫」への参照は追えない。直接の参照だけを見る。
