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

### canvas の編集が「(N 変更)」に数えられる (step2 T7-7 の実機の失敗)

1 端末・未ログインで File と branch を作り、branch を開く。

| テスト | 見ること | 外すと落ちる (変異で確認) |
| --- | --- | --- |
| branch を開いた直後に置いたノードも、変更として数えられる | canvas の変化 → `onChange` → `activeFile` → `pendingChanges` → 下部バー | 再 seed 後 150ms は変化を捨てる (旧実装の窓) |
| branch を開いただけでは、変更は数えられない | 計測・差分の色で nodes/edges が変わっても、変更は 0 のまま | — (逆向きの退行の見張り。中身が同じ変化を通しても `pendingChanges` は増えないので、門の通しすぎはここでは見えない。それは `graph/changeGate.test.ts` の性質が見る) |

T7-7 は step2 で「5 回中 2〜3 回」とだけ報告され、原因が分かっていなかった。この層で
**開いてから置くまでの間隔を 0 / 50 / 100 / 200 / 400ms と振って**、150ms 未満で必ず起きることを
突き止めた。直し方は `graph/changeGate.ts` の冒頭にある。

### 因果の点が端末をまたいで載る (step3 Phase 1 S1-3)

v2 の op-log では batch が点 (seq) と依存 (deps) を持つ。偽 PDS に届いたレコードの本文を見る。

| テスト | 見ること | 外すと落ちる (変異で確認) |
| --- | --- | --- |
| bob が開いている間に届いた alice の編集は、bob が次に書く batch の deps に入る | 受信 → `observeRemote` → 発番器の知識 → deps | 受信した batch を知識に取り込まない (clock だけ進める) |
| trunk と branch で書いた点は、同じ連番から重複なく振られる | App が trunk の発番器を branch の tap へ渡す配線 | branch の tap が自前の発番器を作る |

1 本目は筋書きに注意が要る。**tap の復元は最初に書いたときに走る**ので、alice の編集が bob の
最初の書き込みより前に届くと、復元 (手元のログ) の経路で知識に入ってしまい、受信の経路を
通らない。最初の版はこれで変異を見逃した。alice の編集を保留し、bob が 1 つ書いて復元を
済ませてから公開する。

### 同じ branch を 2 人が並行に merge しても収束する (step3 Phase 1 S1-4)

alice が branch を切ってコミットし、bob と alice がそれぞれ相手の merge を知らずに同じ branch を
merge する (bob の書き込みは保留)。互いの merge が届いた後、両者の画面が同じグラフになり、PDS には
写しが元ごとに 2 つずつ書かれていることを見る。

**このテストが見ていないもの**: 写しの重複除去そのもの。同じ編集を 2 回当てても結果は変わらない
ので、畳み込みの重複除去を外してもこのテストは通る (変異で確認した)。除去が**効く場面** (2 つの写しの
間に別の編集が挟まり、後ろの写しがそれを巻き戻す) は `shared/src/events/project.test.ts` の例と性質で
固定している。ここで固定しているのは、写しを merge した人の batch として書き、送り、受け取る
**配線が端末をまたいで一周する**ことである。

## 操作手順 (`testing/appDriver.ts`)

ボタンの文言・aria-label で要素を探す。画面の言葉を変えるとここが落ちるので、直すのは
`appDriver.ts` の 1 箇所になる。

- pane のダブルクリックは React Flow が握るので、App は click 2 回の間隔で判定している。
  **同じ座標で click を 2 回送る**
- 参加コードは「コードをコピー」で clipboard に入る。`userEvent.setup()` が clipboard を
  stub に差し替えるので、その stub から読む
- `syncNow` は「ボタンの文言が戻る」までしか待たない。同期が始まる前に戻ることがあるので、
  **結果は必ず `waitFor` で待つ** (各テストがそうしている)
- **File と branch を開く手順は、復元したタブを考える** (step3 Phase 3 S3-3)。同じ端末で
  App を描き直すと、前回のタブが `localStorage` から戻り、画面はその File (・branch) を
  自分で開く。そこで File の名前や開いている branch の行を押すと、展開が閉じる・trunk に戻る。
  `openFileNamed` / `openBranch` は**選ばれているタブが既に行き先なら押さず**、画面が着くのを待つ

