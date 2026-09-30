# step3 実装計画

> ステータス: **骨組み (Q1〜Q5 確定、レビュー待ち)** / 作成日: 2026-09-30
> 入力: [step3 アーキテクチャ](../architecture/step3.md) と `../architecture/step3/` 配下 8 本、
> [step3-entry](./step3-entry.md) (step2 の振り返りと、step3 で決めるべき問い 26 件)。
>
> **この計画が扱うのは FPR の前だけである** ([step3 §3.1 D1](../architecture/step3.md))。
> FPR の後は issue base で進めるので、§6 に候補を並べるにとどめる。
>
> 記号は [conventions.md](../conventions.md) に従う (D = 決めたこと / S = スライス /
> U = 未決 / Q = 利用者に訊くこと / N = 非目標)。

step3 の目標は **FPR してもよいと判断できるグレードに達すること**である。そのうち
FPR の前にやるのは、**データ (op-log・lexicon・保存先) が変わるもの**に限る。
FPR の後は互換性を背負うので、スキーマを自由に変えられるのは今だけだからである。

---

## 0. FPR の完了基準

**確定 (Q1, 2026-09-30)**: 叩き台のまま採用した。

1. ブラウザ (Safari を含む) で PWA として開き、インストールでき、オフラインで編集できる
2. 2 アカウントが同じ File を編み、branch の explicit merge で競合したとき、merger で
   解消して merge できる
3. template graph で定義した Toulmin を適用した sheet を作れる
4. metagraph で File 内の sheet の関係を描き、そこから sheet を追加・削除・改名できる
5. op-log の形式が確定している。**FPR 以降の形式変更には移行を伴う**

---

## 1. コードを読んで判明した、計画を規定する事実

### 事実 1: ローカルサーバとの継ぎ目は `api.ts` の 1 枚に閉じている

🔵 client がローカルサーバ (bun) を叩くのは `src/client/src/api.ts` (240 行、
エンドポイント約 15) に集まっている。サーバ側は `eventStore.ts` (741 行、`bun:sqlite`) と
`index.ts` (480 行) が本体である。

**PWA 化はこの継ぎ目の向こう側をブラウザに移す作業**になる。`api.ts` の関数の形を保ったまま、
中身を「ブラウザ内の eventStore を直接呼ぶ」ものに差し替えられれば、hooks から上は動かない。

### 事実 2: 認証は app password のセッションである

🔵 `atproto/client.ts` はパスワードでログインし、セッションを `localStorage` に置く。
OAuth は使っていない。**公開するアプリで利用者に app password を入力させるのは避けたい**ので、
PWA 化と同時に ATProto OAuth (ブラウザ側で完結する形) へ移すかを決める (Q3)。

### 事実 3: 分岐点は scalar 1 つで切っている

🔵 `branchLog.ts` の `batchesUpTo` は `b.clock <= commit.at` で切る。`CommitSchema.at` は
整数 1 つである。**merger の 3-way が要求する「正しい base」はここから直す** (step3-entry §2.1)。

### 事実 4: DtR の撤去範囲は広い

⚪ `dtr` を含む非テストのファイルは client / shared で 23 本ある (合計 約 9,500 行。
DtR 以外の中身も含む数字なので、撤去量そのものではない)。判断ログ (`judgment.ts`) の
`dtr.*` 3 種、`startDtr.ts`、名前による判別 (`isDtrSheetName` など)、`Sidebar.tsx` の分岐が
主な撤去対象である。**判断ログそのもの (participation) は残る。**

### 事実 5: sheet はプロパティを持てず、template は作り込みの id で指している

🔵 `sheet.create` は `name` / `description` / `templateIds` しか持たない。`templateIds` は
逆順ドメインの文字列で、`template/registry.ts` の `BUILTIN_TEMPLATES` から引く。
D3 に沿って **sheet の種別プロパティ**と **`TemplateRef`** を足す (architecture §3.4)。

---

