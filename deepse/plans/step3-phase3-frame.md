# step3 Phase 3: 画面の枠 — 設計

> ステータス: **Q1〜Q6 確定、実装中** / 作成日: 2026-10-02
> 親: [step3 実装計画](./step3-implementation.md) の Phase 3。入力は計画の Q2 (アドレスを 1 つ定義して
> タブ・Deep Link・inspector・検索結果・merger を載せる) と、仕様
> [design language](../architecture/step3/design-language.md) /
> [property editor](../architecture/step3/property-editor.md) / [merger](../architecture/step3/merger.md)。
>
> **データはほぼ変わらない** (計画 §2)。op の語彙には触れない。例外は 1 つ: commit と merge の commit に
> vector を任意の項目として足す (§2.1、F4)。

## 0. この Phase で入れるもの

| | 変更 | 計画の番号 |
| --- | --- | --- |
| 1 | **グラフ view のアドレス** `(file, sheet, branch, 切断面, highlight)` | S3-1 |
| 2 | **アプリ内タブ**。タブ = アドレスの並び。閉じても再現できる | S3-2 |
| 3 | **ヘッダ・右サイドバー**。property editor の置き場。左右サイドバーの幅変更と折り畳み | S3-3 |
| 4 | **ボディの multiple モード** (merger の前提) | S3-4 |
| 5 | 検索とプロパティを `GraphEditor` から割る (S0-2 の残り) | — |

---

## 1. コードを読んで判明した事実

🔵 = コードで確認 / ⚪ = 推論・仕様の読み・未確認

### F1: 画面の状態は「開いている 1 つの File」に束ねられている

🔵 いま見ているものは 3 つの state の組で表されている。

- `useFileSheetOperations` の `activeFile` (**`GraphFile` 全体**) と `activeSheetId`
- `useBranchOperations` の `activeBranch`

🔵 **branch を開くと `activeFile` の当該シートを branch の中身で差し替え**、戻るために trunk を
退避する (`preBranchFile`, `resetBranchState`)。つまり「branch を見ている」は、アドレスではなく
**`activeFile` の中身が化けている状態**として表されている。シートの追加が `branchOps.isTrunk` を
見て trunk に戻してから行う (`App.tsx` の `handleAddSheet`) のは、この化けの後始末である。

⚪ 帰結: アドレスを導入すると、この「化け」は**アドレスから projection した結果**に置き換わる。
退避と復元 (`preBranchFile` / `keepTrunkForReturn` / `branchViewRef`) は構造ごと不要になるはずである。

### F2: tap・定期同期・因果の発番器が `activeFile.id` 1 つに束ねられている

🔵 `useEventSyncTap(activeFile?.id ?? null, …)` が、書き込みの tap・定期同期 (`SYNC_POLL_INTERVAL_MS`)・
受信・`CausalClock` を **開いている File 1 つについてだけ** 持つ。別の File を開くと前の tap は
作り直される。branch の tap は trunk の `CausalClock` を共有する (`causal` オプション)。

⚪ 帰結が 2 つある。

- **タブで別々の File を同時に開くと、tap が File の数だけ要る。**背後のタブの File も同期を続けるか
  (続けないと、タブを切り替えたときに古い姿が見える) を決める必要がある
- **同じ File を 2 つの view (タブまたは multiple の pane) で開くとき、発番器は 1 つでなければならない。**
  別々に作ると同じ点 `(actor, seq)` を 2 回発番する — Phase 2 F4 (ブラウザのタブが同じ actor を
  名乗る) と同じ壊れ方が、**1 つのブラウザのタブの中で**起きる

したがって **「File ごとのセッション」(tap・発番器・同期) を「view」から切り離し**、開いている
view が参照する間だけ生かす (参照数で持つ) 形が要る。これが Phase 3 で最も重い変更である。

### F3: `GraphEditor` は File 全体を受け取り、File 全体を `onChange` で返す

🔵 `GraphEditor` は `file: GraphFile` と `activeSheetId` を受け、編集のたびに `onChange(updated)` で
File 全体を返す。App はそれを `activeFile` に入れる。編集の永続は `syncRecord` (tap) が別に行う。
`key` は `sheetId/branchId` で、切り替えるたびに作り直す。undo の履歴は `graphKey` ごとに App の
`undoStateMap` に退避する。

