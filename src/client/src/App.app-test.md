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
  `openFileNamed` / `openBranch` は**選ばれているタブが既に行き先なら押さず**、画面が着くのを待つ。
  復元した直後の branch のタブの名前には branch の名前がまだ無い (一覧が読まれてから付く) ので、
  `openBranch` は名前ではなく「branch のタブか」で決め、名前が付くまで待つ。名前で決めると、
  一覧の読み込みと競って開いている branch の行を押し、trunk に戻すことがある (S3-3c で実際に起きた)

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
- **背後のタブの File も同期を続け、切り替えたときには届いている** (Q4, 2 人・PDS 経由)。bob は
  共有の File のタブを背後に回し、自分の File を前に出したまま同期する。alice の編集が**切り替える
  前に**手元の正典に入っていることを見る — 切り替えた後に画面に出るだけなら、開いたときの同期で
  取りに行った場合と区別できない

変異で確かめたこと: 移動の段を 1 つも頼まないようにすると 16 件すべてが落ちる (既存の網も、
復元したタブから着くことに頼っている)。表示中の branch を「開いている File とシートのもの」に
限る判定 (`viewedBranchId`) を外しても落ちない — File を開き替えた直後の 1 回の描画で
「別の File の branch」を指すタブが一瞬できるだけで、次の段が trunk に置き換えるため最終の姿は
変わらない。判定は一瞬の誤ったタブと無駄な段を避けるためにある

背後のタブの宣言 (`holdBackground`) を空にする変異で、Q4 の 1 件が落ちる。

### 置き場に載せ替えて出た失敗 (S3-3c)

前に出ている tap が置き場からセッションを借りるようになって、**同期が描画のうちに始まる**
(以前は effect で始まった)。すると File を開いた直後の受信が、`activeFileRef` を写す effect より
先に着き、差し替えが「開いていない File」として見送られた。さらに見送ったのに「画面が古い」の
物差し (他 actor の batch 数) を進めていたので、次の確認 (`refreshIfStale`) も古い画面を新しいと
見なした。S3-2 の網「branch を開いている間に届いた trunk の編集は、trunk に戻ると見える」が
これを捕まえた。直したのは 2 点: ref を描画の中で写す、物差しは画面に入れたときにだけ進める

## ヘッダ (step3 Phase 3 S3-4a)

### なぜ

ヘッダ (undo・グループ化・PNG・検索・property editor の on/off) と、検索の窓・ボディ内の property
editor を `GraphEditor` の外へ出した。canvas に触れる操作は `GraphEditor` が出す口
(`GraphEditorControls`) を通り、property editor の対象は `GraphEditor` が知らせる選択の写しである。
**口と写しが配線されていなくても、画面は普通に描かれる** (ボタンが押しても何もしないだけ) ので、
押した結果が canvas と op-log に届くことを見る。以前のツールバーを押すテストは 1 件も無かった

### テストケース

- **ヘッダの Undo で置いたノードが消え、Redo で戻る** (口が届く)
- **🏷 を on にしてノードを選ぶと property editor が出て、足したプロパティが op-log に載る**
  (選択の写しが外へ届き、編集が口を通って op になる)
- **検索の窓は、別の view (タブ) へ移ると閉じる** (以前は `GraphEditor` の再マウントで閉じていた。
  外へ出したので明示に閉じる — 利用者判断 2026-09-20 の「別のグラフへ移った時点で結果は無効」)

変異で確かめたこと: 選択を知らせないと 2 件目が、view が変わっても検索を閉じないと 3 件目が落ちる。

**要素を `toBeNull()` に渡さない。**落ちたときに bun が要素を差分に出そうとし、React の fiber を
辿って DOM 全体を展開するので、CPU を使い切ったまま終わらない (S3-4a の変異で実際に起きた)。
`queryBy… === null` を `toBe(true)` で見る

## 右サイドバー (step3 Phase 3 S3-4b)

### なぜ

右サイドバーの property editor は、ボディ内のものと**同じ選択の写しを読み、同じ口で書く**
(仕様: 両方を併用する)。どちらか片方だけが配線されていても見た目は出るので、書いた結果が op-log に
載ることと、もう一方にも同じ値が出ることを見る

### テストケース

- **右サイドバーの property editor で足したプロパティが op-log に載り、ボディ内のものにも出る**

変異で確かめたこと: 右サイドバーの書き込みを口に繋がないと落ちる。

**ノードは `selectFirstNode` (click だけ) で選ぶ。**`user.click` は pointer の押下から React Flow の
ドラッグ (d3-drag) を始め、happy-dom の mousedown が `view` を持たないので d3-drag が例外を出す。
テストは通るが、出力に例外が並ぶ

## 別のタブで開く明示の操作 (step3 Phase 3 S3-4c)

### なぜ

Q2 は「同じアドレスは既存のタブへ」を既定にし、**別のタブで開きたいときの明示の操作を残す**と決めた。
モデル (`openTab` の `forceNew`) は S3-3a からあったが、サイドバーの選択が click の event を渡して
いなかったので画面から使えなかった。⌘ / Ctrl で選んだときだけ新しいタブを足す

### テストケース

- **⌘ を押しながらシートを選ぶと、同じアドレスでも新しいタブで開く**。押さずに選ぶと、これまで
  どおり既存のタブへ移る (増えない)
- **⌘ を押しながら開いている branch を選ぶと、trunk に戻らずその branch を別のタブで開く**。
  開いている branch の行を押すと trunk に戻る、という既存の働きは修飾キーの無いときだけにした

変異で確かめたこと: 修飾キーを見ないようにすると 2 件とも落ちる。

