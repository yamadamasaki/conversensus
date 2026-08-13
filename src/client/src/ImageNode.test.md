# ImageNode テスト仕様

## 何をテストするか

`ImageNode` カスタムノードの **ghost (削除予定表示) 分岐**。

`ImageNode` は blob 解決・URL 編集・リサイズなど広い責務を持つが、本ファイルが対象とするのは
ghost 分岐に限る。画像の読み込み経路は `atproto/blob` 側のテストで扱う。

## なぜテストするか

- ghost は「もう存在しないノード」である。そこからエッジを引けてしまうと、**存在しない
  ノードを指すエッジ (孤児エッジ) が trunk へ載りうる** (ANA-121)
- React Flow で接続を止めるのは `connectable` / `isConnectable` であって `selectable` では
  ない。`selectable: false` を見て「操作できない」と誤解しやすく、実際にこの取り違えが
  バグの原因だった
- ハンドルを**消す**修正では ghost エッジの端点の座標が失われる。「残したまま接続だけ止める」
  という微妙な要件なので、テストで固定しておかないと後から消されうる

## どのようにテストするか

### 隔離

`@testing-library/react` + `happy-dom` で DOM 環境を構築。`mock.module()` で以下をスタブ化する。

| モジュール | 理由 |
|---|---|
| `@xyflow/react` | `Handle` を **描画せず props を記録するスタブ**にする。`NodeResizer` / `useReactFlow` も無効化 |
| `./EventDispatchContext` | dispatch の呼び出し有無を検証するため |

接続可否は DOM のクラス名ではなく「`Handle` へ渡した `isConnectable`」で判定する —
React Flow の内部実装 (クラス名) にテストを縛らないためである。

**`./atproto/blob` と `./atproto/client` はモックしない。** bun の `mock.module()` は
テストファイルをまたいでグローバルに効くため, 部分的な差し替えが他のテスト
(`useBranchOperations.test.ts` / `useRemoteSyncQueue.test.ts`) の読み込みを壊した。
blob 解決の経路は `imageBlobCid && imageBlobMimeType` で閉じているので, テストで
それらを与えなければネットワークには到達しない。

### ケース設計

| テストケース | 検証内容 |
|---|---|
| ハンドルをすべて接続不可にする | ghost の全 `Handle` が `isConnectable={false}` を受け取る |
| ハンドル自体は消さない | 4 つのハンドル (top/bottom/left/right) が残る |
| ラベルを取り消し線付きで表示し画像は描画しない | ghost は内容ではなく「消えること」を見せる |
| ダブルクリックしても編集モードにならない | ghost 分岐は編集 UI を持たない |
| 通常のノードのハンドルは接続可能なまま | 通常分岐に `isConnectable` を渡していない (ghost 対策が漏れていない) |

## 対象外

`GroupNode` の ghost 分岐は **`Handle` を 1 つも描画しない**ため、同種の対策は不要である
(`GroupNode.tsx` は `Handle` を import すらしていない)。ノード単位の `connectable: false` は
`toFlowAndGhostNodes` が付けるので、そちらは `graphTransform.test.ts` で担保する。

## 画像を落として差し替える (ANA-117 S6)

既存の画像ノードへ画像を落とすと, **そのノードの画像が差し替わり, 新規ノードはできない**
(設計 D6)。ここは配線 (drop を受けて保存し op を出す) の検証であり, 保存や参照の形は
`images/imageBlob.test.ts` が持つ。

`images/imageBlob` はモジュールモックしない。bun の `mock.module` はテストファイルを
またいでグローバルに効くためで, 代わりに **`globalThis.fetch` を差し替えて**
ローカル blob ストアの応答だけを作る (このファイル内で元に戻せる)。
同じ理由で `@xyflow/react` のスタブには `MarkerType` も含めてある — 欠けると
同じ実行の中で `graphTransform` を読む別のテストが解決に失敗する。

- **落とした画像で properties を差し替える op を dispatch する** — `node.setProperties`
  1 件だけであること (`NODE_ADDED` を出さない) と, 画像以外の properties が残ること。
  `from` は差し替え前の全体で, undo で欠けない
- **canvas 側の drop へ伝播させない** — 止めないと「差し替え」と「新規作成」が
  同時に起きる。伝播の停止そのものを, 親の `onDrop` が呼ばれないことで見る
- **画像でないファイルは受け取らず canvas へ通す** — ローカル blob ストアも触らない。
  ノードの上に落ちたからといって, 画像でないものまで奪わない
- **保存に失敗したら op を出さずに理由を伝える** — 設計 D7「握り潰さない」。
  エラーの表示口は context (`ImageErrorProvider`) なので, そこへ渡した関数が
  呼ばれることで見る。旧実装は `console.error` だけで, 上限超過は
  「落としたのに何も起きない」ようにしか見えなかった

## 旧形式 (base64) を持つノードの編集 (レビュー R3)

`imageDataUrl` を持つ step0 期のノードでは, **URL を編集しただけで base64 が op に
載り直す**穴があった (全体を載せる仕様なので, 移さないと復活する)。落とすだけだと
旧形式には blob 参照が無く画像が失われるため, **触った時点で blob へ移す**。

- **URL を編集しても op に base64 を載せない** — `from` / `to` の両方を見る。
  `from` に移行後の参照が入っていること (undo で画像が戻る) まで確かめる

移行の規則そのものは `images/imageBlob.test.ts` の `migrateLegacyImageProperties`
が持つ。ここで見るのは **`commitUrl` がその移行を通していること**である。

## 解決できない画像 (レビュー R2)

blob 参照が変わったのに実体を引けないとき, **前の画像を出し続けてはならない**。
「読めない」ではなく **「別のものが正しく見える」** 形の不具合になり, 気付けない。
他端末が差し替えた直後で実体がまだこの端末に無い場合に実際に起こる。

- **差し替え先が解決できないとき前の画像を出し続けない** — 参照を差し替えた後に
  `<img>` が消え, **「画像を読み込めません」**に落ちること
- **実体がどこにも無い画像は「読み込めません」を出す (N4)** — ローカルにも PDS にも
  実体が無い参照は**永久に解決しない**ので, 「読み込み中」で止めると
  **「待てばそのうち出る」という嘘**になる。しかも `<img>` が生まれないため
  `onError` は来ない — **失敗を伝える経路がこの状態しか無い**。
  だから「解決が空で終わった」を状態に持ち, 進行中と区別する
- **画像が消えた (参照が外れた) ときも残さない** — `properties` から画像キーごと
  落ちる経路 (remote の `setProperties` など)。解決の effect は早期 return するので,
  **捨てる処理をその return より前に置く**ことが要点である

「読み込み中」と「読み込めません」を分ける判断は **`displayUrl` が無いときだけ**効かせる。
旧形式 (`imageDataUrl` / `imageUrl`) の画像を持つノードは blob の解決に失敗しても
そちらで表示できるので, 失敗を出すと嘘になる。

この describe だけ **専用の cid ベクタ**を使う。同じファイルの差し替えテストが
`cacheBlobUrl` で温めた共有キャッシュに当たると, daemon を見ずに解決してしまい
検証にならないため (キャッシュはモジュール全体で共有され, テスト間で消えない)。
