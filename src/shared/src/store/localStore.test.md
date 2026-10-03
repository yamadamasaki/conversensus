# localStore.test.ts — ローカル正典の操作 (step3 Phase 2 D2)

## 何を

`LocalStore` — ローカルサーバの HTTP 経路が持っていたロジック (File の作成・取り込み・一覧・
受信の追記・blob の検査) を HTTP から切り離して集めたもの。

## なぜ

Phase 2 でローカルサーバ (bun + Hono) はブラウザ内の eventStore に置き換わる。経路のロジックを
HTTP に置いたままだと、ブラウザ側に**第 2 の実装**ができる。`LocalStore` に 1 本化し、サーバの
経路も client の `storeBackend` も、これを薄く包むだけにした。

**ここが検証の正本になる。**サーバの HTTP テスト (`index.test.ts`) は S2-7 でサーバと一緒に
消えるので、ロジックの性質はここで固定しておく。

## どのように

`bun:sqlite` のインメモリ DB の上に作る。例で書く (どれも具体的な振る舞いの固定)。

| テスト | 固定すること |
| --- | --- |
| createFile: 既定の名前と 1 枚のシート、genesis | 作った時点で op-log が正典 (projection が返り値と一致) |
| createFile: 正典の marker | 旧 snapshot の移行に拾わせない (撤去まではサーバが持つ) |
| createFile: 一覧に現れる | |
| importFile: id をすべて振り直し、参照を付け替える | 同じファイルを 2 回取り込んでも別の File になる |
| 🔴 importFile: 返り値と projection が一致 | id の振り直しの**後**のものを genesis にしなければ、取り込み直後と開き直しで画面が変わる |
| 🔴 importFile: 同梱 blobs は op-log に入らない | base64 を op-log に流すとレコード上限に当たる (ANA-116 の再発) |
| importFile: 形が合わなければ理由を返し、何も書かない | |
| 自分の追記は marker を立てず、受信は立てる | 受信の経路を分けている理由 (step1 Phase 4d-5) |
| 追記はべき等 | |
| since | clock がそれより後のものだけ |
| putBlob: cid は内容から計算し冪等 | 申告を鍵にすると内容と一致しない cid で汚せる |
| putBlob: 画像以外・空・上限超過を断る (上限ちょうどは受ける) | daemon の origin で HTML を配らせない / 送信時に初めて失敗して outbox に詰まるのを避ける |
| getBlob: 無ければ null | 他端末の画像では普通に起こる |

## テストしていないこと

- **`storeBackend` (client)** — `LocalStore` を `Promise` で包み、`BatchSchema` で読み直すだけの
  薄い層である。App 結合 (`*.app-test.tsx`) がこれを通って動く。経路を潰す変異 (受信の追記を
  捨てる) で App 結合の 6 件が落ちることを確かめた
- **HTTP の要求の形の検証** — サーバが撤去されるまで `index.test.ts`

## File 作成時の metagraph (step3 Phase 4)

- **Sheet 1 と目次の metagraph "index" を持つ File を作る** (仕様: File を作るとその中の sheet の一つとして
  metagraph が作られる)。**index の種別が起点の op-log に載る** — 以前の起点 (`graphFileToBatches`) は
  シートのプロパティと `templateIds` を落としていたので、ここで projection の種別まで見る