⚪ 帰結: 2 つの view が同じ File を開いて `onChange` で File 全体を返すと、**後から返した方が
前の方の変更を画面の state から消す** (op-log には両方載っているので、次の projection で戻る)。
view の内容は**共有の `activeFile` ではなく、view ごとにアドレスから projection したもの**にする。
もう一方の view の変更は、既にある `subscribeLocalChanges` (ローカル正典への追記の知らせ) で拾える。

### F4: 切断面で切る仕組みは branch の分岐点に既にある

🔵 Phase 1 で分岐点は `baseVector: VersionVector` になり、「batch がその時点に含まれるか」は
`covers(baseVector, batch.actor, batch.seq)` で決まる (`branchLog.ts`)。

⚪ 帰結: アドレスの切断面は **`'head'` (最新) か `VersionVector`** で表せる。任意の切断面での
projection は、分岐点での切り出しの一般化である。**過去の切断面は読み取り専用**になる
(そこへ書くと、その後の op と並ばない)。

🔵 **ただし vector を持つのは分岐点の commit (`baseVector`) だけである。**通常の commit と merge の
commit は scalar の `at` しか持たず、`isUpTo` は `clock <= at` で切る。これは Phase 1 で分岐点について
直したずれ (別の actor の batch が遅れて届くと、clock が小さいというだけで「その時点」に入る) を残している。

⚪ 帰結: merge は切断面の一つである (2026-10-02 利用者との確認)。「merge の直前/直後」「ある commit の時点」を
正確な切断面にするには、**commit と merge の commit にも vector を記録する** (`baseVector` と同じ
`heldMaxima`)。merger の pane との対応は、merge 元 = branch の最後の commit (切断面)、merge 先 = trunk の
`'head'` (動く。O3)、merge 後 = 解決用 branch の `'head'` (切断面ではない)。

### F5: ヘッダに当たるものは `GraphEditor` の中の浮きパネルである

🔵 🏷 (property) / 🔍 (検索) / Undo / Redo / グループ化 / 解除 / PNG は React Flow の
`<Panel position="top-right">` にあり、開閉の state (`propertyOpen` / `searchOpen`) も `GraphEditor` が持つ。
branch のコミット・merge のボタンは App の `position: fixed` の浮き要素である。

⚪ 帰結: 仕様のヘッダ (graph management) は「ボディで表示されているグラフ全体のオプション・アクション」
なので、**アクティブな view に対して 1 本**置くのが仕様の図 (layout.png) に合う。そのためには
undo/redo・グループ化・PNG・選択を **`GraphEditor` の外から呼べる口**にする必要がある。

### F6: ルーティングは無い。URL は OAuth が使っている

🔵 router は無い。`location` を触るのは OAuth の redirect だけである (`atproto/oauthAuth.ts`)。
⚪ Deep Link は FPR の後 (計画 §6)。Phase 3 ではアドレスを **直列化できる形** にしておくだけで、
URL には載せない (OAuth の callback との衝突を今は考えずに済む)。

### F7: 左サイドバーは幅 240 の固定である

🔵 `Sidebar.tsx` の `width: 240`。幅変更も折り畳みも無い。

---

## 2. 設計

### 2.1 アドレス

```ts
type GraphViewAddress = {
  fileId: FileId;
  sheetId: SheetId;
  branchId: BranchId | null;      // null = trunk
  cut: 'head' | VersionVector;    // 'head' は最新 (追随する)、vector は固定
  highlight?: { nodeIds: NodeId[]; edgeIds: EdgeId[] };
};
```

- **アドレスから view の中身を決める関数** `projectAddress(batches, address) → Sheet` を純関数で書く。
  ここが Phase 3 の正しさの中心なので **性質として書く**:
  - `cut = 'head'` の projection は、いまの projection と一致する
  - branch のアドレスで `cut = baseVector` を取ると、分岐点の姿と一致する
  - ~~切断面について単調~~ → 実装では「**切断面で切った姿 = その時点に実際にあった姿**」として書いた
    (S3-1 の記録)。単調性より強く、比べる相手 (各時点の実物) を生成器が作れる
