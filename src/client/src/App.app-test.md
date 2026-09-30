# App.app-test.tsx — App 結合テスト

step3 Phase 0 S0-1 で新設した層である ([step3 実装計画](../../../deepse/plans/step3-implementation.md) の Phase 0、
[step3-entry](../../../deepse/plans/step3-entry.md) §2.3)。

## 何を

**フック (`useFileSheetOperations` / `useBranchOperations`) と子 (`Sidebar` / `GraphEditor`) の間を
一周する値**を検証する。`<App />` を丸ごと描き、利用者と同じ操作 (ログイン・招待・参加・
branch を切る・ノードを置く・「今すぐ同期」) をして、**画面に描かれたもの** (DOM) を見る。

## なぜ

step2 で実機にだけ出た無言の失敗 4 件は、どれも単体テストが緑のまま起きた
(step3-entry §2.3 の表)。原因はいずれもフックと App の間の配線で、単体テストは片側だけを
見ていた — 「op-log には入っているのに画面が古い」が典型である。

E2E (Playwright) には置かない。配線のバグはエンジン差ではないので、E2E に足すと
「エンジンをまたいで壊れるものだけ」という E2E の規約 (CLAUDE.md) が崩れる。

## どのように

### 世界 (`testing/appWorld.ts`)

通信の境界 2 つだけを `fetch` の所で差し替え、**内側はすべて本物**にする。

| 境界 | 差し替え先 |
| --- | --- |
| ローカルサーバ | 本物の Hono アプリ (`src/server`) をプロセス内で呼ぶ。DB は端末ごとの一時ディレクトリ |
| PDS | `testing/fakePds.ts` (XRPC を HTTP の形のまま受ける) |

- **複数の参加者は端末を順番に切り替えて表す。**agent がプロセスに 1 つなので、2 つの App は
  同時に立てられない。端末 = ローカルサーバの DB + localStorage
- **相手の記録は本物の App に書かせる。**手で組み立てると、step3 Phase 1 で op-log の形を
  作り直したときにテストが古い形を書き続ける
- **「開いている間に届く」は PDS の保留で作る。**alice の書き込みを `withhold` してから bob の
  画面を開き、`release` して bob が同期する
- 境界の外へ出ようとした通信 (`unhandled`) は、どのテストでも 0 件であることを `afterEach` で見る

### 別プロセスで走らせる理由

ファイル名を `*.test.tsx` にせず、`bun run test:app` で**別プロセス**として走らせる
(`bun run test` は単体の後にこれを走らせる)。

既存のコンポーネントテスト 4 本 (`EditableNode` / `EditableLabelEdge` / `GroupNode` / `ImageNode`) が
`mock.module` で `@xyflow/react` や `./NodeCreationContext` を差し替えており、**bun ではそれが
プロセス全体に効く**。同じプロセスで先に走ると App の import が壊れる (`--randomize --seed=3` で再現)。
App 結合は「本物の React Flow を描く」ことに意味があるので、同居させられない。

なお、この 4 本の漏れは **main でも単体どうしの順序依存を起こしている** (`--seed=4` で 11 件落ちる)。
既定の順序では顕在化しないので、ここでは直していない。

## テストケース

### 受信した変更が画面まで届く (step2 T7-3 の実機の失敗)

| テスト | 見ること | 外すと落ちる配線 (変異で確認) |
| --- | --- | --- |
| bob が branch を開いている間に届いた alice の編集が、canvas に描かれる | 受信 → branch の組み直し → **GraphEditor の再 seed** → DOM | ① App が `branchReceiveEpoch` を GraphEditor に渡す ② 「今すぐ同期」が開いている branch も引く |
| bob が trunk を開いている間に alice が切った branch が、サイドバーの一覧に出る | trunk の受信 → **branch 一覧の読み直し** → Sidebar | `useBranchOperations` の一覧の読み直しが `receiveEpoch` を契機にする |

② は**この層を作ったときに見つかった不具合**である。「今すぐ同期」には trunk の tap しか
配線されておらず、branch を開いたまま押しても相手の branch の編集は来なかった
(定期同期の 30 秒を待つしかなかった)。App が trunk と branch の `syncNow` を束ねるように直した。

## 操作手順 (`testing/appDriver.ts`)

ボタンの文言・aria-label で要素を探す。画面の言葉を変えるとここが落ちるので、直すのは
`appDriver.ts` の 1 箇所になる。

- pane のダブルクリックは React Flow が握るので、App は click 2 回の間隔で判定している。
  **同じ座標で click を 2 回送る**
- 参加コードは「コードをコピー」で clipboard に入る。`userEvent.setup()` が clipboard を
  stub に差し替えるので、その stub から読む
- `syncNow` は「ボタンの文言が戻る」までしか待たない。同期が始まる前に戻ることがあるので、
  **結果は必ず `waitFor` で待つ** (各テストがそうしている)
