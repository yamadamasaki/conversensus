# nullSyncProvider テスト仕様

## 何を

`NullSyncProvider` (step1 Phase 4a、完全ローカルの `SyncProvider` 実装) をテストする。
`push` / `pull` / `subscribe` の 3 メソッドが「同期しない」契約どおりに振る舞うことを検証する。

## なぜ

`NullSyncProvider` は「provider が常に存在する」前提を成立させるための既定実装
(architecture §6 の "null (完全ローカル)")。外の層は ATProto の有無で分岐せず、
常に `SyncProvider` インターフェースだけに依存できる — その保証がこの provider の
契約であり、回帰すると未ログイン/オフライン構成が壊れる。

`SyncProvider` 境界そのもの (interface / Cursor / PullResult 型) は型定義のみで
ロジックを持たないためテスト対象外。振る舞いを持つ `NullSyncProvider` を固定する。

## どのように

- **push**: remote が無くても reject せず解決する (no-op、返り値 undefined)。
- **pull**: どんなカーソルを渡しても空 batches と `INITIAL_CURSOR` を返す (前進しない)。
- **subscribe**: 登録した `onRemote` を一度も呼ばない (配信元が無い)。
- **unsubscribe**: 返り値の解除ハンドルを呼んでも例外を投げない (no-op)。
