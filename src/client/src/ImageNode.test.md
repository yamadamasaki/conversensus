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