## 2. Phase 一覧

| Phase | 内容 | データが変わるか | 前提 |
| --- | --- | --- | --- |
| **0** | 土台: App 結合テスト層、`GraphEditor` の非視覚的な関心の切り出し、n 軸のベンチ、保存先の spike | 変わらない | — |
| **1** | op-log v2: vector clock、DtR の撤去、sheet の種別プロパティ、`TemplateRef`、導出 node | **変わる (中心)** | 0 |
| **2** | 保存先: PWA 化 (ブラウザ内 eventStore、Tauri の撤去、認証) | **変わる** | 0 の spike |
| **3** | 画面の枠: グラフ view のアドレス、アプリ内タブ、右サイドバー、multiple モード | 変わらない | 1 |
| **4** | template graph と metagraph | **変わる** | 1, 3 |
| **5** | merger (explicit → implicit) | 変わらない (1 の上に乗る) | 1, 3 |
| **6** | 通知とフォルダの state (新しい lexicon) | **変わる** | 2 |

**D1 の表との違い**: アプリ内タブは D1 では「FPR 後でもよい」側に置いた。しかし merger
(DtR の代わり) が multiple モードとタブを要求し、DtR を撤去する以上 merger は FPR 前に要る。
**依存で FPR 前へ引き上げる** (Phase 3)。

**1 と 2 は独立**である (事実 1 の継ぎ目があるので、op の形と保存先は互いを知らない)。
それでも**逐次に進める** (Q5)。並行する理由が無く、正しさの中心が 1 にあり、2 は
spike の結果次第で形が変わるからである。

---

## 3. 各 Phase の中身

### Phase 0: 土台

step2 の振り返りで「欠けている」とされた層を先に作る。以降の Phase は大きく壊して
作り直すので、**壊したことに気付ける網を先に張る**。

- **S0-1 App 結合テストの層** (step3-entry E / 問 19)。最初の 1 本は Phase 6 (step2) の
  「merge したら自分の一覧にも解決 branch が出る」の再現。ただし DtR は Phase 1 で撤去するので、
  **撤去後も意味を持つ経路** (branch の受信 → 一覧の更新) で書き直して選ぶ
  - **✅ 実装済 (2026-09-30)。**通信の境界 (ローカルサーバ / PDS) だけを `fetch` で差し替え、
    内側はすべて本物。ローカルサーバは本物の Hono アプリをプロセス内で呼び、PDS は XRPC を
    HTTP の形で受ける偽物 (`testing/fakePds.ts`)。複数の参加者は端末を順番に切り替えて表し、
    相手の記録も本物の App に書かせる (Phase 1 で op-log の形が変わっても追随する)
  - 最初の 2 本は step2 T7-3 の実機の失敗 (branch の受信が canvas と一覧に届く)。
    **作った時点で未知の不具合を 1 件見つけた**: 「今すぐ同期」が trunk しか引かず、branch を
    開いたまま押しても相手の branch の編集が来なかった。App で trunk と branch を束ねて直した
  - **別プロセスで走らせる** (`*.app-test.tsx`, `bun run test:app`)。既存の 4 本の
    コンポーネントテストの `mock.module` がプロセス全体に漏れ、同居すると App の import が壊れる。
    この漏れは main でも単体どうしの順序依存を起こしている (`bun test --randomize --seed=4` で
    11 件落ちる)。既定の順序では出ないので未修正 (U6)
