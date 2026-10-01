# bunSqliteDriver.test.ts — `bun:sqlite` のドライバ (step3 Phase 2 D1)

## 何を

`BunSqliteDriver` が `SqlDriver` の契約 (`sqlDriverContract.ts` の `SQL_DRIVER_CONTRACT`) を満たすこと。

## なぜ

`EventStore` は SQL のエンジンに依らない形にした (Phase 2 D1)。テストとローカルサーバは
`bun:sqlite`、ブラウザは SQLite-WASM で**同じ `EventStore` が動く**ことが要点で、そのためには
2 つのドライバが同じ振る舞いをしなければならない。**契約を 1 か所に書き、ドライバごとに当てる**
(SQLite-WASM のドライバには S2-3 でブラウザの中で同じ契約を当てる)。

契約に入れたのは `EventStore` が実際に頼っている振る舞いだけである:

- 名前付き (`$name`) と位置 (`?`) の両方のパラメータ (`EventStore` は両方を使う)
- `INSERT OR IGNORE` で無視した行の `changes` が 0 (`appendBatch` のべき等の判定)
- 無い行の `get` が `undefined` (`getSchemaVersion` / `getBlob`)
- BLOB の往復 (`putBlob` / `getBlob`)
- トランザクションが値を返し、例外で巻き戻す (`appendBatches` の 1 tx)

## どのように

契約はテストの道具に依らない形 (違反を例外にする関数の列) で書いてある。ブラウザの中でも
同じ関数を走らせられるようにするためである。ここでは各項目を新しいインメモリ DB に当てる。

## テストしていないこと

- **`EventStore` の振る舞い** — `eventStore.test.ts`