- **commit に vector を足す** (F4)。`Commit.vector?: VersionVector` を任意の項目とし、`makeCommit` /
  merge の commit で `heldMaxima` を記録する。`isUpTo` は vector があればそれで切る。古い commit
  (vector 無し) は従来どおり `at` で切る
- **mode は持たない** (Q1)。view の種類が増えたら、そのとき項目を足す
- **編集できるか** はアドレスから導く: `cut` が vector なら読み取り専用。merger の元/先も読み取り専用
  (これは Phase 5 が pane に付ける)

### 2.2 File のセッションと view を分ける (F2, F3)

- **`FileSession`** = File 1 つにつき 1 つの tap・`CausalClock`・同期・受信。branch の tap はその中に持ち、
  発番器を共有する (いまと同じ)
- **セッションは開いている view が参照している間だけ生きる** (参照数)。背後のタブの File も同期を
  続ける (Q4)
- **view** = アドレス + その projection + undo の履歴 + 選択。編集は File のセッションの tap へ流し、
  自分の画面は自分で更新する。他の view の編集は `subscribeLocalChanges` で知って projection し直す

### 2.3 タブ

- タブ = アドレスの並び (single なら 1 つ、multiple なら複数) + レイアウト
- 左サイドバーからグラフを開くと新しいタブで開く (仕様)。既に同じアドレスのタブがあるとき (Q2)
- タブを閉じても変更は op-log にあるので、開き直せば再現される (仕様)。タブの並び自体を
  再読み込みの後に復元するか (Q3)

### 2.4 ヘッダ・右サイドバー・左サイドバー

- **ヘッダはアクティブな view に対して 1 本** (F5)。multiple モードではアクティブな pane が対象 (Q5)
- branch のコミット・merge はヘッダへ移す (浮き要素をやめる)
- **右サイドバー**: いまは property editor の pane 1 つ。仕様の timeline / inspector は後の Phase で
  pane として足す。**選択を view の state にする** (いまは React Flow の内部) ので、右サイドバーは
  アクティブな view の選択を読む。ボディ内の property editor とは併用する (仕様)
- 左右とも幅変更と折り畳み。幅と開閉は端末ごとの好みなので `localStorage` に置く

### 2.5 multiple モード

- ボディが複数の pane を持つ。pane は view 1 つ。**アクティブな pane** がヘッダと右サイドバーの対象
- Phase 3 では「任意の 2〜3 個のアドレスを並べられる」まで。**pane 間の選択の連動や差分・競合の表示は
  Phase 5 (merger)** が載せる。ここではそのための口 (pane のアドレスと選択を外から読める) だけ用意する
- 入口: Phase 3 では利用者が自分で multiple を作る入口を作るか (Q6)

---

## 3. スライス

| | 内容 | 画面の変化 | 検証 |
| --- | --- | --- | --- |
| **S3-0** ✅ | `FileSession` を切り出す (tap・同期・契機を React の外へ)。**見た目は変えない** | 無し | 既存の単体・App 結合・E2E がそのまま緑 |
| **S3-1** ✅ | アドレスと `projectAddress`。commit に vector を足す (F4) | 無し | 単体 + 性質 |
| **S3-2** ✅ | view をアドレスで持つ。`activeFile` の化け (F1) と退避・復元を撤去 | 無し | App 結合 (branch の出入り・受信・シート追加) |
| **S3-3** | タブ。File ごとのセッションの置き場 (参照数で生かす、同じ File は発番器を 1 つ)。アドレスから view を開く口と、view ごとの `projectAddress` | タブ帯 | App 結合 (2 つの File を開いて両方に受信が届く、同じ File の 2 view で発番が重ならない) |
| **S3-4** | ヘッダ・右サイドバー・左右の幅変更と折り畳み。検索とプロパティを `GraphEditor` から割る | 枠 | 単体 + E2E (WebKit) |
| **S3-5** | multiple モード | pane | App 結合 |

**S3-0 と S3-2 が重く、見た目が変わらない。**先に網 (Phase 0 の App 結合) で今の振る舞いを固めてから
動かす。特に「branch を開いたまま受信」「branch を抜けてシート追加」「別 File を開いたら tap が切り替わる」
は App 結合で先に書く。

---

## 4. 着手前に訊くこと (Q)

