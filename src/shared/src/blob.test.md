# blob テスト仕様

## 何を

`blob.ts` (ANA-116 S2) の 3 つを検証する。

- `computeBlobCid` — バイト列から blob CID (CIDv1 / raw / sha-256) を計算する
- `isBlobCid` — 受け取った文字列が CID の形をしているかを判定する
- `MAX_BLOB_SIZE` — PDS の blob 上限

## なぜ

**この関数が返す値が PDS の返す値と一致することが、ANA-116 の設計全体の土台である。**

画像バイナリは blob に置き, op-log には参照だけを載せる (設計
`deepse/plans/step1-refinement-ana116-image.md` D1)。この参照は ATProto の blob ref
そのもので, 鍵は CID である。CID を**アップロードより先にローカルで確定できる**からこそ:

- 未ログインで作った画像の参照を, 後からそのまま PDS へ push できる (書き換え不要)
- ローカル blob ストア (daemon) と PDS が**同じ識別子**を使えて対応表が要らない

計算が 1 バイトでもずれると, PDS は `Could not find blob` でレコードを拒否し,
その batch は outbox に詰まったままになる (S1 の実測)。静かに壊れる類の失敗なので,
**実機 PDS が実際に返した値をベクタとして固定する**。

`isBlobCid` は HTTP 境界の入力検証に使う。CID はそのまま DB の鍵になり
`GET /blobs/:cid` のパスにも現れるため, 想定外の文字列を先で弾く。

## どのように

- **computeBlobCid**
  - **実機 PDS の `uploadBlob` が返した CID と一致する**こと。ローカル PDS
    (`infra/pds`) へ `hello` / `conversensus` を実際にアップロードして得た 2 件を
    ベクタとして埋め込んである。**推測値ではない**
  - 同じバイト列から必ず同じ CID が出る (content-addressed の要)
  - 1 バイト違えば別の CID になる
  - **subarray (byteOffset を持つビュー) では, その範囲だけの CID になる** —
    実装が `.buffer` を渡すとビューの範囲を無視して別の値を返してしまうので,
    その退行を捕まえる
  - 空のバイト列でも計算できる (PDS はアップロードを拒否するが, 計算自体は定義される)
  - 長さは常に 59 文字で `bafkrei` で始まる (CIDv1 / raw / sha-256 の固定の接頭辞)
- **isBlobCid**: 実際の CID を受け入れ, 空文字・multibase 接頭辞違い・長さ違い・
  base32 に無い文字・大文字・パストラバーサル (`../../etc/passwd`) を拒否する
- **MAX_BLOB_SIZE**: PDS の実測値 5 MiB (5,242,880) と一致する。
  この数値は S1 で境界を実測したもの (+1 バイトで `request entity too large`)
