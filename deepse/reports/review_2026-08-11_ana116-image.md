# コードレビュー: ANA-116/117 画像の drag & drop (PR #198)

> 対象: `eeebf23..f48be87` (PR #198, merge 済)。
> 設計: `deepse/plans/step1-refinement-ana116-image.md`。
> 基準: `CLAUDE.md`「コードレビュー基準」の優先順。
>
> **merge 後にレビューし, 指摘はリファクタリングとして別途処理する**方針で進めている
> (ANA-116 の段取り 3)。ここは指摘の記録であり, 対応状況は最終節で追う。
>
> 2 通しで読んだ: 設計方針との一貫性を見る手読みと, `/code-review` の多角レビュー。
> **後者の指摘は該当コードを読んで裏取りしたものだけを載せている** (裏取りの結果は
> 各項に書く)。未検証のものはその旨を明記した。

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

**一方で, 最も重い 2 件 (R3 / R4) は「op に何を載せるか」の判断が
`properties` の意味論に依っていたところで出ている。** 置換か併合かが層によって
違うことに気付けば防げた性質のもので, 個々の実装の粗さではない。

以下は指摘である。**merge を止めるものは無い** (どれも旧データや複数端末など
条件付きで出る)。

---

## 2. 要修正 (correctness)

### R3. 旧データのノードで base64 が op に復活する ★最重要

`src/client/src/ImageNode.tsx:182` (`commitUrl`) と
`src/client/src/images/imageBlob.ts:161` (`imagePropertiesChange` の `from`)

S6 は差し替えの `to` から旧形式キーを落とす (`replaceImageProperties`) が,
**同じ配慮が 2 箇所に及んでいない**:

```typescript
// commitUrl — URL を編集しただけで properties 全体を載せ直す
to: { ...properties, imageUrl: trimmed },
// imagePropertiesChange — from は「差し替え前の全体」
return { from: { ...existing }, to: replaceImageProperties(existing, ref) };
```

`imageDataUrl` (base64) を持つ**旧データのノード**では, どちらも base64 を
新しい op へ載せ直す。設計 §7 は旧形式を**読み取り互換として残す**と決めているので,
このノードは普通に存在しうる。700KB 級の旧画像なら batch レコードが PDS の上限
(約 1,000,000 バイト) を超え, push が拒否されて outbox に詰まる —
**S3 で止めたはずの失敗がそのまま戻る。**

`from` 側は undo で効く: `invertEvent` は from と to を入れ替えるだけなので,
旧データのノードで差し替えを undo すると base64 が載った op ができる。

**対応**: `replaceImageProperties` の delete 一覧を両方で使う。
「旧形式キーは op に書かない」を 1 箇所の関数に集約し, `{...properties}` を
素で載せる箇所を残さない。

*(裏取り: `ImageNode.tsx:182` と `imageBlob.ts:161` を確認。`LEGACY_DATA_URL_KEY` が
読み取り経路に残っていることも `ImageNode.tsx:41` で確認。)*

### R4. ローカル状態は併合, 正典は置換 — 同じ op で結果が食い違う ★最重要

`src/client/src/events/applyEvent.ts:271-284` と
`src/shared/src/events/project.ts:157-160`

```typescript
// applyEvent (画面が読むローカル状態) — 併合
properties: { ...(n.data.properties ?? {}), ...event.to }

// project (op-log の projection = 正典) — 置換
case 'node.setProperties': { node.properties = op.properties; }
```

S6 は「`node.setProperties` は置換意味論だから op には全体を載せる」という
**正しい判断**をしたが, その前提が成り立つのは projection 側だけである。
画面を描くローカル reducer は併合なので, **`to` から消したキーはローカルでは消えない。**

出方は 2 つ:

1. **削除が効かない**。空の画像ノードに画像を貼って undo すると, 反転 op は
   `to: {}` になる。projection では画像が消えるが, ローカルでは併合なので何も起きず,
   **画面には画像が残ったままになる**。リロードすると消える = セッション中と
   リロード後で絵が違う
2. **R3 を悪化させる**。`replaceImageProperties` が落とした旧形式キーはローカル状態に
   残り続けるので, 次のプロパティ編集で再び op へ載る

**対応**: どちらかに揃える。`applyEvent` を置換にするのが筋だが,
`NODE_PROPERTIES_CHANGED` を差分で使っている既存の呼び出しが他にないかを
先に洗う必要がある (`events/toUnified.ts` 冒頭の既知の制約と併せて判断する)。

*(裏取り: 両ファイルの当該行を確認。この食い違い自体は本 PR より前からあるが,
S6 が `properties` の削除を初めて日常操作にしたことで表に出た。)*

### R1. `handlePasteKeydown` だけ最初の画像で抜けない

`src/client/src/GraphEditor.tsx:662`

drop 経路 (`handleDrop`) と paste イベント経路 (`handlePaste`) はどちらも
**最初の画像で `break`** しているのに, Cmd+V の代替パスだけが全 type を回す。
1 つのクリップボード項目が複数の画像表現を持つ場合 (画像編集ソフトからのコピーでは
`image/png` と `image/tiff` が同時に載ることがある), **同じ画像で 2 回**
新規作成または差し替えが走る。

**対応**: 画像を 1 つ処理したら両ループを抜ける。

### R2. 解決できないときに「前の画像」を出し続ける

`src/client/src/ImageNode.tsx:86-109` と `:207` (`displayUrl = resolvedUrl || …`)

解決 effect は `blobCid` が変わっても `resolvedUrl` を空にしない。入り口は 2 つある:

1. **解決に失敗する** — `resolveImageUrl` が `undefined` を返す (どこにも実体が無い) か
   throw する (PDS の取得失敗)。`setResolvedUrl` が呼ばれず前の URL が残る
2. **画像が消える** — 他端末の `node.setProperties` で画像キーが落ちると `blobCid` が
   空になり, effect は 1 行目で `return` する。`resolvedUrl` も `ownedUrlRef` も
   そのままなので, **消えたはずの画像が描かれ続け, Object URL も revoke されない**

「読めない」ではなく「別のものが正しく見える」形で出るので見付けにくい。

**対応**: effect の先頭で `setResolvedUrl(null)` と所有 URL の revoke を済ませ,
早期 return の前に置く。解決できなければプレースホルダ (`:426` の分岐) に落ちる。

---

## 3. 要検討 (設計の穴)

### D1. export / import で画像が失われる

`src/client/src/api.ts:233` (`exportFile`)

`exportFile` は `GraphFile` を JSON 化するだけである。本 PR より前は画像が
`properties.imageDataUrl` (base64) に入っていたので **`.conversensus` ファイルは
自己完結していた**。今は `properties.image` が blob 参照だけなので,

- 端末 A で export → 端末 B で import
- B のローカル blob ストアには実体が無く, 未ログインなら PDS も引けない (D5 の常態)
- 全画像が「画像を読み込めません」になる

設計 §7 の非目標は**旧データの一括移行**を対象外にしているが,
**export/import は触れていない**。仕様として決め直す必要がある (blob を同梱するか,
export 時に警告するか, 非目標として明記するか)。

*(裏取り: `exportFile` の実装を確認。`ConversensusFile` に blob を運ぶ場所は無い。)*

### D2. 上げられない blob 1 つが flush 全体を止める

`src/client/src/images/imageBlob.ts:305` (`createPdsBlobUploader` の skip) と
`src/client/src/sync/outbox.ts` (`flush` は reject で全件保留)

ローカルに実体が無い blob は警告して飛ばす — その後のレコード push が
`Could not find blob` で失敗し, `pushRemote` はループ途中で throw する。
`Outbox.flush` は reject 時に**保留を全件維持**するので, **無関係なファイルの batch まで
一緒に再送され続ける**。上限 (`capacity`) に当たると eviction が起きて catch-up で
回収される設計なので永久に詰まるわけではないが, 1 つの解けない画像が
同期全体の足を引っ張る形になっている。

**対応**: batch 単位の失敗境界を入れるか, 上げられないと分かった時点で
その batch だけを隔離する。現状のコメント (「レコード側は『PDS に既にある』場合だけ
通り, 無ければ push が失敗して未同期のまま残る」) は正しいが,
**巻き添えの範囲が書かれていない。**

---

## 4. 改善 (quality)

### Q1. 差し替えの dispatch が 2 箇所に重複

`ImageNode.replaceImage` と `GraphEditor.pasteImage` が, どちらも
「`saveImageBlob` → `NODE_PROPERTIES_CHANGED` を `imagePropertiesChange` で組む →
失敗を `reportImageError`」を書いている。規則 (`pasteTarget`) と形
(`imagePropertiesChange`) は既に切り出してあるのに, **手続きだけが残って重複**している。
`images/` 側のフック (例: `useReplaceNodeImage(dispatch)`) に寄せられる。
**R3 の修正を 1 箇所で済ませるためにも先にこれをやるとよい。**

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
直した際の取り残し。依存配列は「何を読んでいるか」の記述なので, ずれていると
次に読む人を誤らせる。

### Q5. `cacheBlobUrl` が Object URL を捨て漏らす

`atproto/blob.ts:33`。同じ cid で 2 回呼ぶと前の Object URL を revoke せずに
上書きする。`imageCache` 自体にも上限や破棄が無い。S3 以前からある性質だが,
**S6 で差し替えが日常操作になったので露出が増えた** (画像を受け入れるたびに 1 つ増える)。

**対応**: 既存があれば revoke してから差し替える。キャッシュの寿命 (どこで捨てるか) は
別途決める — 現状は「セッション中ずっと」である。

### Q6. daemon が保存時の Content-Type をそのまま返す

`src/server/src/index.ts:393` (`POST /blobs`) は MIME を検証せず, `:424` (`GET`) は
それを `Content-Type` として返す。`X-Content-Type-Options: nosniff` も
`Content-Disposition` も無い。CORS の許可は `localhost` 始まりの origin すべてなので,
**ローカルで動く別のページから `text/html` の blob を置いて daemon の origin
(`/files/*` と同一) 上で開かせる**筋が残る。**リリース構成では daemon が VPS 上に居る**ので,
ローカル前提を最後の砦にしない方がよい。

**対応**: POST で `image/*` に絞る, もしくは GET に `nosniff` を付ける。

### Q7. サイズ検査の前に本文を全部メモリへ読む

`src/server/src/index.ts:397`。`await c.req.arrayBuffer()` で確保してから
`MAX_BLOB_SIZE` を見るので, 巨大な body を投げられると 413 を返す前に
その分を確保してしまう。`Content-Length` を先に見て早期に切る (読み終わり後の
検査は残す)。

---

## 5. テストの穴

### T1. `ImageNode` の失敗経路にテストが無い

`ImageNode.test.tsx` は差し替えの成功・伝播停止・非画像の 3 件を見ているが,
**`saveImageBlob` が投げたとき `reportImageError` が呼ばれること**を見ていない。
D7 (握り潰さない) は今回の主眼の 1 つなので固定しておきたい。

### T2. `pasteImage` の差し替え分岐にテストが無い

`pickImagePasteTarget` の規則は単体で固定されているが, 「選択があれば
`NODE_PROPERTIES_CHANGED`, 無ければ `NODE_ADDED`」という**振り分けそのもの**は
実機検証でしか通していない。Q1 で切り出すフックの単体テストとして書ける。

### T3. 旧データのノードに対するテストが無い

R3 は「`imageDataUrl` を持つノードを編集する」という**旧データ固有の筋**で出る。
`imageBlob.test.ts` は `replaceImageProperties` が旧キーを落とすことを見ているが,
`commitUrl` や undo の経路は見ていない。読み取り互換を残すと決めた以上,
**旧データを入力にしたケース**をテストの語彙に入れる必要がある。

---

## 6. 未検証の指摘

`/code-review` が挙げたが**この場で確かめていない**もの。リファクタリング時に
実機で確認する。

- **Cmd+V が 2 経路で二重に走る** (`GraphEditor.tsx:665`) — `e.preventDefault()` が
  `await navigator.clipboard.read()` の**後**にあるため効かず, ブラウザは
  `paste` イベントも配送する。`handlePaste` (`:640` で登録) がそれを処理するので,
  Chrome では 1 回の Cmd+V で 2 つノードができる, という指摘。
  **実機検証では合成の `paste` イベントしか投げていないので, この筋は通していない。**
  R1 と同じ場所なので併せて確認する

---

## 7. 指摘しないことにしたもの

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

## 8. 対応状況

| | 指摘 | 種別 | 状態 |
|---|---|---|---|
| R3 | 旧データで base64 が op に復活 | correctness | **対応済** (触ったノードだけ blob へ移行) |
| R4 | ローカルは併合 / 正典は置換 | correctness | 未対応 |
| R1 | Cmd+V 経路に break が無い | correctness | 未対応 |
| R2 | 解決できないと前の画像が残る | correctness | 未対応 |
| D1 | export/import で画像が失われる | 設計 | 未対応 (仕様を決める) |
| D2 | blob 1 つが flush 全体を止める | 設計 | 未対応 |
| Q1 | 差し替え dispatch の重複 | 重複 | **対応済** (`images/replaceNodeImage.ts` へ集約) |
| Q2 | `imageErrorMessage` の不統一 | 一貫性 | **対応済** |
| Q3 | `ImageBlobRef` の名前衝突 | 命名 | 未対応 |
| Q4 | `commitUrl` の余分な依存 | 後片付け | 未対応 |
| Q5 | Object URL の捨て漏らし | 資源 | 未対応 |
| Q6 | daemon が Content-Type を素通し | 堅牢性 | 未対応 |
| Q7 | サイズ検査前に全部読む | 堅牢性 | 未対応 |
| T1 | 失敗経路のテスト | テスト | 未対応 |
| T2 | 貼り付け振り分けのテスト | テスト | 未対応 |
| T3 | 旧データを入力にしたテスト | テスト | 未対応 |
| — | Cmd+V の二重発火 | 未検証 | 要確認 |

**着手順の目安**: Q1 (重複を潰す) → R3 (1 箇所で直る) → R4 (意味論を揃える) →
R1/R2 → T1〜T3 → D1/D2 (仕様の判断が要る) → Q2〜Q7。
