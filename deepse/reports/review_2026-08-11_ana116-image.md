# コードレビュー: ANA-116/117 画像の drag & drop (PR #198)

> 対象: `eeebf23..f48be87` (PR #198, merge 済)。
> 設計: `deepse/plans/step1-refinement-ana116-image.md`。
> 基準: `CLAUDE.md`「コードレビュー基準」の優先順。
>
> **merge 後にレビューし, 指摘はリファクタリングとして別途処理する**方針で進めている
> (ANA-116 の段取り 3)。ここは指摘の記録であり, 対応状況は最終節で追う。

---

## 1. 総評

**設計方針との一貫性は高い。** D1 (blob 正典) / D3 (ローカル blob ストア) /
D5 (未ログイン + push 前段での upload) / D7 (上限) が, それぞれ 1 つのモジュールに
素直に落ちている。とくに次の 3 点は良い:

- **書く形と読む形を `images/imageBlob.ts` の 1 ファイルに集めた**こと。この 2 つは
  同じ約束の裏表で, 離すと片方だけが新形式になる。旧 S4 を S3 に統合した判断が
  そのままモジュール境界になっている
- **`uploadBlobs` を必須依存にした**こと。省略可能だと配線忘れが
  「画像を含む batch だけが静かに詰まる」形で出る。型で防いでいる
- **依存を引数で差し込む形 (`SaveImageDeps` / `ResolveImageDeps` / `UploadImageBlobDeps`)**。
  解決順序は「どこを何番目に見るか」が仕様そのものなので, 各段の呼ばれ方を
  観測するテストが書けている

**テストも必要十分である。** 新規モジュールには `.test.ts` と `.test.md` が揃い,
`imageBlob.test.ts` は解決順序・上限の境界 (ちょうど / +1) ・undo で欠けないこと・
cid 食い違いといった**仕様の要点**を突いている。`pasteTarget.test.ts` は
「画像ノードと別種を同時に選んだ場合」まで意図を書いて固定してあり良い。

以下は指摘である。**merge を止めるものは無い。**

---

## 2. 要修正 (correctness)

### R1. `handlePasteKeydown` だけ最初の画像で抜けない

`src/client/src/GraphEditor.tsx:662`

```typescript
for (const item of clipboardItems) {
  for (const type of item.types) {
    if (!type.startsWith(IMAGE_MIME_PREFIX)) continue;
    e.preventDefault();
    const source = await item.getType(type);
    await pasteImage(source);        // ← break が無い
  }
}
```

drop 経路 (`handleDrop`) と paste イベント経路 (`handlePaste`) はどちらも
**最初の画像で `break`** しているのに, Cmd+V の代替パスだけが全 type を処理する。
1 つのクリップボード項目が複数の画像表現を持つ場合 (macOS では `image/png` と
`image/tiff` が同時に載ることがある), **同じ画像で 2 回**新規作成または差し替えが走る。

差し替え側で起きると op-log に無駄な `node.setProperties` が 2 本並び, blob も
2 つ pin される。旧実装から引き継いだ構造だが, 3 経路のうちここだけ振る舞いが違うのは
意図ではないはずである。

**対応**: 画像を 1 つ処理したら両ループを抜ける。

### R2. 差し替え後に解決できないと「前の画像」を出し続ける

`src/client/src/ImageNode.tsx:80` 付近の解決 effect と `:207`

```typescript
const displayUrl = resolvedUrl || imageDataUrl || imageUrl;
```

解決 effect は `blobCid` が変わっても `resolvedUrl` を空にしない。
`resolveImageUrl` が `undefined` を返す (どこにも実体が無い) か throw する
(PDS の取得失敗) と `setResolvedUrl` が呼ばれないので, **前の画像の URL がそのまま残る**。

起きる筋:

1. 他端末が `node.setProperties` で画像を差し替え, その blob がまだこの端末の
   ローカルストアに無く, かつ PDS の取得が失敗する (通信断など)
2. 画面には**古い画像が, 正しい画像であるかのように**出続ける

「読めない」ではなく「別のものが正しく見える」形で出るので, 見付けにくい。
`blobCid` が変わった時点で `resolvedUrl` を落とし, 解決できなければ
プレースホルダ (`:426` の分岐) に落ちるのが正しい。

**対応**: effect の先頭で `setResolvedUrl(null)`。所有 URL の revoke も
そこで済ませる (現在は次の解決が成功したときにしか revoke されない)。

---

## 3. 改善 (quality)

### Q1. 差し替えの dispatch が 2 箇所に重複

`ImageNode.replaceImage` と `GraphEditor.pasteImage` が, どちらも
「`saveImageBlob` → `NODE_PROPERTIES_CHANGED` を `imagePropertiesChange` で組む →
失敗を `reportImageError`」を書いている。規則 (`pasteTarget`) と形
(`imagePropertiesChange`) は既に切り出してあるのに, **手続きだけが残って重複**している。
`images/` 側のフック (例: `useReplaceNodeImage(dispatch)`) に寄せられる。

### Q2. `imageErrorMessage` を使っていない箇所がある

`GraphEditor.addImageNode` だけ `err instanceof Error ? err.message : String(err)` を
インラインで書いている (`GraphEditor.tsx:559` 付近)。同じ式のヘルパが
`images/imageErrorContext.ts` にあるので揃える。

### Q3. `ImageBlobRef` という名前が 2 つある

- `images/imageBlob.ts` — **ATProto の blob ref そのもの** (`{$type, ref:{$link}, mimeType, size}`)
- `atproto/blob.ts` — `uploadBlob` の戻り値を畳んだ `{cid, mimeType, size}`

設計書が「**`{cid, mimeType}` の形を op の properties に置いてはならない**」
(`ipldToLex` が blob ref と誤認する) と警告している以上, この 2 つが同名なのは
危うい。`atproto/blob.ts` 側を `UploadedBlob` などへ改名する。

### Q4. `commitUrl` の依存に使わなくなった `imageUrl` が残る

`ImageNode.tsx:185` 付近。`from: { imageUrl }` を `from: { ...properties }` に
直した際の取り残し。動作に影響は無いが, 依存配列は「何を読んでいるか」の記述なので
ずれていると次に読む人を誤らせる。

### Q5. `cacheBlobUrl` が Object URL を捨て漏らす

`atproto/blob.ts:33`

```typescript
export function cacheBlobUrl(cid: string, bytes: Uint8Array, mimeType: string) {
  const copy = bytes.slice();
  const url = URL.createObjectURL(new Blob([copy], { type: mimeType }));
  imageCache.set(cid, url);          // ← 既存の URL を revoke していない
}
```

同じ cid で 2 回呼ぶと前の Object URL が孤児になる。`imageCache` 自体にも上限や
破棄が無いので, 長時間のセッションで画像を貼るたびに積み上がる。
S3 以前からある性質だが, **S6 で差し替えが日常操作になったので露出が増えた**。

**対応**: 既存があれば revoke してから差し替える。キャッシュの寿命 (どこで捨てるか) は
別途決める必要がある — 現状は「セッション中ずっと」である。

### Q6. daemon が保存時の Content-Type をそのまま返す

`src/server/src/index.ts` の `POST /blobs` は MIME を検証せず, `GET /blobs/:cid` は
それを `Content-Type` として返す。ローカル daemon であり, CORS のプリフライトが
`text/html` の POST を止めるので直ちに悪用できる形ではないが, 安い保険として

- `POST` 側で `image/*` (将来の用途を見て allowlist) に絞る
- `GET` 側に `X-Content-Type-Options: nosniff` を付ける

のどちらかを入れておきたい。**リリース構成では daemon が VPS 上に居る**ので,
ローカル前提を最後の砦にしない方がよい。

---

## 4. テストの穴

### T1. `ImageNode` の失敗経路にテストが無い

`ImageNode.test.tsx` は差し替えの成功・伝播停止・非画像の 3 件を見ているが,
**`saveImageBlob` が投げたとき `reportImageError` が呼ばれること**を見ていない。
D7 (握り潰さない) は今回の主眼の 1 つなので, ここは固定しておきたい。

### T2. `pasteImage` の差し替え分岐にテストが無い

`pickImagePasteTarget` の規則は単体で固定されているが, 「選択があれば
`NODE_PROPERTIES_CHANGED`, 無ければ `NODE_ADDED`」という**振り分けそのもの**は
実機検証でしか通していない。`GraphEditor` を丸ごと描かずに済ませるなら, Q1 で
切り出すフックの単体テストとして書けるはずである。

---

## 5. 指摘しないことにしたもの

- **`api.ts` の `putBlob` / `fetchBlob` に単体テストが無い** — fetch の薄い
  ラッパーであり `CLAUDE.md`「テスト方針」の除外に当たる。HTTP 境界の振る舞いは
  `server/index.test.ts` が押さえている
- **`imageErrorContext.ts` に単体テストが無い** — context と 1 行のヘルパで,
  自明なコードに当たる
- **`pickImagePasteTarget` が混在選択で画像ノードを選ぶこと** — 設計 D6 の
  「画像ノードがちょうど 1 つ」に忠実であり, テストが意図付きで固定している
- **`BlobCid` / `MimeType` が branded ではないこと** — `CLAUDE.md` §2 の branded は
  UUID の ID に対する規約であり, CID は `isBlobCid` で形を検証している

---

## 6. 対応状況

| | 指摘 | 種別 | 状態 |
|---|---|---|---|
| R1 | Cmd+V 経路に break が無い | correctness | 未対応 |
| R2 | 差し替え失敗時に前の画像が残る | correctness | 未対応 |
| Q1 | 差し替え dispatch の重複 | 重複 | 未対応 |
| Q2 | `imageErrorMessage` の不統一 | 一貫性 | 未対応 |
| Q3 | `ImageBlobRef` の名前衝突 | 命名 | 未対応 |
| Q4 | `commitUrl` の余分な依存 | 後片付け | 未対応 |
| Q5 | Object URL の捨て漏らし | 資源 | 未対応 |
| Q6 | daemon が Content-Type を素通し | 堅牢性 | 未対応 |
| T1 | 失敗経路のテスト | テスト | 未対応 |
| T2 | 貼り付け振り分けのテスト | テスト | 未対応 |