- **S0-2 `GraphEditor` の非視覚的な関心の切り出し** (F / 問 20)。画像の貼付・PNG 書き出し・
  ドラッグ追跡。検索とプロパティは Phase 3 で住む場所が決まるので、ここでは割らない。
  T7-7 の未修正の不具合 (問 23) も同じ場所なので、ここで拾う
  - **✅ T7-7 を直した (2026-09-30)。**App 結合テストで開いてから置くまでの間隔を振り、
    **150ms 未満で必ず起きる**ことを突き止めた。canvas の変化を**時刻と回数で**捨てていた
    (`readyForSave` のタイマーと `conflictUpdatePendingRef`) ので、窓に入った編集が
    親に届かなかった。**中身 (op に落ちる値) で見分ける門** (`graph/changeGate.ts`) に置き換え、
    2 つの仕掛けを撤去した
  - **✅ 切り出し (2026-09-30)。**ドラッグ追跡 → `hooks/useNodeDragTracking.ts`、画像の受け入れ →
    `hooks/useImageIntake.ts`、PNG 書き出し → `graph/exportPng.ts`。`GraphEditor` は
    1268 行 → 975 行。どれも中にあった間はテストが無かったので、切り出して単体テストを付けた
- **S0-3 n 軸のベンチ** (問 24)。「n 人 × m 件」の取得と畳み込み。vector を入れる前の
  基準値を取る
- **S0-4 保存先の spike** (U2)。SQLite-WASM + OPFS を Safari / Chrome で動かし、
  ITP によるストレージ消去、`navigator.storage.persist()`、複数ブラウザタブからの
  同時書き込みを実機で確かめる。**結果は Phase 2 の形を決める**

### Phase 1: op-log v2

**互換性を捨てた今しかできない変更をまとめて入れる。**既存の op-log は読まない
(移行もしない)。rkey の版も改める。

- **S1-1 vector clock の型と発番**。scalar Lamport は tiebreak として残す (全順序 = SEC の
  土台、問 3)。vector は置き換えではなく追加である
- **S1-2 分岐点を vector で切る** (`Commit.baseVector`、A / 問 1)
- **S1-3 batch に vector を載せ、競合検出と T8 を vector で判定し直す** (問 8・9)。
  layout の対称性もここで閉じる
- **S1-4 参加期間の判定を vector で判定し直す** (step3-entry §2.1 の 4 つ目の限界 / 問 6)
- **S1-5 DtR の撤去** (事実 4)。判断ログの `dtr.*`、名前による判別、関連 UI
- **S1-6 sheet の種別プロパティと `TemplateRef`** (事実 5 / D3)
- **S1-7 導出 node を受け付ける畳み込み** (D2)。導出 node の id は SheetId から決定的に作る
- **S1-8 actor の退役規則** (問 7)。vector が伸び続けないようにする

S1-2・S1-3・S1-4・S1-7 は**間違えても静かに違う答えを出す側**なので、性質テストで固める
(CLAUDE.md の方針。往復・収束・対称性)。

### Phase 2: 保存先 (PWA)

S0-4 の結果で形が決まる。既定案は次のとおりである。

- **S2-1 ブラウザ内 eventStore** (SQLite-WASM + OPFS)。`eventStore.ts` のスキーマを持ち込む
- **S2-2 `api.ts` の中身の差し替え** (事実 1)。関数の形は保つ
- **S2-3 PWA 化** (manifest、service worker、オフライン起動、`storage.persist()`、未同期の警告)
- **S2-4 認証を ATProto OAuth へ移す** (Q3)。app password のセッションを撤去する
- **S2-5 Tauri とローカルサーバの撤去** (`src-tauri/`、`src/server/`、関連 E2E と設定)

### Phase 3: 画面の枠

- **S3-1 グラフ view のアドレス** (O1)。`(file, sheet, branch, 切断面, mode, highlight)`。
  切断面は Phase 1 の vector である
- **S3-2 アプリ内タブ**。タブ = アドレスの並び。閉じても再現できる
- **S3-3 右サイドバー** (property editor、以後の inspector の置き場)。左右サイドバーの
  幅変更と折り畳み
- **S3-4 ボディの multiple モード** (merger の前提)
- 検索とプロパティの住む場所を決めて、S0-2 で残した部分を `GraphEditor` から割る

### Phase 4: template graph と metagraph

