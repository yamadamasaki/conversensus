# step2 実装計画

> ステータス: **草案 (レビュー待ち)** / 作成日: 2026-08-30
> 入力: [step2 要件仕様](../requirements/spec-step2.md) と `../requirements/spec/` 配下 5 本
> (participation / merging / dialogueToResolveGraph / propertyEditor / searching / template)。
> 仕様は 2026-08-28 のレビューで決着済み。本計画はそれを実装の順序に落とすものである。
>
> **フェーズを横断する判断は [step2 アーキテクチャ](../architecture/step2.md) にある。**
> 本計画は Phase の分割と順序を扱い、アーキテクチャは「あるフェーズで決めて別のフェーズが
> 支払う」判断 (多アクタの読み取りモデル、projection の 2 段構え、collection の割り当て、
> 競合の扱いが step1 から変わる点) を扱う。

step2 の目標は **共同作業できるようにすること**である。step1 が「1 人が複数端末で使う」までを
op-log の正典化で成立させたのに対し、step2 は **複数の actor が別々の repo に op-log を持ち、
それを各自の手元で畳む**ところまで進む。

## 0. 完了基準 (仕様より)

1. 2 アカウントが同一 File に参加し、双方の編集が相手のグラフに反映される
2. 一方が branch を切って merge し、競合したときに DtR graph が起動し、双方の承認で再 merge される
3. 一方が参加を取りやめた後、その操作が相手に反映されなくなる

**1 と 3 は名簿と多アクタ同期で揃う。2 だけが DtR graph という新しい大物を要求する。**
この非対称が Phase の順序をほぼ決めている。

---

## 1. コードを読んで判明した、計画を規定する 4 つの事実

計画の形はこの 4 つで決まった。仕様からは読めないが、着手順と工数を左右する。

### 事実 1: remote の読み書きが `currentDid()` に閉じている

`src/client/src/atproto/collections.ts` の `listRecords` / `getRecord` / `putRecord` は
**5 箇所すべてが `repo: currentDid()`** である。step1 は「自分の repo だけを読む」前提で
組まれており、他者の repo を読む口がどこにも無い。

step2 で最も広く波及するのはここである。`collections.ts` を repo 引数を取る形へ開き、
その上に「誰の repo を、どの期間だけ読むか」を決める層 (= 名簿) を載せることになる。

**ただし波及の形は「広く浅く」ではなく「深く狭く」である** (2026-08-30 の検証で確認)。
`collections.ts` を import するのは `atproto/index.ts` だけで、その API を実際に叩くのは
**実質 `atprotoSyncProvider.ts` の 4 箇所**にすぎない。`rangeFetch` は既に
`ListRecordsPage` を**注入で受け取る**形をしており (`collections.ts` が
`(params) => listRecordsPage(NSID.batch, params)` を渡している)、`remoteFilter` /
`discoverRemoteFiles` / `receiveRemoteBatches` は `collections.ts` を知らない。

つまり **repo 引数を通す継ぎ目は既に空いている**。Phase 0 の作業は当初の見積もりより小さい。

### 事実 2: 同期のトリガに定期ポーリングが無い

同期は**起動時・`online` イベント・手動**でしか駆動しない (`setInterval` は client に 1 つも無い)。
仕様が step2 の同期方式として挙げる「定期的なポーリング」は未実装である。

既存の Issue #202 (「他の端末・他の窓の編集が、ファイルを開き直すまで反映されない」) は
この症状そのものなので、**多アクタ同期の Phase で一緒に回収する**。

### 事実 3: node は label を持たない

`unified.ts` の op に `node.setLabel` は無い。node が label を持つのは
[template](../requirements/spec/template.md) で追加されるものであり、
**Phase 5 (template) は Phase 6 (DtR) より前に来る。**ただしその根拠は node label ではない。

- `dialogueToResolveGraph.md` は「resolve graph の実装は node label に依存する」と書くが、
  **これは順序の根拠として弱い**。resolve graph が扱う競合は 7 種あり node label はその 1 つで、
  残り 6 種だけでも resolve graph は成立する
- **本当の根拠は dialogue graph の側にある。** `template.md` は「対話グラフに対して作り込まれた
  特定の template が最初から適用されていても良い」と書いており、**toulmin template は
  dialogue graph の中身そのもの**である。Phase 5 が無いと Phase 6 の dialogue graph が空箱になる

node label は「無いと仕様の一項目 (競合 7 種のうち 1 つ) を欠く」という位置づけに留まる。

`node.setLabel` は **op 語彙の追加**なので、同期を触る Phase 2 とは時期を重ねない。

### 事実 4: 競合検出は content + structure まで済んでいるが、既定の振舞いは未着手

