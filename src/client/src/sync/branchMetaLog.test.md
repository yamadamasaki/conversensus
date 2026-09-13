# branchMetaLog のテスト仕様

## 何を

branch / commit のメタを **trunk の tap に event として記録し** (`branchMetaRecorder`)、
**trunk の op-log を畳んで読む** (`readBranchMeta`) 口を、記録から読み戻しまで通して見る。

## なぜ

T7 以前の branch のメタは daemon の SQLite の行で、相手に届かなかった。さらに fork は
保存の時点で `conflictKey` と `origin` を失っていた (設計 事実 G) — daemon が branch の列しか
書かず、テストの偽の依存はオブジェクトを丸ごと保持していたので**単体テストでは見えなかった**。

このテストは偽の保存先を使わない。**`graphEventToBatch` で本物の batch を作って積み、
`foldBranches` で畳む**ので、記録と読み出しの間で何かが落ちれば現れる。

## どのように

trunk の tap の代わりに、record された event を `graphEventToBatch` で batch にして配列へ
積む。読み出しはその配列を `readBranchMeta` に渡す。

- **記録した branch を読める**: 作成の往復。
- **状態の変更と削除が反映される**: 口を出来事ごとに分けた (`saveBranch` という CRUD の
  名前だと、作成か状態の変更かを差分から推し量ることになる)。
- **コミットは `branchId` の有無で振り分けられる**。
- **fork の `conflictKey` と `origin` が読み戻しまで残る**: 事実 G の回帰テストである。
  `isFork` が真であることと、中身が丸ごと等しいことを見る。
- **記録は file 構造の batch である**: sheetId を持たないこと。付けると content batch として
  扱われ、そのシートのグラフの projection に混ざる。
