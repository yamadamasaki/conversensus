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
`rangeFetch` / `remoteFilter` / `discoverRemoteFiles` / `receiveRemoteBatches` が
すべてこの下流にある。

### 事実 2: 同期のトリガに定期ポーリングが無い

同期は**起動時・`online` イベント・手動**でしか駆動しない (`setInterval` は client に 1 つも無い)。
仕様が step2 の同期方式として挙げる「定期的なポーリング」は未実装である。

既存の Issue #202 (「他の端末・他の窓の編集が、ファイルを開き直すまで反映されない」) は
この症状そのものなので、**多アクタ同期の Phase で一緒に回収する**。

### 事実 3: node は label を持たない

`unified.ts` の op に `node.setLabel` は無い。node が label を持つのは
[template](../requirements/spec/template.md) で追加されるものであり、
**resolve graph の実装は node label に依存する**と
[dialogueToResolveGraph](../requirements/spec/dialogueToResolveGraph.md) が明記している。

したがって **template の label 追加は DtR graph より前**に来る。op 語彙の追加を伴うので、
同期や merge の competing 実装と重ならない時期に置きたい。

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

### 事実 4 の補足: 多アクタの全順序は既に決まっている

`orderBatches` は `(clock, actor, batchId)` で全順序を作る (Phase 4d-3)。
**actor をまたいでも決定論的に畳める**ということなので、implicit merge の中核は
既に踏めている。ここが未定だったら Phase 0 の spike は重かったが、そうではない。

---

## 2. Phase 一覧

