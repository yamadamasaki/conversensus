# step1 refinement ANA-116/117: 画像の drag & drop — 診断と設計

> 対象: Linear ANA-116「canvas へのイメージの drag & drop による画像ノードの作成」(GitHub #184)
> とその子課題 ANA-117「画像を画像ノードへの drag & drop で直接イメージとして貼り付けられない」
> (GitHub #185)。
>
> ANA-116 の本文には「step 0 でいろいろ試行錯誤し (主に画像データをどこに持つかという問題),
> step 0 の最後には実装されていた。step 1 ではアーキテクチャが大きく変わったので, 画像データの
> 置き場がなくなっているので機能していないのだと思われる」とある。本書はこの見立てを裏取りし,
> **置き場を決め直す**ためのものである (ANA-107 / ANA-118 / ANA-119 と同じ進め方)。
>
> **2026-08-10: §4 の方針 (D1/D5) はユーザー確認済 — 「blob 正典 + op-log は参照だけ」,
> 「未ログイン (ローカルのみ) でも画像が使えること」。S1 の実験は実施済で U1/U2/U4 は確定
> (§8, §10)。D2 は D2a (batch レコードの ops に blob ref を埋める) に確定。実装 (S2) に進んでよい。**

---

## 1. 結論

**ユーザーの見立てのとおりだった。ただし「機能が消えた」のではなく「置き場だけが消えた」。**
drag & drop / paste の UI コードは step0 のまま残っている (`GraphEditor.tsx:543-683`)。
step1 で外れたのは画像バイナリの行き先で, 症状は 3 つに分かれる。

| # | 症状 | 原因 |
|---|---|---|
| 1 | 他端末・再起動後に画像が出ない | **blob を pin するレコードが無い**。ATProto の blob はどのレコードからも参照されないと永続化されないが, `lexicons/` の 10 個のレコード定義に blob 型のフィールドが 1 つも無い |
| 2 | op-log が画像 1 枚で数 MB 肥大する | 代わりに **base64 (`imageDataUrl`) が op の properties に載り**, batch レコードごと PDS へ push されている |
| 3 | 未ログインだと**ノードすら作られない** | 3 経路とも `uploadImageBlob` を無条件に呼ぶ。セッションが無いと失敗し, `catch` が `console.error` するだけ |

つまり **step1 現在, 画像の実際の置き場は op-log の base64 だけ**である。
blob は upload されるが誰も参照しないので孤児になる。

**方針: バイナリは blob を正典とし, op-log には参照だけを載せる。**
step0 が試行錯誤の末に辿り着いた結論 (blob) を, step1 の「op-log が正典」というアーキテクチャに
載せ直す。ログインしていない環境のために **daemon 側にも content-addressed な blob ストアを置く**。

---

## 2. 診断 (すべてコードで確認済)

### 2.1 blob を pin するレコードが無い

`lexicons/app/conversensus/graph/` には file / sheet / node / edge / nodeLayout / edgeLayout /
branch / commit / merge / batch の 10 定義があるが, **`blob` 型のフィールドは 1 つも無い**
(`grep -rl blob lexicons/` が空)。

ANA-93 の `76ae67d feat(atproto): NodeRecord に blob 型 image フィールドを追加` で `node.json` に
入れた image フィールドは, Phase 6 の snapshot レコード退役と一緒に消えている。
step1 で PDS へ push されるのは **`app.conversensus.graph.batch` レコードだけ**なので,
blob を pin する場所が 1 つも残っていない。

ATProto の `uploadBlob` は blob を**一時領域に置くだけ**で, レコードから参照されて初めて永続化
される。したがって `uploadImageBlob` (`src/client/src/atproto/blob.ts:10`) は成功しても,
その CID は**どこからも参照されないまま**になる。

### 2.2 base64 が op-log に載り, PDS へ push されている

`e351f4a feat(graph): 画像の data URL 永続化を追加` で入った `createImageDataUrl`
(`blob.ts:40`) が, 画像バイト列を base64 の data URL にして
`properties.imageDataUrl` に入れている。これは:

- `node.add` の `properties` に載る (`toUnified.ts:100-113`)
- `node.add` は structure カテゴリ, `node.setProperties` は content カテゴリで,
  どちらも `isSyncable` = true (`unified.ts:228`, presentation 以外はすべて同期対象)
- → **batch レコードの `ops` に丸ごと入って PDS へ push される**

op-log は追記専用で, 全端末が range fetch して projection する。**画像 1 枚ぶんの base64 が
恒久的に全端末へ配られ続ける**。PDS のレコードサイズ上限にも当たる (実値は §8 U4)。

### 2.3 未ログインだと何も起きない

paste (`GraphEditor.tsx:543`) / Cmd+V (`:596`) / drop (`:652`) の 3 経路とも,
最初に `uploadImageBlob` を呼ぶ。`getAgent()` はセッションが無くてもエージェント自体は返すので,
失敗するのは `uploadBlob` の呼び出し時 (認証エラー) である。3 経路とも `try/catch` で囲まれて
いて **`console.error` するだけ** — `addNode` に到達しないので**ノードが 1 つも作られない**。

ガードとして書かれた `isBlobUploadEnabled()` (`blob.ts:91`) は **`atproto/index.ts` の
re-export 以外にどこからも呼ばれていない**。ガードが外れた状態である。

### 2.4 daemon 側にも置き場が無い

`src/server/src/index.ts` のルートは files / batches / commits / branches のみで, blob 相当の
エンドポイントは無い。永続層 (`eventStore.ts`) のテーブルも batches / commits / branches /
file_migrations の 4 つだけ。**ローカルにバイナリを置く場所がそもそも無い**。

これが 2.2 の base64 が入った理由でもある — 他に置き場が無かった。

### 2.5 ANA-117: 既存の画像ノードへ落とす経路が無い

`onDrop` は React Flow のコンテナに付いていて (`GraphEditor.tsx:760`), **常に新規ノードを作る**。
`ImageNode.tsx` には `onDrop` も `onPaste` も無い。既存ノードの上に落としても,
そのノードの画像が差し替わるのではなく重なった位置に別のノードができる。

---

## 3. 前提の確認 (コードで確認済)

1. **`ops` が `unknown` 型でも blob ref は blob として認識される。**
   `@atproto/lexicon` の `ipldToLex` (`dist/serialize.js:41-67`) は**レキシコン定義を見ずに
   ツリー全体を再帰的に歩き**, `{$type:'blob', ref, mimeType, size}` に一致した部分オブジェクトを
   `BlobRef` インスタンスへ変換する。`batch.json` の `ops` は `"type": "unknown"` だが,
   中に埋めた blob ref は素通しにはならない
2. **罠: `{cid, mimeType}` だけを持つオブジェクトも blob ref と誤認される。**
   `untypedJsonBlobRef` (strict) に一致するため。op の properties に**この 2 キーだけの
   オブジェクトを置いてはならない**。現行の `imageBlobCid` / `imageBlobMimeType` は
   フラットな別キーなので該当しない
3. **properties は op-log を最後まで運ばれる。** `node.add` (`project.ts:93-101`) も
   `node.setProperties` も projection で Sheet のノードへそのまま載り, `graphTransform.ts:151`
   が React Flow の `data.properties` へ渡す。`ImageNode` はここから読んでいる
4. **差分計算は properties を比較する** (ANA-119 S2 の `computeSheetChanges`)。
   参照が小さいほど差分・commit・merge のすべてが軽くなる。base64 は差分比較でも不利
5. **ローカル永続層は `bun:sqlite`** (`eventStore.ts`), クライアントの API base は
   `VITE_API_BASE ?? 'http://localhost:3000'` (`api.ts:21`)

---

## 4. 設計方針

### D1: 画像は content-addressed な blob, op-log には参照だけ (確定)

op の properties に載せるのは**参照のみ**とする。形は **ATProto の blob ref そのもの**である
(理由は D2):

```typescript
properties: {
  image: {
    $type: 'blob',
    ref: { $link: cid },   // CIDv1 / raw / sha-256。バイト列から決まる
    mimeType: string,
    size: number,
  },
}
```

- `{cid, mimeType}` の 2 キーだけのオブジェクトは**別の意味を持つ**ので使わない (§3 の罠)
- **`imageDataUrl` は新規に書かない**。既存データを表示する読み取り互換だけ残す (D4)
- 識別子が content-addressed なので, 同じ画像を 2 回落としても実体は 1 つ (重複排除が自然),
  かつ端末をまたいで同じ識別子になる

**識別子は ATProto の blob CID に揃える (S1 で確定)。** blob CID は
**CIDv1 / raw (0x55) / sha-256 でバイト列から決まる**ことを実測した (§10 U2)。
ローカルで計算した値と `uploadBlob` の戻り値が完全に一致するので, **ローカル blob ストアと
PDS で 1 つの識別子を共有できる** — 対応表は要らない。
アップロードしていない画像にも, 先に確定した CID を付けられる。

### D2: PDS 上で blob を pin する方法 → **D2a に確定 (S1 で実証)**

**batch レコードの `ops` の中に `{$type:'blob', ref:{$link}, mimeType, size}` を埋める。**
`ops` は lexicon 上 `unknown` だが, **PDS はその中の blob ref を確かに pin する** —
レコード書込の前後で `com.atproto.sync.listBlobs` に当該 CID が現れることを実測した (§10 U1)。
読み戻したレコードでも blob ref の形は保たれていた。

これで op-log 正典を保てる (レコード種別が増えない)。branch / merge の再スタンプ追記で
同じ blob ref が複数のレコードに載るのは, pin としてはむしろ堅い。

退けた案: 専用の `app.conversensus.graph.image` レコードを別に作る案 (D2b)。
pin は確実だが, Phase 6 で退役させた「op-log の外のレコード」が復活する。
U1 が肯定されたので採らない。

したがって op の properties は **blob ref の形そのもの**を持つ:

```typescript
properties: {
  image: { $type: 'blob', ref: { $link: cid }, mimeType, size },
}
```

ローカル projection 側はこれをただの `properties` として素通しする (Sheet には参照だけが残る)。
未ログインで作った画像も**同じ形**で書ける — CID がバイト列から決まるので (D1),
アップロード前に blob ref を完成させられるからである。

### D3: daemon にローカル blob ストアを置く

```
POST   /blobs            body = bytes, Content-Type = mimeType  → { cid, mimeType, size }
GET    /blobs/:cid       → bytes (Content-Type: mimeType)
```

- `bun:sqlite` に `blobs` テーブルを足す (`cid TEXT PRIMARY KEY, mime_type TEXT, size INTEGER, bytes BLOB`)。
  DB 1 つで完結するのでリセット手順 (user-test-environment.md) が今のまま通る。
  ファイル実体を `DATA_DIR` に置く案との比較は §8 U3
- content-addressed なので `POST` は**冪等** — 同じ内容なら同じ cid を返して上書きしない
- **ファイル (`fileId`) には紐づけない**。blob は content-addressed な共有ストアで,
  どのファイル・どの端末から参照されてもよい

### D4: 表示側の解決順序

`ImageNode` の解決順を次のとおりにする:

1. メモリキャッシュ (`getCachedBlobUrl`, アップロード直後)
2. **ローカル blob ストア** (`GET /blobs/:cid`) ← 新規
3. PDS `getBlob` (他端末が作った画像で, ローカルにまだ無いとき)
4. `imageDataUrl` (**旧データの読み取り互換のみ**)
5. `imageUrl` (URL 指定の画像。従来どおり)

3 で取れた blob は 2 へ書き戻してよい (次回以降ローカルで解決できる)。→ S4 で判断。

### D5: 未ログインでも作れる。PDS への送り出しは同期経路に寄せる (確定)

- **作成時に PDS を触らない**。drop / paste はローカル blob ストアへ保存 → 参照を持つ
  `NODE_ADDED` を dispatch する。ここまでログイン不要
- PDS への `uploadBlob` は **batch を push する経路の前段**で行う。
  「push しようとしている batch の ops が参照する blob のうち, まだ PDS に無いものを先に upload する」
- **順序を守らないと push が失敗する。** blob を上げる前に blob ref を含むレコードを書こうとすると
  PDS が `Could not find blob: <cid>` で**拒否する**ことを実測した (§10)。
  壊れたレコードができるより安全だが, 順序を間違えるとその batch は**再送し続けて outbox に
  詰まったままになる**。`remoteSyncQueue` / outbox の送信経路に手を入れる箇所である → S5
- **CID は upload 前に確定できる** (D1) ので, 未ログインで作った op も**同じ形のまま**後から
  push できる。後で書き換える必要は無い

### D6: ANA-117 — 既存の画像ノードへの drop / paste

`ImageNode` に drop ハンドラを付け, 落とされた画像を D3 の経路で保存してから
`NODE_PROPERTIES_CHANGED` (content) を dispatch する。
canvas 側の `onDrop` と二重に発火しないよう `stopPropagation` する。
paste は「画像ノードが選択されているならそのノードへ, いなければ新規ノード」とする。

### D7: サイズ上限

実測値 (§10 U4, ローカル PDS):

| 対象 | 上限 |
|---|---|
| blob | **5 MiB (5,242,880 バイト) ちょうど**。+1 バイトで `request entity too large` |
| レコード (リクエストボディ全体) | **1,000,000 バイト前後** (960KB は通り 1000KB は通らない) |

**この 2 つの差が今回の設計の根拠そのものである。** 現行の base64 方式では画像 1 枚が
レコード上限 (約 1MB) に直接当たり, base64 は 4/3 に膨らむので **700KB を超える画像は
push できない**。blob へ逃がせば 5 MiB まで扱えて, しかもレコード側は参照ぶんの数百バイトで済む。

クライアント側は **5 MiB を超える画像を保存前に弾き, 理由をユーザーに伝える**
(今のように黙って失敗させない)。縮小・変換は非目標 (§7)。

> 上限は PDS の設定値なので, 本番 (Hetzner) と一致するとは限らない。クライアントの定数は
> 実測値をそのまま使い, 超過時のエラーは PDS の応答も拾って表示する。

---

## 5. 実装スライス (草案)

| ID | 内容 | 主な変更先 |
|---|---|---|
| ~~**S1**~~ | ~~**実験**: 実機 PDS で U1/U2/U4 を実測する~~ **完了 (2026-08-10, §10)**。D2a / CID 共有 / 上限が確定した | 使い捨てスクリプト (コミットしない) |
| **S2** | daemon のローカル blob ストア (`POST /blobs` / `GET /blobs/:cid` + `blobs` テーブル) | `src/server/src/eventStore.ts`, `index.ts` |
| **S3** | 作成経路を blob 参照へ切替。3 経路 (drop/paste/Cmd+V) をローカル保存 → `NODE_ADDED`。未ログインで動く。`imageDataUrl` は新規に書かない。サイズ超過を弾く | `GraphEditor.tsx` (判断は新モジュールへ切り出す), `atproto/blob.ts` |
| **S4** | 表示側の解決順序 (D4)。旧 `imageDataUrl` の読み取り互換を保つ | `ImageNode.tsx` |
| **S5** | PDS への blob push を同期経路に組み込む (D5 の順序保証)。D2 の結論に従い pin する | `sync/` の push 経路, `atproto/` |
| **S6** | ANA-117: 既存の画像ノードへの drop / paste | `ImageNode.tsx` |

S1 は**コードを変えない実験**だった。U1 が肯定されたので D2a で進む (S5 の形が決まった)。
実装は **S2 から**である。

旧 `imageDataUrl` データの blob への一括移行は**非目標** (§7)。読み取り互換だけ残す。

---

## 6. 受入基準 (草案)

### 共通

- lint / typecheck / test がすべてパスする
- 変更したモジュールに単体テストと `.test.md` がある

### S2

- 同じバイト列を 2 回 POST しても行が 1 つで, 同じ cid が返る
- `GET /blobs/:cid` が正しい Content-Type とバイト列を返す
- 存在しない cid は 404

### S3

- **未ログインの状態で** canvas に画像を drop すると画像ノードができ, 画像が表示される
- op-log の `node.add` の properties に **base64 が入っていない** (参照のみ)
- 上限を超える画像を落とすと, ノードを作らずにユーザーへ理由が伝わる

### S4

- 旧データ (`imageDataUrl` を持つノード) がそのまま表示できる
- ローカル blob ストアに実体があれば PDS を触らずに表示できる

### S5

- batch が PDS に載る前に, その batch が参照する blob が PDS に載っている
- 別端末が PDS 経由でその画像を表示できる (実機 e2e)

### S6

- 既存の画像ノードへ画像を落とすと**そのノードの画像が差し替わり**, 新規ノードはできない
- 差し替えが op-log に `node.setProperties` として 1 件載る

---

## 7. 非目標

- **画像の縮小・形式変換・EXIF 除去**。上限を超えるものは弾くだけにする
- **旧 `imageDataUrl` データの blob への移行**。読み取り互換のみ
- **blob の GC** (参照が消えた blob の削除)。op-log は追記専用で過去のバージョンからも
  参照され得るため, 削除の判断は別課題とする (§8 U5)
- **画像以外のファイル添付**
- PDS 未ログイン時の**端末間**同期 (そもそも同期経路が無い)

---

## 8. 未決事項

| ID | 問い | 状態 |
|---|---|---|
| **U1** | PDS は `unknown` フィールド (`ops`) の中にある blob ref を pin するか | **確定: pin する** (§10) |
| **U2** | blob CID はバイト列から決まるか。ローカルで同じ値を計算できるか | **確定: 決まる。完全に一致する** (§10) |
| **U3** | ローカル blob の実体を SQLite の BLOB 列に置くか, `DATA_DIR` のファイルに置くか | **未決**。S2 の実装時に決める。上限が 5 MiB と分かったので, SQLite の BLOB 列で無理は無いはず |
| **U4** | PDS のレコード上限 / blob 上限の実値 | **確定: blob 5 MiB / レコード 約 1,000,000 バイト** (§10) |
| **U5** | 参照されなくなった blob をどうするか | **本 PR では非目標**。S6 完了時に別課題として起票するか判断する |

---

## 9. 決定記録

- **2026-08-10 D1 (画像の置き場)**: 「blob 正典 + op-log は参照だけ」を採用。
  代替案「op-log に base64 を載せ続ける (上限付き)」は実装が最小だが, 追記専用ログに
  バイナリが恒久的に残り全端末へ配られ続けるため退けた。「ハイブリッド (小さい画像は
  data URL)」は差分・同期・解決順序の場合分けが二重になるため退けた
- **2026-08-10 D5 (未ログイン)**: ローカルのみでも画像を使えることを要件とした。
  このため作成時に PDS を触らない設計とし, PDS への送り出しは同期経路へ寄せた
- **2026-08-10 D2 (pin 方法)**: S1 の実測により D2a (ops に blob ref を埋める) に確定。
  D2b (専用 image レコード) は不要になった

---

## 10. S1 実験の結果 (2026-08-10)

ローカル PDS (`infra/pds`, `alice.test`) に対して実測した。スクリプトは使い捨てで残していない。

### U2: blob CID はバイト列から決まる — **一致した**

`CIDv1 / raw (0x55) / sha-256` でローカル計算した CID と `uploadBlob` の戻り値が完全に一致した。

```
ローカル計算: bafkreic3swyzactei6wdobyc5ebtks7pmrjjycecpzzo7klzmrnscpetbi
PDS の戻り値: bafkreic3swyzactei6wdobyc5ebtks7pmrjjycecpzzo7klzmrnscpetbi
```

→ **ローカル blob ストアと PDS で識別子を共有できる。対応表は要らない。**
さらに**アップロードより先に CID を確定できる**ので, 未ログインで作った op を後から
そのまま push できる (書き換え不要)。

### U1: `ops` (unknown) 内の blob ref は pin される — **される**

`com.atproto.sync.listBlobs` が, batch レコードを書く前は当該 CID を含まず, 書いた後は含んだ。
読み戻したレコードでも blob ref の形は保たれていた。

**`BlobRef` インスタンスでも素の JSON でも同じ結果**だった。実装は op-log (SQLite に JSON 文字列)
から読んだ ops をそのまま push するので, 後者が確認できたことが重要である。

### 副産物: 未 upload の blob を参照するレコードは PDS が拒否する

```
Could not find blob: bafkreih3y7yip7oqq5zwfc452mc36hxer6lhd53tyouznauzrxvnbjgzva
```

壊れたレコードができるより安全だが, **順序を間違えるとその batch は再送し続けて outbox に
詰まったままになる**。D5 の順序保証は「あった方がよい」ではなく**必須**である。

### U4: サイズ上限

| 対象 | 通る | 通らない |
|---|---|---|
| blob | 5,242,880 バイト (5 MiB) | 5,242,881 バイト → `request entity too large` |
| レコード | 960KB | 1000KB → `request entity too large` |

境界から見て, レコードのリクエストボディ上限は **1,000,000 バイト**と思われる。