## 同じブラウザの別のタブの書き込み (step3 Phase 2 S2-4)

### なぜ

PWA では、タブはそれぞれ Worker を持ち、同じ OPFS の DB に**別の actor** (タブごとの deviceId, 設計 D4) で
書く。別のタブの書き込みは DB に入っても画面は知らないので、書いたタブが BroadcastChannel で
知らせる (D3)。受けたタブがすべきことは 2 つある:

1. **画面に出す** — 手元の正典に、画面へ出ていない他の actor の batch があれば差し替える (#202 の経路)
2. **因果の知識に入れる** — 入れないと、別のタブの編集を見た上で書いた batch の deps にそれが
   載らず、並行と判定されて偽の競合になる (step3 Phase 1 D4)。**画面からは見えない**ので
   E2E ではなくここで見る

### どのように

同じプロセスに App を 2 つは立てられないので、**別のタブの書き込みを直接 DB に入れ**
(`world.localStore()`, actor は `<did>#other-tab`)、bun の BroadcastChannel で知らせを送る。
先に 1 つ書いて tap の因果の復元を済ませておく — 復元より前に入れると、手元のログからの復元で
知識に入ってしまい、知らせの経路を検証できない (因果の点の App 結合と同じ注意)。

- **🔴 別のタブの編集は画面に出て、次に書く batch の deps に入る**: ノードが 2 つになり、
  次に置いたノードの batch の `deps` に別のタブの点 (seq 7) が載る

変異で確かめたこと: `causal.restore` を外すと deps の検査が、tap に `onLocalChanged` を渡さないと
画面の検査が落ちる。

## branch の出入りで trunk と branch が混ざらない (step3 Phase 3 S3-2)

### なぜ

S3-2 で、branch の中身を `activeFile` に差し替えて表す仕組み (退避と復元・受信した trunk の
控え直し) を撤去した。**撤去の前に**、その仕組みが守っていた振る舞いを画面の側から固定した網である。

- **trunk に戻ると branch のノードは出ず、branch を開き直すと出る**
- **branch を開いたままシートを足しても、branch の中身は trunk に移らない** (画面と op-log の両方)
- **branch を開いている間に届いた trunk の編集は、trunk に戻ると見える** (2 人・PDS 経由)

変異で確かめたこと: branch を開くときに `activeFile` を branch の中身で差し替える (昔の形) と
3 件目が落ちる。

## タブ (step3 Phase 3 S3-3)

### なぜ

タブはアドレスだけを持ち、画面をそのアドレスへ持っていくのは App (`useTabNavigation`) である。
移動は File → シート → branch の段ごとに非同期に進むので、**純関数の単体 (`tabs/tabs.test.ts`) では
「段を最後まで踏めば着く」までしか言えない**。実際に state が動き、branch の一覧が後から読まれ、
画面が着くことはここで見る。

### テストケース

1 端末・未ログインで File を作り、Sheet 1 (trunk) にノード 1 つ、branch b1 に 2 つを置く。
タブは trunk と b1 の 2 枚になる。

- **シートと branch はそれぞれのタブで開き、タブを切り替えるとその中身が出る** (1 つ ⇔ 2 つ)
- **既に開いているアドレスをサイドバーから開くと、そのタブへ移る** (Q2。タブは 2 枚のまま)
- **タブを閉じると隣のタブの中身が出る**
- **再読み込みしてもタブが並び、アクティブなタブ (branch) の中身が出る** (Q3。復元から branch まで
  段を踏んで着く)
- **別の File を作ると新しいタブで開き、元の File のタブへ戻れる** (画面の側で File が変わったら
  タブを足す — `useTabNavigation` の「画面 → タブ」の向き)

変異で確かめたこと: 移動の段を 1 つも頼まないようにすると 16 件すべてが落ちる (既存の網も、
復元したタブから着くことに頼っている)。表示中の branch を「開いている File とシートのもの」に
限る判定 (`viewedBranchId`) を外しても落ちない — File を開き替えた直後の 1 回の描画で
「別の File の branch」を指すタブが一瞬できるだけで、次の段が trunk に置き換えるため最終の姿は
変わらない。判定は一瞬の誤ったタブと無駄な段を避けるためにある