branch の行は**ボタンの role で引く**。文字で引くと、ヘッダの branch の状態 (⎇ b1) にも当たって
「複数ある」で待ち続ける (S3-4a で branch の状態をヘッダに移したため)

## multiple モード (step3 Phase 3 S3-5)

### なぜ

multiple のタブでは、**編集できるのはアクティブな pane だけで、ほかは見るだけ**の部品
(`PassivePane` → `GraphPreview`) で描く。見るだけの pane はアドレスから自分で中身を求め、正典が
動くたびに読み直す。この形が壊れると次のことが起き、どれも画面では「少し古い」程度にしか見えない。

- 見るだけの pane が、アクティブな pane の編集・merge で動いた正典を読み直さない
  (BroadcastChannel は送り手自身に届かないので、**同じタブの中の知らせ**が要る)
- 前に出しても画面の仕組みが移らず、ヘッダが前の pane を操作し続ける

### テストケース

開発用の入口 (`VITE_DEV_PANES=true`、Q6: 利用者の入口は作らない) を開け、trunk に 1 つ、branch b1 に
1 つ足して commit し、b1 のタブにヘッダの「⧉」から trunk のタブを並べる。

- **他のタブを並べると、アクティブな pane は編集のまま、並べた pane はその姿を見せる** (b1 は 2 つ、
  trunk は 1 つ。ヘッダの branch の操作は b1 を対象にしている)
- **アクティブな pane で merge すると、並べた trunk の pane が読み直して merge 後の姿になる** (1 → 2)
- **前に出すとアクティブが入れ替わり、pane を閉じると single に戻る** (ヘッダから branch の操作が
  消え、b1 は見るだけになる)
- **開発用の入口が閉じていれば「⧉」は出ない**

変異で確かめたこと: 同じタブの中の知らせを出さない変異と、見るだけの pane が知らせで読み直さない
変異の、どちらでも 2 件目が落ちる。

## template graph (step3 Phase 4 S4-1b)

### なぜ

template graph のシートを読み替えた種類 (`templateFromSheet`) は、**当てたシートを描く `GraphEditor` に
届いて初めて**種類のメニュー・既定値になる。解決 (`useResolvedTemplates`: 切断面で op-log を読む) と、
「シートを追加」のダイアログで切断面を作るところが配線されていなくても、画面は普通に描かれる
(種類のメニューが出ないだけ) ので、作った node の op まで見る。

### テストケース

- **template graph の label の node が、当てたシートの種類のメニューに出て、作った node は種別と既定値を持つ**:
  「▾ → + template graph」で template graph を作る (印が付き、「+ branch」が出ない) → 「主張」(既定値
  owner = '') を置く → 「+ シートを追加」のダイアログで当てる → 種類のメニューの「主張」で node を作る →
  op-log のその node が label「主張」・種別 (`template.<SheetId>.kind` = 主張の NodeId)・既定値を持つ

- **Toulmin model を追加すると種から template graph ができ、当てたシートで Toulmin の種類を使える** (Q1):
  「▾ → + Toulmin model を追加」で 5 つの種類の node を持つ template graph ができ (ふつうの template graph
  として印が付く)、当てたシートで「主張」を作ると、種別の値は**複製された** template graph の node の id、
  名前空間はその template graph になる (作り込みの `jp.co.metabolics.toulmin` ではない)

template graph の中身は、React Flow の中の文字の入力を避けて、**別のタブが書いたものとして正典に入れて
知らせる** (S2-4 と同じ手)。

変異で確かめたこと: `GraphEditor` に解決した template を渡さない変異と、既定値を書かない変異で 1 件目が、
種の中身を積まない変異で 2 件目が落ちる。

## metagraph (step3 Phase 4 S4-2b)

### なぜ

metagraph の graph node はシートの一覧から導くもので、node の op では変わらない。画面の操作を
**シートの操作に読み替える** (`splitMetagraphEvent`) ことと、自分でシートを足す・消す・名前を変えた後に
**いまの一覧で graph node を導き直す** (`refreshDerivedNodes`) ことのどちらが欠けても、画面は普通に描かれる。
欠けたときの壊れ方は「消したはずの graph node が戻る」「足したのに出ない」で、どちらも静かである。

### テストケース

File を作って index を開く (Sheet 1 と index 自身が graph node として並ぶ, Q4)。

- **File を作ると index があり、Sheet 1 と index 自身が graph node として並ぶ**
- **「グラフ」で graph node を足すとシートが増え、metagraph に留まったまま graph node が出る** (足したシートは開かない)
- **graph node を消すと、確認の後にシートが消える。断れば消えない** (シートの削除は undo に入れないので確認を挟む)
- **graph node を選んで F2 で名前を変えると、シートの名前が変わる** (サイドバーにも出る)
- **graph node をダブルクリックすると、そのシートを新しいタブで開く** (Q6)

ノードの選択と削除は、React Flow のドラッグを起こさないよう `fireEvent` (click / keyDown) で送る。
ダブルクリックは**本文の要素** (`data-node-body`) に送る — React Flow の外枠に送っても本文のハンドラに届かない。

変異で確かめたこと: 読み替えを渡さない変異で削除と名前の変更が、導き直さない変異で追加と削除が、
ダブルクリックを常に文字の編集にする変異で開く件が落ちる。

**変異はリポジトリの直下から走らせる。**`src/client/src` から `bun test` を走らせると、直下の設定
(happy-dom の準備) が読まれず、変異と関係ない件まで全部落ちて「全部捕まった」ように見える (S4-2b で実際に起きた)