`merge.ts` は content の並行変更 (step1) に加えて structure の競合 (#206/#207, 削除依存と
並行変更) まで検出する。プロパティの競合はキー単位である (#208)。一方で仕様が
step2 で要求する次の 3 つは**まだ無い**。

| 要求 | 現状 |
| --- | --- |
| 決着までの既定を **add-wins** にする (削除より追加を優先) | projection は clock-LWW のまま。#207 で意図的に対象外にした |
| **カスケード削除の推移的な検出** | `mergeBranches` は base のグラフを受け取らないので、削除された親の子孫への参照を追えない |
| **layout の競合検出** (通知のみ、DtR は起動しない) | layout は対立にしていない |

DtR graph はこの 3 つの上に乗るので、DtR の前に片付ける必要がある。

### 事実 5: branch / commit / merge は remote に存在しない (2026-08-30 のレビューで判明)

**これが計画で最も大きい抜けだった。**

- `BranchMeta` / `Commit` は**ローカルデーモンの SQLite の行**である (`src/server/src/eventStore.ts`
  の `branches` / `commits` テーブル)
- branch batches は **remote へ push しない専用 file_id** に貯まる。これは step1 Phase 5 の
  **明示的な不変条件**である (`branchProjection.ts`「local 専用で remote へ push しない」、
  `useBranchOperations.ts`「remoteQueue は渡さない = branch batches は remote へ出ない」)
- PDS の `branch` / `commit` / `merge` NSID は step1 Phase 6 p6-5b で消費者ごと退役しており、
  **参照が 0 件**である

つまり現状は「**merge の結果は共有されるが、merge という出来事も branch も共有されない**」。
単一端末では問題にならなかったが、共同作業では「相手が branch を切って merge しようとしている」
ことが相手に見えない。

**これは完了基準 2 に直撃する。**「一方が branch を切って merge し、競合したときに DtR graph が
起動し、**双方の承認**で再 merge される」— 相手が branch も DtR graph も見られなければ、
承認する対象が存在しない。

したがって **branch / commit / merge の op-log 昇格と同期**が step2 に要る。これは当初の
Phase のどこにも入っていなかった。**Phase 3 が負う** (下記 §2 の注記)。

### 事実 7: 「誰がこの File を作ったか」が op-log に無い

**名簿の最初の 1 人が決まらない。**

- `unified.ts` の file op は `file.setName` / `file.setDescription` / `file.remove` の 3 つで、
  **`file.create` が無い**。File は batch の `fileId` から暗黙に生まれる
- genesis batch の actor は **`GENESIS_ACTOR = 'genesis'` という固定文字列**である
  (決定論的な batch id のため、actor / timestamp / clock を id に含めない設計)。
  つまり**作成者の DID は op-log のどこにも載っていない**

名簿の招待 op の pre 条件は `a ∈ f.participatingActors` である。最初の 1 人が決まらないと、
**最初の招待が pre 条件で落ちて誰も参加できない。**完了基準 1 が成立しない。

既存 File (step1 で作ったもの) の名簿を bootstrap する経路も同じ理由で無い。

### 事実 6: merge は競合を検出しても止まらない

`mergeBranchOnOplog` は `mergeBranches` から `conflicts` を受け取った後、**無条件に**
再スタンプした batch を trunk へ追記する。追記された batch は `catchUpRemote()` で remote へ出て、
他 actor が既に畳んでいる。**追記型 op-log に取り消しは無い。**

仕様の「content 競合 → **強制起動**」「承認したら**再** merge が可能になる」という言い回しは、
**merge がまだ trunk に着地していない**ことを前提にしている (= staged merge)。
これは永続化の問題ではなく **merge 経路の作り直し**である。

### 事実 4 の補足: 多アクタの全順序は既に決まっている

`orderBatches` は `(clock, actor, batchId)` で全順序を作る (Phase 4d-3)。
**actor をまたいでも決定論的に畳める**ということなので、implicit merge の中核は
既に踏めている。ここが未定だったら Phase 0 の spike は重かったが、そうではない。

---

## 2. Phase 一覧

| Phase | 内容 | 完了基準への寄与 | Exit |
| --- | --- | --- | --- |
| **0. 土台** | 2 アカウントのテスト環境。`collections.ts` の repo 引数化 (振舞いは変えない)。**末尾に U6 スパイク** | — | 2 アカウントで手動同期が回る / 既存テスト緑 / スパイクの判定が出る |
| **1. 判断ログ (participation)** | participation collection 新設。**名簿専用ではなく「pre 条件検証つきの判断ログ」として切る**。招待/承認/取消の op と projection。参加コード。招待 UI | 1, 3 | 招待→承認で名簿に載り、取消で外れる |
| **2. 多アクタ同期 (implicit merge)** | 名簿から参加者と期間を引いて他者の repo を読む。DID ごとの cursor。定期ポーリング (#202 回収)。**branch batch を remote に出すかの判断** | **1, 3 達成** | 2 アカウントの編集が相手のグラフに出る |
| **3. 競合と器** ⚠️**最大** | add-wins 化・カスケード削除の推移的検出・layout の競合検出・通知 UI・fork。**+ branch/commit/merge の op-log 昇格と同期 (事実 5)**・**merge の適用点の決定 (事実 6)** | 2 の前提 | 3 種別が扱い分けられ、**branch と merge が相手に見える** |
| **4. property editor** | system/extension/custom の分類と一覧・編集 UI | (独立) | custom を追加/変更/削除できる |
| **5. template (toulmin) + node label** | `node.setLabel` op と node label の表示・編集。toulmin template を直書き。種別メニューと接続警告 | 2 の前提 (事実 3) | **通常の sheet に** toulmin template を当てて種別が選べる |
| **6. DtR graph** | dialogue graph / resolve graph、merge・fork への紐付け、呼び出し・承認・キャンセル・再 merge・保留 | **2 達成** | 競合 → DtR 起動 → 双方承認 → 再 merge |
| **7. searching** | 部分一致検索と結果一覧、グラフ内ハイライト | (独立) | label/content/property を横断して引ける |

**クリティカルパス**: 0 → 1 → 2 → 3 → 5 → 6。
**Phase 4 と 7 は独立**なので、クリティカルパスの待ちが出たとき、あるいは大物 (3, 6) の前後に
息継ぎとして差し込む。どちらも既存の語彙の上に載るだけで、op 語彙も同期も触らない。

> **2026-08-30 のレビューで重心が動いた。**当初は Phase 6 (DtR) を最大と見ていたが、
> 事実 5 / 6 により **Phase 3 が「器を作る Phase」になり、step2 で最大**になった。
> DtR が乗る土台 (branch/merge が同期される・merge の適用点が決まっている・fork が相手に届く) を
> ここで作る。**対して Phase 6 は縮む** — 「既存モデルに乗るか設計で確かめる」が消え、
> 決着済みの器の上に DtR の中身 (2 つのグラフ・承認・ワークフロー・UI) を作るだけになる。
>
> Phase 3 と Phase 6 は着手時に単独の設計文書へ分割する
> (`step2-phase3-*.md` / `step2-phase6-*.md`。step1 の Phase 4d/5/7 と同じ形)。

---

## 3. 各 Phase の中身

### Phase 0: 土台

**目的は Phase 1 以降の前提を、振舞いを変えずに用意すること。**ここで機能を足さない。

- **テスト環境**: VPS の PDS に 2 つ目のアカウントを作る (招待コードは現行どおり curl)。
  手順は `deepse/requirements/user-test-environment.md` に反映する
- **`collections.ts` の repo 引数化**: `currentDid()` を既定値にしたまま repo を引数で
  受けられるようにする。**この Phase では呼び出し側を変えない**ので観測される振舞いは同じ。
  Phase 2 の変更を「誰の repo か」の一点に絞るための準備である
- **[architecture/step2.md](../architecture/step2.md) を確定させる** (横断する判断のみ)
- **U6 スパイクを Phase 0 の末尾で回す。**判定 1 (他 actor の repo を読む) には repo 引数化が
  要り、それは Phase 0 自身のタスクなので、**Phase 0 の Exit 直前がこれを回せる最早の時点**である。
  使い捨てのスパイク 1 本 + 型スケッチ 1 本、**production コードの変更はゼロ**にする
  (Phase 0 の「振舞いを変えない」と両立させる)

  > **旧案「DtR graph を branch として書いて読み戻せるか」は実装してはならない。**
  > branch batches は remote へ出ないので (事実 5)、local で完結して通ってしまい
  > **誤った Go 判定を出す**。確かめるべきは次の 2 つである。
  >
  > - **P1**: 新しい `sheetId` を DtR の器としたとき、**他 actor の手元で** ①読める
  >   ②既存 File の projection が壊れない ③**File が勝手に増えない**
  >   (`discoverRemoteFiles` は未知の fileId を新しい File として materialize する)
  > - **P2**: pre 条件つき承認 op を projection に混ぜたとき、`projectBatches` /
  >   `projectFile` に**分岐を足さず routing だけで**分離できるか
  >   (`isFileOp` → `foldFileStructure` の前例と同じ形に置けるか)
  >
  > **P2 は実施済 (2026-08-31)。判定は Go** → [u6-p2-report](../spikes/u6-p2-report.md)。
  > 分岐は要らず、**判断の畳み込みの結果を述語にして、グラフの畳み込みに入れる前に落とす**
  > 形で足りる。依存は一方向 (判断 → グラフ) で循環しない。
  > **ただし前提が 1 つ増えた** — pre 条件が「この操作より前」である以上、
  > **判断ログとグラフの op-log は同じ clock 空間を共有しなければならない。**
  > Phase 1 で participation collection を新設するとき、別の採番を作ってはならない。
  > **P1 は 2 アカウント環境待ちで未実施。**P2 だけで U6 を確定させてはならない。
- Phase 1 の設計 (participation の lexicon と op) を書き出す

**Exit**: 2 アカウントで手動同期が回ることを実機で確認 / 既存テストが緑のまま。

### Phase 1: 名簿 (participation)

仕様: [participation](../requirements/spec/participation.md)

- **collection を新設する**。グラフの batch collection と分けるのは仕様の決定どおりで、
  決め手は**畳み込みの意味論が違う**こと — 名簿の op は pre 条件を検証して満たさないものを
  **捨てる**が、グラフの op は LWW / add-wins なので「無効な op」の概念がない
- **⚠️ 名簿専用ではなく「pre 条件検証つきの判断ログ」として切る。** DtR の**承認**も同じ
  「検証して捨てる」畳み込みなので、狭く切ると Phase 6 で 3 つ目の collection が要る。
  広く切るコストは命名と lexicon の形だけで、**改名の最後の機会がこの Phase である**
  ([architecture §4.3](../architecture/step2.md))
- **名簿は自分の repo だけでは作れない。**「a が a' を招待した」op は a の repo にあるので、
  **名簿に載っている全 actor の participation を読む**。これは不動点計算になる
  (誰を読むかを名簿が決め、その名簿は読んだ結果で決まる)。**何パス回すかをここで決める** (U1)
- **⚠️ 名簿の bootstrap** (事実 7)。「file を作った actor が自動的に参加する」を成立させる
  手段が無い。**最初の 1 人を決める方法をここで作る**。選択肢は「`file.create` 相当の op を
  足して作成者の DID を載せる」「名簿側の genesis op で最初の参加者を宣言する」など。
  **既存 File (step1 で作ったもの) の bootstrap も同時に要る**
- **op**: 招待 / 承認 / 参加取りやめ / 取消 (招待・参加の前後を問わず同じ「取消」)
- **被招待者 DID が自 PDS に属することの検証。** 仕様は他 PDS のアカウントの招待を
  「やらない」ではなく**「無効とする」**と書いている (`spec-step2.md`)。pre 条件の一部である
- **ハンドル名 → DID の解決** (`com.atproto.identity.resolveHandle`)。UI の入力はハンドル名だが、
  参加コードに載るのは DID である
- **projection**: clock 順に畳みながら pre 条件を検証し、満たさない op を捨てる。
  これで「招待されていないアクタの承認は無効」と「取り消し合いは誰の手元でも同じ結論」が
  同時に決まる。**ここが名簿の中核なので、テストは pre 条件の網羅から書く**
- **参加コード**: 招待者 DID + 被招待者 DID + FileId をエンコードしたもの。秘密ではない
  (本人以外の承認は projection で落ちる) ので、暗号的な要求は無い
- **UI**: invitation ダイアログ (一覧 + 生成) と participate ボタン。一覧には
  **状態** (sent / accepted / revoked / resigned / **invalid**) と **action**
  (preview / accept / revoke / resign、立場によってグレイアウト) が要る。
  参加コードは長いので表示せず copy ボタンだけでもよい
- **`invalid` を表示するには、名簿 projection が「確定した名簿」だけでなく
  「捨てた op と、その理由」も返す必要がある。**捨てて終わりにすると invalid が画面に出せない
- **`preview`** は「まだ参加していない File について招待者の repo を読む」操作である。
  [architecture §2](../architecture/step2.md) の「読む資格は名簿への所属と独立」がここに乗る

**Exit**: 招待 → 承認で名簿に載り、取消で外れる。取り消し合いを両方の端末で畳んで結論が一致する。

### Phase 2: 多アクタ同期 (implicit merge)

仕様: [merging](../requirements/spec/merging.md) の implicit merging

- **名簿を先に読み、グラフを後に読む**。参加期間が確定していないと「その期間の op-log だけ」を
  取れないので、読む順序はこの向きに固定される
- **他者の repo を読む**: Phase 0 で開いた repo 引数を使う。`rangeFetch` の cursor を
  **DID ごと**に持つ
- **期間フィルタ**: 参加していない期間の batch は畳まない。`remoteFilter` の隣に置く
- **再参加時の同期義務。** 非参加期間の操作に依存する新しい操作は相手にエラーを起こすので、
  actor が**再度参加する前に標準 projection へ同期しなければならない** (participation.md
  ワークフロー 6-3)。検出と誘導をどう作るかを決める
- **implicit merge は op-log に書かない**。冪等な導出なので記録すべきものがなく、書くと
  参加者の数だけ操作が増殖する。**同期のたびにその場で畳む**
- **定期ポーリング**: 仕様が step2 の同期方式と定めたもの。#202 をここで回収する
- **blob**: step1 を踏襲 (PDS 内の blob を利用)。**他アクタの repo にある blob を
  どう引くかは未決** (§5 の U2)
- **⚠️ branch batch を remote に出すかの判断** (事実 5)。step1 §9.2 の「branch は local 専用」は
  **単一端末前提が消えた時点で失効している**ので、多アクタ同期を作るこの Phase で
  撤回するか維持するかを明示的に決める。**Phase 3 の fork がこの答えに依存する**
- **他 actor の branch を File として materialize しない仕組み。** branch の file_id を remote に
  出すと `discoverRemoteFiles` がそれを未知 File として拾い、左サイドバーに File が増える。
  fileId 単位の走査に「branch は File ではない」の判別が要る (§9.2 撤回の副作用として必ず出る)

**Exit**: **完了基準 1 と 3 が揃う。** 2 アカウントの編集が相手のグラフに出て、
参加を取りやめると出なくなる。**加えて #202** — 同一ユーザの別端末・別窓の編集が、
ファイルを開き直さずに反映される。

> #202 は step2 の仕様には無い (単一ユーザの問題である)。機構が同じなので相乗りさせるが、
> **Exit に条件を明示しないと完了判定が曖昧になる**ので、独立した受入条件として書いておく。

### Phase 3: 競合と器 ⚠️ step2 で最大

仕様: [merging](../requirements/spec/merging.md) の「検出後の既定の振舞い」「layout の競合」

**当初は「競合の 3 段構え」だけの Phase だったが、2026-08-30 のレビューで
「DtR が乗る器を作る Phase」に拡張した** (事実 5 / 6)。DtR graph も fork も、この Phase が
作る土台の上にしか乗らない。着手時に単独の設計文書へ分割すること。

- **add-wins 化**: 決着までグラフが表示できなければならず、clock-LWW のままだと DtR で
  議論する前に対象が消える。「判断を保留するなら情報を消さない方に倒す」
- **カスケード削除の推移的検出**: `mergeBranches` が base のグラフを受け取る形にする
  (シグネチャ変更)。add-wins 化と同じ Phase に置くのは、どちらも「削除をどう扱うか」の
  一つの判断だからである。

  > **仕様側にも反映済** (2026-08-30、S3)。`merging.md` の削除依存に S1' / S2' を足した。
  > 判定の入力が「op に書かれた id」ではなく「分岐点の状態にカスケードを当てた集合」に
  > なるので、シグネチャ変更はその帰結である
- **layout の競合検出**: 検出して**通知するだけ**。DtR は起動しない。毎回の位置調整で
  DtR がノイズに埋まるのを避ける
- **通知 UI**: structure と layout の競合をユーザに見せる。structure はここから手動で
  DtR を起動できる (Phase 6 で接続)
- **implicit merge の fork**: 競合したら fork して通知する。**fork は op-log に書く** —
  implicit merge 自体は導出だが、fork は「この競合を保留した」という判断の記録であり、
  書かないと同期のたびに解決済みの fork が復活する

**ここから下が 2026-08-30 に足した「器」の作業である。**

- **⚠️ branch / commit / merge の op-log 昇格と同期** (事実 5)。fork を「書く」と決めた以上、
  器である branch が同期対象でなければ**書いても相手に届かない**。新 op 語彙を伴うので
  **Phase 5 (`node.setLabel`) と語彙変更が重なる** — Phase 3 内で語彙追加を先に閉じるか、
  Phase 5 を前倒すかの判断が要る。**工数は DtR 本体より大きい可能性がある**
- **⚠️ merge の適用点の決定** (事実 6)。`mergeBranches` のシグネチャを変更するのと**同じ
  スライス**で staged / 即時を決める。**後回しにすると同じ経路を 2 回作り直す**
- **fork の識別と種別の置き場。** batch の scope は `fileId` / `sheetId` の 2 段しかなく、
  種別を持つ場所が無い。ここで決めた形が Phase 6 の DtR の種別にそのまま効く

**Exit**: content / structure / layout が仕様の 3 段どおりに扱い分けられる。

### Phase 4: property editor

仕様: [propertyEditor](../requirements/spec/propertyEditor.md)

- **分類は「`.` を含むか否か」の一点**。system (`app.conversensus.*`) / extension (逆順ドメイン) /
  custom (`.` を含まない任意)。画像のシステム・プロパティの移行は #137 で済んでいる
- **一覧と編集**: 名前・型・値。custom は追加/変更/削除可能。system は既定で不可視
  (step2 では不可視のままでよい)
- 型の整合性検証は step3 送り。**型は表示するが検証しない**
- **`image` だけは構造体** (`{$type, ref, mimeType, size}`) なので、型の見せ方を別に決める
  必要がある (propertyEditor.md「既存のプロパティ」)。他は string と見做してよい

**型をどこから得るか — 決定: 値から推論して表示するだけにする。**

`node.setProperty` / `edge.setProperty` op は `{name, value}` で **`type` を持たない**ので、
型の置き場は 3 択 (op に足す / template が持つ / 値から推論する) だった。**値からの推論を採る。**

- **仕様がそう読める。** propertyEditor.md は 2 箇所で「型制約のチェックは今回は行わない
  (→ step 3)」「システムによるチェックは少なくとも step 2 では行わない」と書いている
- **op 語彙を触らずに済む。** 型を保存するには op に `type` を足すしかなく、それは
  「語彙の変更は同期を触る Phase と重ねない」に引っかかる
- **Phase 4 の独立性が保たれる。** template (Phase 5) に型を持たせると Phase 4 が Phase 5 に
  依存し、Phase 3 が最大になった今、差し込める独立枠が Phase 7 だけになってしまう

副作用: propertyEditor.md の「**型がすでに決まっている場合の**値を変更しようとした時」は
step2 では意味を持たない (型が値の従属変数なので「決まっている」状態が無い)。
**仕様のこの一文は step3 の記述である**ことを明示しておく。searching.md の
「property は名前, 型も表示」は推論値で満たせる。
- 変更は既にキー単位の op に載る (#208) ので、同期と競合判定は追加実装なしで乗る

**独立性が高い**。クリティカルパスの待ちが出たら、ここを進める。

### Phase 5: template (toulmin) + node label

仕様: [template](../requirements/spec/template.md)

- **`node.setLabel` op の追加**と node label の表示・編集。既存ノードの label は空でよい。
  **op 語彙の追加なので、同期を触る Phase 2 と重ねない**
- **toulmin template を直書き**する。step2 で作るのはこれ一つだけで、template の一般的な
  制約の仕組み (違反の扱い、同期で流れ込んだ他者の操作が違反していたら、など) は step3
- **template 実行**: node/edge の種別メニュー、接続の**警告** (step2 では拒否しない)
- **edge の種類ごとの「プロパティの定義」** (template.md)。プロパティの型がどこに載るかと
  直結するので、Phase 4 の「型をどこから得るか」と揃える
- **⚠️ 仕様が 1 点矛盾している。**`propertyEditor.md` は「型制約のチェックは今回は行わない
  (→ step 3)」と書き、`template.md` は template 実行の項目に「プロパティの値を設定するときの
  **型チェック**」を step2 として置いている。**本計画は propertyEditor 側 (step2 では検証しない) を
  採る** — template の制約の仕組み一般が step3 送りである以上、その一部だけを step2 に
  置く理由が無いため。**仕様側を直すべき論点**である

**Phase 6 の前提** (事実 3)。

**Exit は「通常の sheet に toulmin template を当てて種別が選べる」とする。**「対話グラフで
選べる」にすると Phase 6 の成果物に依存して測れなくなり、依存が双方向になってしまう。

### Phase 6: DtR graph

仕様: [dialogueToResolveGraph](../requirements/spec/dialogueToResolveGraph.md)

**着手時に単独の設計文書へ分割する。**

> **2026-08-30 のレビューでこの Phase は縮んだ。**「既存の branch/commit モデルに乗るかを
> 設計で確かめる」は Phase 3 へ移った (事実 5 / 6)。ここに残るのは、決着済みの器の上に
> **DtR の中身**を作る作業である。とはいえ UI の量が多く、U7 (resolve graph の見せ方) と
> U8 (承認の述語) が未決なので、依然として大きい。

- **起動の 3 経路**: explicit merge の content 競合 (強制) / structure 競合 (通知から手動) /
  implicit merge の競合が作る fork (通知から手動)。**content と structure は同時に起こりうる** —
  その場合は強制起動し、**その中で structure も通知する**
- **呼び出し対象の既定値は非対称**である。explicit merge = 共同作業者全員 /
  implicit merge = **自分だけ** (または競合した op の actor たち)。起動された resolve graph を
  見て対象を追加・削除できる
- **2 つのグラフ**: dialogue graph (任意のグラフ。toulmin template を当てる) と
  resolve graph (競合を可視化し、解消のために編集できるグラフ)
- **永続化**: Phase 3 で決めた器に載せる。**グラフ本体**は trunk の fileId 内の新しい
  sheet scope、**承認**は判断ログ (participation collection)。fileId を新しく切ってはならない
  (`discoverRemoteFiles` が File として materialize してしまう)
- **承認の判定** (S1 で決着済)。呼び出し対象は起動時に確定して記録し、**再 merge は
  pre 条件つきの操作**にする。判定は名簿への生きた問い合わせではなく、記録された集合に対して行う。
  承認しないまま参加を取りやめた actor は自動的に外れる
- **競合に関わった actor の表示。** 誰を呼ぶかの判断材料として、その競合を生んだ操作の actor を
  出す。`MergeConflict` の `ours` / `theirs` が `batchId` を持ち `Batch` が `actor` を持つので、
  **新しいデータを足さずに導ける**。「揉めている当人が誰か」が見えないまま呼ぶ相手は選べない
- **ワークフロー**: 呼び出し / 承認 / キャンセル / 再 merge / 保留。
  **承認しない actor がいたら既定は保留**である。外して進むのは「外そう」と判断した場合の選択
- **左サイドバー**: branch と同じレベルに出しつつ、通常の branch と違うことが分かる形にする。
  「未決着の merge がある」ことが見える必要がある

**Exit**: **完了基準 2 が揃う。** branch を切って merge → 競合 → DtR 起動 → 双方の承認 → 再 merge。

### Phase 7: searching

仕様: [searching](../requirements/spec/searching.md)

- **対象は自分の projection**。他人のリポジトリを直接見に行かない (同期して自分の projection に
  入っていれば対象になる)。時間を遡らない (op-log は対象外)
- 対象要素: node/edge の label、markdown ノードの content、property の値 (文字列化して)
- **範囲は「現在表示している sheet、あるいは branch」**。projection 全体ではなく、
  今見ているグラフに絞る (searching.md「検索対象」)
- 部分一致 + 大小文字の無視トグル。正規表現と完全一致は step3 送り
- **結果一覧の細目**: 要素の種類 (node/edge, label/content/property)、content は**前後のテキスト**も
  部分表示、property は**名前と型**も表示。**ダイアログは移動可能**
- 結果一覧からダブルクリックでグラフ内をハイライト

**独立性が高い**。Phase 4 と同じく差し込み枠。

---

## 4. 進め方

- CLAUDE.md の開発フローどおり、**Phase ごとに** branch → 実装 → commit → push → PR → approve → merge
- ブランチ名は `step/step2-<phase名>` (例: `step/step2-participation`)
- Phase 内で論理的なまとまりごとにスライスを切り、スライス単位で実装 + テスト + lint まで通す
- 大きい Phase (2, 3, 6) は着手時に単独の設計文書を `deepse/plans/step2-phase<N>-*.md` に起こす
- 仕様と食い違いが見つかったら、**実装ではなく仕様を直してから**進める。
  spec は `deepse/requirements/spec/` の git が原本である

---

## 5. 未決事項

着手前に決めなくてよいが、該当 Phase の設計で必ず答えを出すもの。

| | 内容 | 決める時期 |
| --- | --- | --- |
| **U1** | **名簿の食い違いの見せ方と、読み出しのパス数**。a が a' を招待した直後、まだ同期していない b の名簿に a' はいない。仕様はこれを許容すると決めているが、b の画面で「知らないだけ」と分かる必要があるか。加えて、**名簿の読み出しは不動点計算**なので (誰の participation を読むかを名簿が決める)、**何パス回すか**をここで決める。既定は 1 パス、収束まで回すとラウンドトリップが名簿の深さに比例する | Phase 1 |
| **U2** | **他アクタの repo にある blob の取り込み**。step2 は step1 踏襲 (PDS 内の blob) と決めたが、他者が貼った画像をどの repo から引くかは未定。**配管は既に他 DID に対応している** — `fetchRemoteBlob(did, cid, mimeType)` は did を引数に取り `com.atproto.sync.getBlob({did, cid})` を叩く。閉じているのは呼び出し側 (`resolveImageUrl` が `deps.did()` = `loggedInDid()` を渡す) だけなので、**問うべきは配管ではなく「その画像を誰が持っているかをどう知るか」である** | Phase 2 |
| **U3** | **ポーリング間隔と、その間の一貫性**。畳み込みは冪等なので正しさは崩れないが、間隔が長いと「相手の編集が見えるまでの遅れ」がそのまま UX になる。加えて仕様は「**3 つの同期方法の選択は排他的とは限らない**」と述べている — 手動同期とポーリングが cursor を共有して二重適用しないこと、ポーリングを止める / 強制同期する経路をどうするかを決める | Phase 2 |
| **U4** | **implicit merge の畳み込みコスト**。書かないと決めた以上、同期のたびに全参加者のログを畳む。DID ごとの cursor で取得は減るが、projection は毎回全量になる | Phase 2 |
| **U5** | **fork がどこまで branch と同じか**。fork を branch として書くなら、branch の UI と操作 (commit / merge / close) がそのまま効くのか、別扱いが要るのか。**U6 と同じ 1 つの問題である** — 器が branch であり、branch は同期されない (事実 5) | **Phase 3** |
| **U6** | **pre 条件検証つきの判断 op (承認) を、どちらの collection に置くか。** 当初は「DtR が branch/commit モデルに乗るか」と書いていたが、**問いの立て方がずれていた** — DtR のグラフ本体は trunk の fileId 内に sheet scope を切れば乗る。危ないのは承認の畳み込み意味論で、§3 が collection を分けた理由が batch collection の内側で再発する。**判断ログ側で確定 (2026-08-31)。**P2 スパイクが Go を出した (→ [u6-p2-report](../spikes/u6-p2-report.md))。**新しい前提が 1 つ出た** — 判断ログとグラフの op-log は**同じ clock 空間を共有**しなければならない (pre 条件が「この操作より前」だから)。P1 は 2 アカウント環境待ち | **Phase 0 のスパイク → Phase 1 で確定** |
| **U8** | ~~承認と名簿の食い違い~~ **決着済 → §5.5 の S1 を見よ** |
| **U7** | **resolve graph の UI**。仕様は「trunk の上に競合を表示する」までしか決めていない。競合の種類は **7 つ** — 対立として出る 5 つ (edge label / edge property / node label / node 内容 / node property) に加え、**「conversensus 側で解決したが、ユーザの意図に合わない可能性があるもの」2 つ** (edge の接続先、グループの所属関係。merging.md の S3 / S5 に対応) を表示する必要がある。さらに **resolve graph のすべての要素が追加/削除/編集可能**でなければならない (競合を避けるために既存の他の要素を変える必要が生じうるため)。dialogue graph からは要素を **id で指す** (URI は step3) | Phase 6 |

## 5.4 テストの方針: 全称命題は性質として書く (2026-08-30 決定)

step2 の中核は**分散した op-log の畳み込み**であり、その正しさは「あらゆる配送順で」
「あらゆる op 列で」という**全称命題**の形をしている。例ベースのテストでは原理的に書けない。

そこで **property-based testing (`fast-check`) を導入する。**

**可読性の観点でも効く。**現状は「コードが例を書き、`.test.md` が一般命題を日本語で補足する」
という分担になっている。例えば `properties.test.ts` の

```ts
test('from と一致する properties に当てると to になる', () => {
  const from = { a: 1, b: 2 };
  const to = { a: 9, c: 3 };
  expect(applyPropertyChanges(from, diffProperties(from, to))).toEqual(to);
});
```

は `∀ from, to. apply(from, diff(from, to)) = to` を任意の 1 例で書いたものである。
性質として書けば**コードが一般命題を述べ、`.test.md` は「なぜその性質が重要か」に専念できる**。

### 対象

| 対象 | 性質 | いつ |
| --- | --- | --- |
| `diffProperties` / `applyPropertyChanges` | 往復: `apply(from, diff(from, to)) = to` | パイロット |
| `canonicalProperties` (#137) | 冪等: `canonical(canonical(x)) = canonical(x)` | 随時 |
| `invertEvent` (undo/redo) | `apply(invert(e), apply(e, s)) = s` | 随時 |
| `orderBatches` | **全順序** (反対称性・推移性・完全性)。多アクタ収束の土台なので、ここが崩れると全部崩れる | Phase 2 まで |
| `genesis` | content-addressed な冪等性。同じ snapshot → 同じ batch id | 随時 |
| **projection の収束** | **同じ op 集合を見た 2 つの手元は同じ projection を出す。配送順・分断によらない** | **Phase 2 (必須)** |

最後のものが本命である。implicit merge の正しさそのもので、**例ベースでは書けない**
(「あらゆる配送順で」が性質の本質だから)。分散システムの用語では
**strong eventual consistency (SEC)** にあたる。

### 進め方

1. **パイロット**: `fast-check` を入れ、`properties.test.ts` の往復テストだけを性質に書き換える。
   `.test.md` との分担がどう変わるかを実物で見る
2. 良ければ **CLAUDE.md のテスト方針に規約として書く**
3. Phase 2 で projection の収束を性質として書く (必須)

**形式手法との関係**: 名簿の状態機械は Alloy、畳み込みの収束は TLA+ が本来の道具だが、
step2 では **PBT を常時回す層**として採る。実装そのものを検証する (仕様と実装が乖離しない)
点と、既存の `bun test` にそのまま乗る点で費用対効果が高い。形式仕様を書くかどうかは、
バグ探しではなく**深ソフトウェア工学の提案としての価値**で判断する (→ step 3 の検討事項)。

---

## 5.5 仕様に戻すべき論点 (2026-08-30 のレビューで出たもの)

**計画や設計の中で決めてはならず、要求仕様に戻って決着させるもの。**着手前に片付ける。

| | 内容 |
| --- | --- |
| **S1** | ~~承認と名簿の食い違いが両立しない~~ **決着済 (2026-08-30)。** 呼び出し対象を DtR 起動時に確定して記録し (名簿は既定値の供給源にすぎない)、**再 merge を pre 条件つきの操作**にする。pre 条件は「記録された呼び出し対象の全員の承認が、この操作より前に記録されていること」。満たさない再 merge は**出した本人の手元でも捨てられる**ので端末ごとに結論が変わらない。承認しないまま参加を取りやめた actor は呼び出し対象から自動的に外れる。仕様に反映済 (`dialogueToResolveGraph.md`「承認の判定」) |
| **S2** | ~~型チェックの時期が矛盾~~ **決着済 (2026-08-30)。** `template.md` の「値を設定するときの型チェック」を step3 へ寄せた。step2 の property editor は**型を値から推論して表示するだけ**で、保存も検証もしない。したがって step2 には「型が先に決まっている」状態が存在しない (型は値の従属変数) ことを `propertyEditor.md` に明記し、該当段落が step3 の記述であることも示した |
| **S3** | ~~カスケード削除の推移的な検出が仕様に無い~~ **決着済 (2026-08-30)。** `merging.md` の削除依存に S1' / S2' (グループを消すと中身も消える) を足し、**判定は「op に書かれた id」ではなく「分岐点の状態にカスケードを当てて求めた、実際に消える要素の集合」に対して行う**と明記した。直接参照だけを見るとグループ単位の削除を取り逃すが、グループはまとめて消す操作なので共同作業では直接参照より起こりやすい |

---

## 6. step2 でやらないこと (仕様より)

判断が揺れたときに立ち返るための一覧。

- 参加要請・参加表明そのもの (conversensus の外で行う)
- **PDS アカウント作成の UI**。招待コードの生成とアカウント作成は **step2 では curl 据え置き**で、
  アプリ内に UI を作るか PDS 用の管理アプリを用意するかの判断は step3 (`spec-step2.md`)
- 複数 PDS にまたがる招待 (step2 は単一 PDS + 招待制)
- Firehose による streaming (step2 はポーリング)
- 型の整合性検証、プロパティの可視化 (見た目への反映)
- template の一般的な制約の仕組み。作るのは toulmin 一つの直書きだけ
- hyperlink (1 つの File の内部に限れば不要)
- 正規表現検索、完全一致検索、複数グラフ横断の検索、op-log を遡る検索
- DtR graph からの分岐 (fork を新しい File にする)
- 呼び出された actor への通知そのもの (step2 では他の手段で行う)
