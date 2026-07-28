# storage.test.ts — テスト仕様

## 何をテストするか

`src/server/src/storage.ts` が提供する snapshot 永続化の4関数:

| 関数 | 責務 |
|---|---|
| `writeFile` | GraphFile を JSON として書き込む |
| `readFile` | ID で JSON を読み込み GraphFile を返す |
| `listSnapshotIds` | snapshot ファイルの id 一覧を返す (**中身は読まない**) |
| `deleteFile` | ID のファイルを削除する |

> **退役予定** (step1 Phase 6, 設計 §2.1-3): このモジュールは op-log 単独化の完了
> (p6-5) で丸ごと消える。中身を読む一覧 (旧 `listFiles`) は `GET /files` が op-log 単独に
> なった p6-2 で消費者を失ったため、既に削除した。

## なぜテストするか

- サーバーの唯一のデータ永続化層であり、バグが即データロスに直結する
- 入出力の対称性 (書いたものを読める) と境界値 (存在しない ID) を保証したい
- ファイルシステムを直接操作するため、ロジックの正確さが自明でない

## どのようにテストするか

### 隔離

`process.env.DATA_DIR` で書き込み先を上書きできるよう `storage.ts` を修正済み。
各テストケースの `beforeEach` で OS の一時ディレクトリ (`os.tmpdir()`) 以下に
ランダムなサブディレクトリを作成し、`afterEach` で削除する。
これにより実際の `data/` ディレクトリを汚染しない。

### ケース設計

| ケース | 観点 |
|---|---|
| write → read で同一オブジェクトが返る | 書き込みと読み込みの対称性 |
| 存在しない ID の read は null | null ガード |
| 空ディレクトリの listSnapshotIds は [] | 初期状態 |
| DATA_DIR 未作成でも [] | 初回起動・2 組目のデーモン (scan の throw を握る) |
| write 後に id が拡張子なしで現れる | 一覧の正確性 |
| 複数 write 後に全件列挙される | 複数ファイルの列挙 |
| 存在する ID の delete は true, 読めなくなる | 削除の完全性 |
| 存在しない ID の delete は false | 冪等性・エラーハンドリング |