| | 問い | 既定案 → 確定 |
| --- | --- | --- |
| **Q1** | アドレスの `mode` は何を指すか | **→ 確定: mode は持たない (2026-10-02)。**当初は graphical / textual の view の種類を想定したが、textual view は一度作って外したもので、仕様に残っていたのは消し忘れ (利用者)。編集可否は切断面と pane の役割から導く |
| **Q2** | 既に同じアドレスを開いているタブがあるとき、左サイドバーから開いたら | **そのタブへ移る。**同じ branch の head を 2 つのタブで編集できても得が無く、undo の履歴が 2 つに割れて紛らわしい。別のタブで開きたいときの明示の操作 (例: 修飾キー) は残す → **確定: 既定案のとおり (2026-10-02)** |
| **Q3** | タブの並びを再読み込みの後に復元するか | **復元する** (`localStorage`)。ブラウザのタブごとに別にしたいなら `sessionStorage` → **確定: 既定案のとおり (`localStorage`、端末で共通) (2026-10-02)** |
| **Q4** | 背後のタブの File も同期を続けるか | **続ける。**止めると切り替えた瞬間に古い姿が見え、受信の競合通知も遅れる。費用は S0-3 のとおり取得に比例するので、開いている File の数で増える (Jetstream (O6) までの割り切り) → **確定: 既定案のとおり (2026-10-02)** |
| **Q5** | multiple モードのヘッダは 1 本か pane ごとか | **1 本 (アクティブな pane が対象)。**pane ごとに置くと merger の 3 pane で縦が足りない → **確定: 既定案のとおり (2026-10-02)** |
| **Q6** | Phase 3 で利用者が multiple を自分で作れるようにするか | **作らない。**Phase 3 では開発用の入口 (テストと実機確認用) だけにし、利用者の入口は Phase 5 の merger の起動にする。仕様の multiple は「特別な場合に用いる」ものなので → **確定: 既定案のとおり (2026-10-02)** |

## 5. 未決 (U)

- **U1**: 選択を view の state にすると、React Flow の内部の選択と二重になる。どちらを正にするか
  (S3-4 で、React Flow の controlled な選択で足りるかを確かめる)
- **U2**: 背後のタブの File の数に上限を置くか (Q4 の費用)
- **U3**: 過去の切断面の view をどこから開くか。入口は timeline view (FPR 後) なので、Phase 3 では
  アドレスとしては表せるが UI の入口が無い

---

## 6. 実施記録

### S3-0: `FileSession` を切り出す (2026-10-02)

`useEventSyncTap` の中身 (tap・同期のサイクル・同期の契機・別のタブの知らせ) を
`sync/fileSession.ts` の `FileSession` へ移し、フックは「1 つの File についてセッションを作り、
契機を張り、知らせを最新に差し替える」だけの包みにした。

#### 分かったこと

- **範囲を絞った。**当初は「File ごとのセッションの置き場 (参照数)」まで S3-0 に入れるつもりだったが、
  使う側 (タブ) が無いうちに作ると、形を想像で決めることになる。**S3-0 は React の外へ出すところまで**
  とし、置き場は S3-3 (タブ) で使う側と一緒に作る
- **発番器はセッションの外に置いたまま。**ログインで remote キューが付くとセッションは作り直されるが、
  発番器は File と actor が同じ限り同じものを使い続ける (以前のフックと同じ寿命)。S3-3 の置き場でも
  発番器は File ごとに 1 つで、セッションより長く生きる
- **知らせの差し替えでタイマーを張り直さなくなった。**以前は知らせ (`onReceived` など) が変わると
  `syncNow` が作り直され、契機の effect が張り直されて同期が 1 回余分に走っていた。知らせは
  「安定参照であること」と注記して避けていたが、構造として起きなくなった

#### 検証

単体 1805 件 (`fileSession.test.ts` の 3 件を追加)・App 結合 8 件・E2E が緑。既存の
`useEventSyncTap.test.ts` 30 件はそのまま通る (振る舞いの固定はこちらが持つ)。
`online` のリスナを外さない変異で「止めた後は同期しない」が落ちる。

### S3-1: アドレスと `projectAddress`、commit の vector (2026-10-02)

- `shared/src/events/address.ts`: `GraphViewAddress` / `Cut` (`'head'` か `VersionVector`) /
  `batchesWithin` / `isReadOnlyCut` / `projectAddress`