- **S4-1 template graph**。種別 `template` の sheet の定義を読み、適用先で node・edge の
  種類を提示する。Toulmin を template graph で定義し直し、`BUILTIN_TEMPLATES` を撤去するか
  「作り込みの template graph」にするかを決める (U3)
- **S4-2 metagraph**。File 作成時に "index" を作る。graph node の導出 (S1-7) と、
  metagraph 上の操作を `sheet.*` の op へ翻訳する処理

### Phase 5: merger

- **S5-1 explicit merge の merger**。3 つの graph view、差分表示と競合表示、
  右クリックでの取り込み、conflict list。base は S1-2 の `baseVector`
- **S5-2 作業中に merge 先が進んだときの扱い** (O3)。競合の同定を安定させ、チェック状態を
  引き継ぐ
- **S5-3 implicit merge からの起動** (O2)。merge 元/先が何を指すかを先に決める

### Phase 6: 通知とフォルダ

- **S6-1 通知**。内容は op-log から導出し、PDS (新しい lexicon) に置くのは既読状態だけにする (Q4)。
  導出で済まない通知が出たら、そのときに本体を置く
- **S6-2 フォルダの state** (actor 固有、端末間共通)

---

## 4. 着手前に訊くこと (Q)

**すべて確定した (2026-09-30、PR #234 のコメント)。**おおむね既定案のとおりである。

| | 問い | 確定 |
| --- | --- | --- |
| **Q1** | FPR の完了基準 | **§0 の叩き台のとおり** |
| **Q2** | グラフ view のアドレスを 1 つ定義して、タブ・Deep Link・inspector・検索結果・merger を載せるか (O1) | **載せる。**「上手く行くのならば美しい」— 試してみて、載らないものが出たらそこで見直す |
| **Q3** | 認証を ATProto OAuth へ移すか (事実 2) | **移す** (S2-4) |
| **Q4** | 通知とフォルダを PDS に置いて公開されてよいか (O4) | **公開されること自体は問題ない** (conversensus の考え方に合う)。ただし通知の内容は op-log から導出で済むなら導出する。PDS に置くのは既読状態とフォルダ |
| **Q5** | Phase 1 と 2 を並行するか | **逐次。**並行する理由が無い。S0-4 の spike は Phase 0 の中で行う |

## 5. 未決 (U)

- **U1**: batch の vector の大きさと、同期量への影響 (S0-3 の基準値と比べる)
- **U2**: SQLite-WASM + OPFS が Safari で十分に動くか (S0-4)
- **U3**: Toulmin を作り込みの template graph として残すか、File ごとに複製するか
- **U4**: 導出 node の id の作り方 (UUIDv5 か、端点に SheetId を直接許すか)
- **U5**: 判断ログに vector を載せるか (問 14)。DtR 撤去後に残る判断は participation だけになる
- **U6**: コンポーネントテスト 4 本の `mock.module` の漏れ (S0-1 で発覚)。bun には
  ファイルごとのプロセス分離が無い。モックを本物の再エクスポート + 差分にするか、
  それらも別プロセスへ移すか

## 6. FPR の後 (issue base の候補)

i18n (en の追加) / 無限キャンバス / timeline view (version tree・operation inspector・
change inspector) / global search / デザイン言語の細部の適用 / Deep Link の URI スキーム /
Jetstream による近リアルタイム化 (O6) / 左サイドバーの File・Sheet 名検索 /
graphical・textual view の切り替え / map 表示。

**timeline view と global search は Phase 3 のアドレスの上に乗る**ので、FPR 後に UI だけで
足せる。これが Q2 を「載せる」にしたい理由である。

## 7. step3 でやらないこと (N)

- step forward council (merge への複数人の関与) — merger.md で step4 以降へ送った
- presence・キー入力単位のリアルタイム同期 (O6)
- 他のユーザからの通知 (notification.md の種類 2)
- user's guide と examples — step3 完了後
- 既存 op-log の読み込みと移行 — 互換性は考えない ([architecture §1.1](../architecture/step3.md))