| Phase | 内容 | 完了基準への寄与 | Exit |
| --- | --- | --- | --- |
| **0. 土台** | 2 アカウントのテスト環境。`collections.ts` の repo 引数化 (振舞いは変えない) | — | 2 アカウントで手動同期が回る / 既存テスト緑 |
| **1. 名簿 (participation)** | participation collection 新設。招待/承認/取消の op と pre 条件つき projection。参加コード。招待 UI | 1, 3 | 招待→承認で名簿に載り、取消で外れる |
| **2. 多アクタ同期 (implicit merge)** | 名簿から参加者と期間を引いて他者の repo を読む。DID ごとの cursor。定期ポーリング (#202 回収) | **1, 3 達成** | 2 アカウントの編集が相手のグラフに出る |
| **3. 競合の 3 段構え** | add-wins 化・カスケード削除の推移的検出・layout の競合検出・競合の通知 UI・implicit merge の fork | 2 の前提 | 3 種別が仕様どおりに扱い分けられる |
| **4. property editor** | system/extension/custom の分類と一覧・編集 UI | (独立) | custom を追加/変更/削除できる |
| **5. template (toulmin) + node label** | `node.setLabel` op と node label の表示・編集。toulmin template を直書き。種別メニューと接続警告 | 2 の前提 (事実 3) | 対話グラフで toulmin の種別が選べる |
| **6. DtR graph** | dialogue graph / resolve graph、merge・fork への紐付け、呼び出し・承認・キャンセル・再 merge・保留 | **2 達成** | 競合 → DtR 起動 → 双方承認 → 再 merge |
| **7. searching** | 部分一致検索と結果一覧、グラフ内ハイライト | (独立) | label/content/property を横断して引ける |

**クリティカルパス**: 0 → 1 → 2 → 3 → 5 → 6。
**Phase 4 と 7 は独立**なので、クリティカルパスの待ちが出たとき、あるいは大物 (6) の前後に
息継ぎとして差し込む。どちらも既存の語彙の上に載るだけで、op 語彙も同期も触らない。

Phase 6 が step2 で最大である。着手時に単独の設計文書へ分割する (step1 の Phase 4d/5/7 と同じ形)。

---

## 3. 各 Phase の中身

### Phase 0: 土台

**目的は Phase 1 以降の前提を、振舞いを変えずに用意すること。**ここで機能を足さない。

- **テスト環境**: VPS の PDS に 2 つ目のアカウントを作る (招待コードは現行どおり curl)。
  手順は `deepse/requirements/user-test-environment.md` に反映する
- **`collections.ts` の repo 引数化**: `currentDid()` を既定値にしたまま repo を引数で
  受けられるようにする。**この Phase では呼び出し側を変えない**ので観測される振舞いは同じ。
  Phase 2 の変更を「誰の repo か」の一点に絞るための準備である
- **[architecture/step2.md](../architecture/step2.md) を確定させる** (横断する判断のみ)。
  step1 アーキテクチャからの差分がここに集まる
- **U6 を PoC スライスで潰すかを判断する**。Phase 1 で participation collection を切る時点で
  「collection は 2 つで済む」を前提にするので、崩れると後戻りが大きい
- Phase 1 の設計 (participation の lexicon と op) を書き出す

**Exit**: 2 アカウントで手動同期が回ることを実機で確認 / 既存テストが緑のまま。

### Phase 1: 名簿 (participation)

仕様: [participation](../requirements/spec/participation.md)

- **collection を新設する**。グラフの batch collection と分けるのは仕様の決定どおりで、
  決め手は**畳み込みの意味論が違う**こと — 名簿の op は pre 条件を検証して満たさないものを
  **捨てる**が、グラフの op は LWW / add-wins なので「無効な op」の概念がない
- **op**: 招待 / 承認 / 参加取りやめ / 取消 (招待・参加の前後を問わず同じ「取消」)
- **projection**: clock 順に畳みながら pre 条件を検証し、満たさない op を捨てる。
  これで「招待されていないアクタの承認は無効」と「取り消し合いは誰の手元でも同じ結論」が
  同時に決まる。**ここが名簿の中核なので、テストは pre 条件の網羅から書く**
- **参加コード**: 招待者 DID + 被招待者 DID + FileId をエンコードしたもの。秘密ではない
  (本人以外の承認は projection で落ちる) ので、暗号的な要求は無い
- **UI**: invitation ダイアログ (一覧 + 生成) と participate ボタン

**Exit**: 招待 → 承認で名簿に載り、取消で外れる。取り消し合いを両方の端末で畳んで結論が一致する。

### Phase 2: 多アクタ同期 (implicit merge)

仕様: [merging](../requirements/spec/merging.md) の implicit merging

- **名簿を先に読み、グラフを後に読む**。参加期間が確定していないと「その期間の op-log だけ」を
  取れないので、読む順序はこの向きに固定される
- **他者の repo を読む**: Phase 0 で開いた repo 引数を使う。`rangeFetch` の cursor を
  **DID ごと**に持つ
- **期間フィルタ**: 参加していない期間の batch は畳まない。`remoteFilter` の隣に置く
- **implicit merge は op-log に書かない**。冪等な導出なので記録すべきものがなく、書くと
  参加者の数だけ操作が増殖する。**同期のたびにその場で畳む**
- **定期ポーリング**: 仕様が step2 の同期方式と定めたもの。#202 をここで回収する
- **blob**: step1 を踏襲 (PDS 内の blob を利用)。**他アクタの repo にある blob を
  どう引くかは未決** (§5 の U2)

**Exit**: **完了基準 1 と 3 が揃う。** 2 アカウントの編集が相手のグラフに出て、
参加を取りやめると出なくなる。

### Phase 3: 競合の 3 段構え

仕様: [merging](../requirements/spec/merging.md) の「検出後の既定の振舞い」「layout の競合」

事実 4 の 3 つを片付ける。DtR graph が乗る土台なので、**DtR より前に**置く。

- **add-wins 化**: 決着までグラフが表示できなければならず、clock-LWW のままだと DtR で
  議論する前に対象が消える。「判断を保留するなら情報を消さない方に倒す」
- **カスケード削除の推移的検出**: `mergeBranches` が base のグラフを受け取る形にする
  (シグネチャ変更)。add-wins 化と同じ Phase に置くのは、どちらも「削除をどう扱うか」の
  一つの判断だからである
- **layout の競合検出**: 検出して**通知するだけ**。DtR は起動しない。毎回の位置調整で
  DtR がノイズに埋まるのを避ける
- **通知 UI**: structure と layout の競合をユーザに見せる。structure はここから手動で
  DtR を起動できる (Phase 6 で接続)
- **implicit merge の fork**: 競合したら fork して通知する。**fork は op-log に書く** —
  implicit merge 自体は導出だが、fork は「この競合を保留した」という判断の記録であり、
  書かないと同期のたびに解決済みの fork が復活する

**Exit**: content / structure / layout が仕様の 3 段どおりに扱い分けられる。

### Phase 4: property editor

仕様: [propertyEditor](../requirements/spec/propertyEditor.md)

- **分類は「`.` を含むか否か」の一点**。system (`app.conversensus.*`) / extension (逆順ドメイン) /
  custom (`.` を含まない任意)。画像のシステム・プロパティの移行は #137 で済んでいる
- **一覧と編集**: 名前・型・値。custom は追加/変更/削除可能。system は既定で不可視
  (step2 では不可視のままでよい)
- 型の整合性検証は step3 送り。**型は表示するが検証しない**
- 変更は既にキー単位の op に載る (#208) ので、同期と競合判定は追加実装なしで乗る

**独立性が高い**。クリティカルパスの待ちが出たら、ここを進める。

### Phase 5: template (toulmin) + node label

仕様: [template](../requirements/spec/template.md)

- **`node.setLabel` op の追加**と node label の表示・編集。既存ノードの label は空でよい。
  **op 語彙の追加なので、同期を触る Phase 2 と重ねない**
- **toulmin template を直書き**する。step2 で作るのはこれ一つだけで、template の一般的な
  制約の仕組み (違反の扱い、同期で流れ込んだ他者の操作が違反していたら、など) は step3
- **template 実行**: node/edge の種別メニュー、接続の**警告** (step2 では拒否しない)

**Phase 6 の前提** (事実 3)。

### Phase 6: DtR graph

仕様: [dialogueToResolveGraph](../requirements/spec/dialogueToResolveGraph.md)

step2 で最大。**着手時に単独の設計文書へ分割する。**現時点で見えている論点だけ挙げる。

- **起動の 3 経路**: explicit merge の content 競合 (強制) / structure 競合 (通知から手動) /
  implicit merge の競合が作る fork (通知から手動)
- **2 つのグラフ**: dialogue graph (任意のグラフ。toulmin template を当てる) と
  resolve graph (競合を可視化し、解消のために編集できるグラフ)
- **永続化**: batch collection に書く。**人間が下した判断であって導出ではない**ので記録が要る。
  ユーザからは「特殊な branch」に見える。既存の branch/commit モデル
  (branch = base コミット + 追記された batches) に乗るかを設計で確かめる
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
- 部分一致 + 大小文字の無視トグル。正規表現と完全一致は step3 送り
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
| **U1** | **名簿の食い違いの見せ方**。a が a' を招待した直後、まだ同期していない b の名簿に a' はいない。仕様はこれを許容すると決めているが、b の画面で「知らないだけ」と分かる必要があるか | Phase 1 |
| **U2** | **他アクタの repo にある blob の取り込み**。step2 は step1 踏襲 (PDS 内の blob) と決めたが、他者が貼った画像をどの repo から引くかは未定。`resolveImageUrl` の 3 (PDS) が `loggedInDid()` に閉じている | Phase 2 |
| **U3** | **ポーリング間隔と、その間の一貫性**。畳み込みは冪等なので正しさは崩れないが、間隔が長いと「相手の編集が見えるまでの遅れ」がそのまま UX になる | Phase 2 |
| **U4** | **implicit merge の畳み込みコスト**。書かないと決めた以上、同期のたびに全参加者のログを畳む。DID ごとの cursor で取得は減るが、projection は毎回全量になる | Phase 2 |
| **U5** | **fork がどこまで branch と同じか**。fork を branch として書くなら、branch の UI と操作 (commit / merge / close) がそのまま効くのか、別扱いが要るのか | Phase 3 |
| **U6** | **DtR graph が既存の branch/commit モデルに乗るか**。乗らないなら batch collection 上に別の構造が要る (collection は 2 つで済む、という仕様の判断に影響する)。**Phase 6 を待たず最小の PoC スライスで先に潰す候補** ([architecture/step2.md](../architecture/step2.md) §8) | Phase 0 or 1 で判断 / Phase 6 |
| **U7** | **resolve graph の UI**。仕様は「trunk の上に競合を表示する」までしか決めていない。競合の種類が 5 つ (edge label / edge property / node label / node 内容 / node property) あり、それぞれの見せ方は設計と並行して考えるとしている | Phase 6 |

## 6. step2 でやらないこと (仕様より)

判断が揺れたときに立ち返るための一覧。

- 参加要請・参加表明そのもの (conversensus の外で行う)
- 複数 PDS にまたがる招待 (step2 は単一 PDS + 招待制)
- Firehose による streaming (step2 はポーリング)
- 型の整合性検証、プロパティの可視化 (見た目への反映)
- template の一般的な制約の仕組み。作るのは toulmin 一つの直書きだけ
- hyperlink (1 つの File の内部に限れば不要)
- 正規表現検索、完全一致検索、複数グラフ横断の検索、op-log を遡る検索
- DtR graph からの分岐 (fork を新しい File にする)
- 呼び出された actor への通知そのもの (step2 では他の手段で行う)