- **commit の vector**: `Commit.baseVector` を `Commit.vector` に改め、`makeCommit` (通常の commit・
  分岐点) と `makeMergeCommit` (追記後の trunk) の全てが記録する。`isUpTo` は vector があれば
  それで切る。**互換は取らない** (architecture §1.1) — Phase 1 以降に作った分岐点の `baseVector` は
  読み捨てられ、vector 無しとして clock で切られる (開発用のデータだけが該当する)

#### 分かったこと

- **1 つの vector が trunk と branch の両方に効く。**trunk・branch・判断ログは発番器を共有するので
  (Phase 1)、actor の seq は File の中で 1 系列である。branch のアドレスは「分岐点で切った trunk +
  切断面で切った branch」ではなく、**trunk も切断面で切る** — 切断面が分岐点より前なら、branch は
  「分岐する前の trunk」と同じ姿になる (性質として固定した)
- **単調性ではなく「その時点に実際にあった姿」を性質にした。**生成器が歴史を 1 本の時間で再生し、
  各手の後の実物を残せるので、比べる相手がある。単調性 (vector を大きくして消える要素は
  その間に消されたもの) より強く、書くのも易しい
- **branch の projection は metagraph の導出 node を持たない** (`branchSheet` が `projectBatches` を
  導出 node 無しで呼ぶ)。いまの画面と同じ振る舞いなので S3-1 では変えない。metagraph の branch を
  切る場面が出たら (Phase 4) 扱う

#### 検証

単体 1815 件 (address 8 件・branchLog 2 件を追加)・App 結合 8 件が緑。切断面を無視する変異で 3 件、
branch 側を切断面で切らない変異で 2 件が落ちる。

### S3-2: view をアドレスで持つ、`activeFile` の化けの撤去 (2026-10-02)

3 段に分けて commit した。

- **S3-2a** `GraphEditor` はシートを受け取りシートを返す (`sheet` / `onSheetChange`)。File 全体の
  受け渡しが、親に「開いている File の state」を 1 つしか持たせない一因だった
- **S3-2b** branch の中身を `useBranchOperations` の state (`branchSheet`) に移し、`activeFile` は
  常に trunk の姿だけを持つ。撤去したもの: 退避 (`preBranchFile`)・受信した trunk の控え直し
  (`keepTrunkForReturn` / `isBranchOpen`, 2026-09-17 の修正)・シート追加前に trunk を取り戻す返り値
  (`resetBranchState` の戻り値)。App は描く方 (trunk / branch) のシート・編集の宛先・再 seed の契機を
  同じ分かれ目 (`viewingBranch`) で切り替える
- **S3-2c** `addressKey` (アドレスの同一性。highlight を含めない、vector は actor 順) を足し、App は
  いまの選択をアドレス (`viewAddress`) として組み立てる。`GraphEditor` の作り直しと undo の履歴の置き場は
  `addressKey` で決める

#### 分かったこと

- **撤去の前に網を張った。**退避と復元が守っていた振る舞いを、App 結合で画面の側から 3 件固定した
  (trunk に戻ると branch のノードは出ない / branch を開いたままシートを足しても trunk に移らない /
  branch を開いている間に届いた trunk の編集は戻ると見える)。いずれも今のコードで緑を確かめてから
  撤去した。branch を開くときに `activeFile` を branch の中身で差し替える (昔の形に戻す) 変異で、
  3 件目が落ちる
- **2 つの受信の epoch は「足す」から「描く方を選ぶ」に変えた。**以前は trunk と branch の epoch の和を
  渡していたので、branch を開いている間の trunk の受信でも branch の画面が再 seed された (中身は同じ
  なので害は無かった)。いまは描いている方の epoch だけを渡す
- **範囲を絞った。**「アドレスから view を開く口」と「view ごとに `projectAddress` で中身を求める」は、
  view が 1 つしか無いうちは使い手がいない。タブ (S3-3) で、置き場 (S3-0 から送った) と一緒に作る

#### 検証

単体 1816 件・App 結合 11 件 (網の 3 件を追加)・E2E が緑。単体は撤去した仕組みのテスト
(控え直し・復元の返り値) を消し、`branchSheet` / `onBranchSheetChange` で同じことを見る形に書き換えた。
