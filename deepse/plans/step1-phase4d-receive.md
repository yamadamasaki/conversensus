# step1 Phase 4d 受信 (remote batch op-log → ローカル正典) — 設計

W3d5 (`step1-w3d5-remote.md`) で**送信**片方向が実機で通った。本設計はその逆方向、
**remote の batch op-log を受け取ってローカル正典へ取り込む経路**を扱う。

前提となる申し送りは W3d5 §6.1 (`actor` の端末識別 / batch への `fileId`) だが、
**実コードを当たった結果 §6.1 には訂正が要り、前提条件は 2 つでは足りず計 7 つあった**
(うち Critical 3)。まずそこから記す。

> **本設計は critic レビュー (2026-07-20, Opus, 実コード裏取り込み) を経て REVISE 判定を受け、
> 指摘を全面反映した第 2 版である。** 初版で私 (起案者) が §1 に書いた事実主張のうち
> **3 点が誤りまたは誇張**で、レビューで訂正された。訂正の経緯も §1 に残す — 同じ誤読を
> 後から繰り返さないため。

---

## 1. 現状把握 (コード実態・2026-07-20 時点)

### 1.1 W3d5 §6.1 の訂正 — 「順序が決まらない」のではない

§6.1 は「`(clock, actor)` で tiebreak するので actor が同一だと順序も重複排除も決まらない」
と書いたが、**実装は `(clock, actor)` で tiebreak していない**。

```ts
// src/shared/src/events/project.ts:44
function orderBatches(batches: Batch[]): Batch[] {
  return [...batches].sort(
    (a, b) => a.clock - b.clock || a.timestamp - b.timestamp || a.id.localeCompare(b.id),
  );
}
```

tiebreak は **`clock → timestamp → id`**。`id` は BatchId (UUID) なので、
actor が全端末で `'local'` でも**順序は決定論的に決まる**。§6.1 の「決定不能」は誤り。

**しかし問題が消えるわけではなく、質が違う**:

- **決まった順序が因果的に意味を持たない**。別端末の clock は独立に進むので、
  `a.clock - b.clock` の比較は端末をまたぐと無意味。決定論的ではあるが**恣意的**。
- **第 2 キーが `timestamp` = 端末のウォールクロック**で、端末間では信頼できない
  (ずれ・巻き戻り・タイムゾーン設定ミス)。単一端末では実質使われないキーが、受信では常時
  tiebreak の主役になる。genesis がわざわざ一意 clock を振って「`orderBatches` の tiebreak が
  timestamp に昇格しないようにする」(`unified.ts:251`) と明記しているのと同じ懸念が、
  受信では**恒常的に発生する**。

→ **actor を端末一意にする目的を再定義する**。「tiebreak を決定可能にする」ためではなく、
**因果順序の単位と重複排除の単位を識別できるようにする**ため。順序規則そのものの見直し (§3.2) が
本体であり、actor はその材料である。

#### clock 衝突は偶然ではなく既定の挙動 (critic 指摘・裏取り済)

W3d5-7 の実測「A と B の content batch がともに `clock=3`」には機構的な説明がある。

- genesis batch は決定論的 id と**連番 clock** (`GENESIS_CLOCK_START=1..N`) を持つ (`genesis.ts`)。
- `LamportClock.seed(floor)` は `observe` と違い **+1 しない** (`unified.ts:290-295`)。

したがって**同一 snapshot から genesis した 2 端末は同じ `N` を seed し、最初の編集がともに
`clock = N+1` になる**。実測値は偶然の一致ではなく、構造的にそうなる。

### 1.2 `actor` の実際の出所 — `LOCAL_ACTOR` は dead constant

```ts
// src/shared/src/events/unified.ts:33
/** 操作の主体。DID または未接続時の 'local' */
export const LOCAL_ACTOR = 'local' as const;
```

この定数は**どこからも参照されていない** (src 全体の grep で定義行のみ)。実際の `actor` は:

```ts
// src/client/src/events/toUnified.ts:345
actor: event.userId,
// src/client/src/events/GraphEvent.ts:21, 265
```

→ actor 変更の起点は shared の `LOCAL_ACTOR` ではなく **`GraphEvent.userId`**。
構造ログ (W3c1) も同じ経路を通る。`LOCAL_ACTOR` は削除する (§3.1)。

### 1.3 `pull` の cursor が clock ベース — **潜在**欠陥 (初版の記述を訂正)

> **初版はここを「受信では取りこぼす」と現存の欠陥として書いたが、誇張だった。**
> critic の裏取りにより、**取りこぼしを起こす主体が現時点では存在しない**ことが判明した。

現状の呼び出し関係:

- `FanoutSyncProvider.pull` は **local へ委譲** (`fanoutSyncProvider.ts:64-66`)。
  `AtprotoSyncProvider.pull` は tap からは呼ばれない。
- `AtprotoSyncProvider.pull` の唯一の実呼び出しは `RemoteSyncQueue.catchUp` で、
  **常に `INITIAL_CURSOR` を渡し、返った cursor を捨てる** (`remoteSyncQueue.ts:81`)。
- クライアント全体で cursor を永続化する箇所は **0 件**。

つまり「A が `cursor="5"` を保存 → 以後取りこぼす」という物語は、**保存する主体が居ないので
今は起きない**。ただし **cursor 永続化を導入した瞬間に成立する**:

> B が `clock=5` を書く → A が pull して `cursor="5"` を保存 → その後 A 自身が `clock=3` を書く
> → **A は次の pull でも `3 > 5` が偽なので永久に取りこぼす**。

clock は端末をまたぐと単調でないため cursor に使えない。受信は cursor 永続化を前提とするので、
**受信を入れる前に直す必要がある**という結論は変わらない。

さらに実装にはより悪い性質がある:

```ts
// atprotoSyncProvider.ts:99-100
if (batch.clock > maxClock) maxClock = batch.clock;   // 返さないレコードも max に算入
if (batch.clock > sinceClock) batches.push(batch);
```

`maxClock` は**返却対象でないレコードも含めた全件の max** なので、cursor は返した batch を
追い越して前進する。cursor を導入した瞬間、1 回の pull で「返していない範囲」を既読扱いにする。

→ cursor を **remote のレコード順** (ATProto の `rev` / `listRecords` の cursor / `indexedAt`) に
基づくものへ変える。`SyncProvider.Cursor` は「provider 定義の不透明トークン」
(`syncProvider.ts:17`) なので外の層は変更不要。

### 1.4 `foldFileStructure` は single-actor 前提。実態は LWW ですらない

```ts
// src/shared/src/events/project.ts:195
/** シート/ファイル構造の畳み込み状態。単純 LWW (single-actor 前提, critic H2-new) */
```

W3b の critic レビュー時点で「single-actor 前提」と明記された箇所。**実態はコメントより弱い** —
`applyFileOp` は `clock` を引数に取りながら `sheet.create` の `createClock` にしか使わず、
`file.setName` / `sheet.setName` / `sheet.reorder` は**比較なしの逐次上書き** (`project.ts:236-258`)。
「LWW」ではなく「**整列後の最終適用が勝つ**」。つまり `orderBatches` の順序を変えれば
挙動が直接変わる。§1.1 と同根の問題が projection 層にも露出している。

### 1.5 `subscribe` は実装済みだが消費箇所ゼロ、`pull` は全件 list

- `AtprotoSyncProvider.subscribe` (`atprotoSyncProvider.ts:119`) の呼び出しは **0 件** (W3d5 critic A1)。
  `FanoutSyncProvider.subscribe` は local へ委譲 (`fanoutSyncProvider.ts:69-71`)、
  `LocalServerSyncProvider.subscribe` は **no-op** (`localServerSyncProvider.ts:45-49`)。
- `BatchCollection.list()` は**全件取得**。`pull` はそれを毎回舐める。履歴に線形 (W3d5 D2)。
- **`subscribe` の baseline 確立は失敗すると取りこぼす**: `tick()` の catch は `console.warn` のみ
  (`atprotoSyncProvider.ts:133-137`)。`baselined = true` は成功パスでのみ立つため、初回 poll が
  失敗すると次の成功 poll が baseline になり**その間の batch を恒久的に落とす**。

### 1.6 🔴 Lamport の受信規則が**実装されていない** (初版の記述を訂正)

> **初版は「受信 batch がローカル正典に入ると seed に他端末の clock が混ざる。Lamport としては
> 正しいので望ましい」と書いたが、逆だった。**

```ts
// eventSyncTap.ts:80-98
private ensureRestored(): Promise<void> {
  if (!this.restored) {            // ← 一度きり
    this.restored = this.provider.pull(INITIAL_CURSOR).then((result) => {
      const maxClock = result.batches.reduce((m, b) => Math.max(m, b.clock), 0);
      this.clock.seed(maxClock);   // ← seed は +1 しない
```

- `ensureRestored` は `if (!this.restored)` により **起動時 1 回のみ**。セッション中に到着した
  受信 batch は自端末の clock を**一切前進させない**。
- **`LamportClock.observe()` (受信規則そのもの、`unified.ts:283`) は本番コードから 1 度も
  呼ばれていない** (grep: `unified.test.ts` の 2 件のみ)。

```ts
// unified.ts:283
observe(remote: Lamport): Lamport {
  this.value = Math.max(this.value, remote) + 1;   // 受信規則。プリミティブは存在する
}
```

→ **受信規則は未実装**。これを配線しない限り §3.2 の「同一 actor 内では clock 昇順 =
因果順序の保存」は端末間で成立せず、順序規則をどう作っても因果を表現できない。
プリミティブは既にあるので**追加コストはほぼ配線のみ**であり、費用対効果が最も高い一手。

### 1.7 受信 batch の undo 可能性

undo/redo はローカルの `GraphEvent` 履歴と `invertEvent` に紐づく。受信 batch は `GraphEvent` を
経由せず直接 Batch として入るので、**構造上すでに undo 対象外**。W3c1 で構造イベントを
「dispatch を通さず syncRecord 直呼び = undo 対象外」にしたのと同じ形。
意図した性質なので設計に明記する (他人の編集を自分の Ctrl+Z で消せてはならない)。

### 1.8 🔴 lazy migration が受信 batch を **DELETE する** (critic D-1・新規)

```ts
// src/server/src/index.ts:229
app.get('/files/:id/batches', async (c) => {
  await migrateFileToOplog(store, fileId);   // ← 読取のたびに走る
```
```ts
// src/server/src/eventStore.ts:226-240 (migrateToOplog)
const current = this.getSchemaVersion(fileId);
if (current !== null && current >= schemaVersion) return false;
this.db.query('DELETE FROM batches WHERE file_id = $file').run(...);   // ← 全消し
for (const batch of genesisBatches) this.appendBatch(fileId, batch);
```

ゲートは **`file_migrations` の per-file marker のみ** (`migrateFileToOplog.ts:33-34`)。
成立シナリオ:

> device B がまだ一度も開いていないファイル F がある (marker 無し)。W3e 未了なので B の
> storage には F の legacy snapshot が存在する。→ 受信経路が F の batch を
> `POST /files/F/batches` で書き込む → ユーザが B で F を開く → `GET /files/F/batches` →
> marker 無し + snapshot 有り → **`DELETE FROM batches WHERE file_id='F'`** →
> **受信した batch が全消失**し、古い snapshot 由来の genesis で置き換わる。

`appendBatch` のべき等性は救いにならない — 受信側 cursor が前進していれば二度と来ない。

**対策 (4d-0)**: → **実装時に方針を変更した。下記「採用した対策」を参照。**

~~`migrateToOplog` の tx 内 re-check に「既存 batch が 1 件でもあれば migration せず marker だけ
立てる」を追加する。~~ **この案は採れない (2026-07-20 実装時に判明)** — W3d-1 が**意図的に
仕様化しテストで固定した挙動**を壊すため:

```
src/server/src/eventStore.test.ts:186  it('既存 (pre-W3) ログを破棄してから genesis で作り直す')
migrateFileToOplog.test.md            「pre-W3 増分ログが先に存在 → migration で増分を破棄し、
                                        snapshot 由来の genesis に置き換える」
```

pre-W3 のファイルは W2 の dual-write で**部分的な content batch だけを持つ** (genesis も構造 op も
無い) 状態がありうる。W3d-1 はそれを捨てて snapshot から作り直すのが目的だった。「op-log が空で
なければ migration しない」を入れると、その部分ログが永久に genesis を得られず projection が壊れ、
W3d-2 の snapshot フォールバックに落ちる。

**op-log の中身から「pre-W3 の部分ログ」と「受信 batch」を判別することはできない**:
genesis の有無では不可 (受信 batch にも genesis は含まれない — C1 で remote に push しないため)、
actor でも不可 (4d-2 が入るまで両方 `'local'`)、id でも不可 (どちらもランダム)。

#### 採用した対策 — marker を「正典宣言」として使う

**受信経路が batch を書くとき、同じ tx で marker を立てる** (`EventStore.appendReceivedBatches`)。
marker の意味を W3d-1 の「lazy migration 済」から拡張し、
**「この op-log は正典であり snapshot から作り直してはならない」宣言**として使う。

- 受信したファイル → marker が立つ → `GET` の migration は marker ゲートで no-op → **破棄されない**。
- 受信していないファイル → marker は無いまま → **W3d-1 の破棄→genesis が従来どおり動く**。
- **両者を分けるのが marker の役割**になる。`migrateToOplog` 自体は無変更。

残る縮退: **snapshot も marker も無いファイルに受信 batch だけが着地した場合**、marker が立つため
後から legacy snapshot が来ても migration されず、genesis が無いので projection が 0 シートになり
snapshot フォールバックに落ちる。これは §1.10 の bootstrap ギャップそのもので Phase 4e スコープ
(データ消失ではなく縮退)。

### 1.9 🔴 受信しても画面に出ない — 読取は openFile の 1 回きり (critic D-2・新規)

`projectFile` が走るのは `openFile` のときだけ (`useFileSheetOperations.ts:143-184`)。
編集中の状態は `activeFile` (React state) を `GraphEvent` / `applyEvent` で進めており、
op-log への書き込みは tap 経由の**片道**。

§2 の目標「取り込んだ結果が画面に反映される」を満たすには (1) 受信時の再 projection トリガ、
(2) 再 projection 結果と編集中 in-memory 状態のマージ (未 flush の `pendingEvents` / outbox を
失わないこと)、(3) React Flow の選択状態・編集中ノード・undo スタックの整合、が要る。

**初版が「配線」と呼んだ 4d-5 に本体級の問題が丸ごと隠れていた。** → §2 で非目標へ移し、
Phase 4e とする (§4)。

### 1.10 🔴 差分だけ受け取っても黙って消える — bootstrap ギャップ (critic D-3・新規)

- genesis batch は remote に**載らない** (`remoteFilter.ts:34`, C1 の不変条件)。
- `projectFile` は `structure.sheets` に無い `sheetId` の content batch を**丸ごと無視**
  (`project.ts:295`)。
- `applyOp` の更新系は対象が無ければ**無言で no-op** (`project.ts:118-120`)。

→ **「device B が A のシートを知らない」状態で A の content batch を受け取ると、1 件も反映されず、
エラーも警告も出ない**。しかも legacy snapshot 経路が画面を肩代わりするので気づけない。

これは初版の受入基準の抜け穴も突く。「画面を証拠にしない」(W3d5 critic A2 の継承) は徹底できて
いたが、今度は**「op-log に行が増えた」を証拠にしてしまう**新しい穴があった。
→ §5 に受入基準「適用不能 op が 0 件」を新設する。

### 1.11 その他の前提条件 (critic D-4〜D-7)

- **[High] 受信先ファイルがローカルに存在しない場合が未定義** (D-4)。`POST /files/:id/batches` は
  fileId の存在を検査せず追記するだけ (`index.ts:205-222`)。batches テーブルに FK は無く
  (`eventStore.ts:53-63`)、Sidebar のファイル一覧は snapshot storage 由来。未知の fileId の batch を
  受信すると**孤児 batch** が生まれ、ファイルは一覧に出ない。新規ファイルの跨端末伝播は
  現状 legacy snapshot 頼み。→ Phase 4e へ (§2 非目標)。
- **[Medium] echo ループ** (D-5)。受信 batch を `FanoutSyncProvider.push` 経由で書くと
  `remoteQueue.enqueue` が走り (`fanoutSyncProvider.ts:57-61`)、受信したものを remote へ送り返す。
  §3.3 の `POST` 直書きで実質回避されるが、**不変条件として明記する** (実装者が `provider.push` を
  使う誘惑は強い)。
- **[Medium] `catchUp` と fileId の相互作用** (D-6)。`catchUp` は remote をリポジトリ全体で pull し
  ローカル 1 ファイル分と id 突合する (`remoteSyncQueue.ts:80-85`)。`fileId` 必須化後は
  この突合も fileId でフィルタしないと無関係な全件を毎回舐めるコストが残る。→ 4d-1 の作業範囲。

---

## 2. 目標と非目標

### 目標 — 「受信が安全にローカル正典へ着地する」まで

- remote の batch op-log を取得し、**ローカル正典 (daemon op-log) へ取り込む**。
- 取り込みが**べき等**である。
- 取り込みが**失われない** — lazy migration に消されない (§1.8)、取りこぼさない (§1.3)。
- 取り込みが**因果順序を保つ** — Lamport 受信規則の配線 (§1.6) と順序規則 (§3.2)。
- 取り込みが**ローカル編集を壊さない** — 自分の編集が消えない、undo 履歴が壊れない。

### 非目標 (Phase 4e / 後続へ)

- **画面反映** (§1.9) — 再 projection トリガ、編集中 in-memory 状態とのマージ、undo スタック整合。
  React state マージという性質の異なる問題であり、実機検証と同じスライスに同居させない。
- **bootstrap ギャップの解消** (§1.10) — 両端末が同一 snapshot から genesis 済のファイルに
  スコープを限定する。未知シート・未知ノード宛の op が来る状況は 4e。
- **新規ファイルの跨端末伝播** (§1.11 D-4) — 現状どおり legacy snapshot 頼み。
- **コンフリクトの UX** — 決定論的に収束することまでを扱い、意味的衝突の提示は後続。
- **並行編集の判定** (vector clock) — §3.2 の理由により採らない。
- **branch の op-log 化** (step2)。受信は trunk のみ。
- **常時同期 (subscribe / Jetstream)** — §3.4。

> **このスコープ判断は W3d5 で「送信のみに絞る」としたのと同型である。**
> 受入基準が既に「画面を証拠にしない」(§5) ので、**画面反映が無くても Phase 4d は完全に検証可能**。

---

## 3. 設計判断

### 3.1 レコード形式の変更 — `fileId` と端末一意 `actor`

- **`fileId` の付与 (必須)**: ATProto の batch コレクションは repo 全体で 1 つなので、受信側は
  batch の適用先ファイルを復元できない。content batch は `sheetId` が間接的手掛かりになるが、
  **file 構造 batch は `sheetId` を持たない**ため手掛かりが皆無。→ `BatchRecord.fileId` を必須化。
- **端末一意 `actor` = `did#deviceId` の複合文字列**:
  - **DID 単独では不可** — 想定アクターモデルが単一ユーザー・複数端末である以上、DID では端末を
    区別できず、§1.1 が挙げた「因果と重複排除の単位の識別」を達成しない。
  - **deviceId 単独でも不可** — 出自 (誰の編集か) が失われ、権限・帰属・PDS リポジトリ所有者との
    照合ができない。step2 の共同編集で必ず必要になる。
  - `Actor = string` (`unified.ts:34`) なので**型変更不要**、`BatchRecord.actor: string` もそのまま。
    未ログイン時は `local#<deviceId>`。
  - **deviceId**: 初回起動時に UUID を 1 つ生成し localStorage へ。クリアされたら新端末として
    振る舞う — 正しさは失われず (actor が 1 つ増えるだけ) 再生成の設計を軽く保てる。
    **端末名など人間可読な値は混ぜない** (PDS 上に公開されるため)。
  - `LOCAL_ACTOR` (dead constant, §1.2) は削除する。`GENESIS_ACTOR` との比較
    (`remoteFilter.ts:34`) が複合 actor 導入後も壊れないことをテストで固定する。

**既存レコードの扱い**: `fileId` を持たない既存レコード (PDS 上に W3d5-7 検証の 7 件) は
**受信側で無視する。これを恒久ルールとする** — 破棄操作が不要になることより、
**「受信側は解釈できないレコードを安全に無視する」が将来にわたって必要な性質**であることが理由。
異なるバージョンのクライアントが同じ PDS を読む状況は必ず来る (`isBatchRecordValue` が既に
同じ思想: `batchMapper.ts:26-39`)。

> **条件: 無視した件数をカウントして警告に出す。** W3d5-7 で「PDS が float を拒否して全 push が
> 400、しかしコンソールは無言」という事故があった。**silent skip ではなく counted skip** とする。

### 3.2 順序規則 — Lamport 受信規則 + `(clock, actor, id)` 全順序

§1.1 / §1.4 / §1.6 の中核。2 つを組にして初めて成立する。

**(a) Lamport 受信規則の配線** — 受信時に `clock.observe(max(受信 clock))` を呼ぶ (§1.6)。
これにより clock が端末をまたいで「因果的に後」を表現し、`a.clock < b.clock` が意味を持つ。
プリミティブは既存 (`unified.ts:283`) で本番未使用なので、**追加コストはほぼ配線のみ**。

**(b) tiebreak から `timestamp` を外す** — `clock → timestamp → id` を **`clock → actor → id`** へ。
端末間で信頼できない唯一のキーが受信では常時主役になる (§1.1) のを断つ。

**退行なしが構造的に証明できる**: `LamportClock.tick()` は単調増加 (`unified.ts:277-280`) なので
**同一 actor 内で clock は必ず一意**。よって単一 actor では第 2 キーが発動せず、現行と完全に
同順序になる。回帰テストで機械的に固定できる。

**vector clock は採らない**: vector clock の唯一の追加情報は「2 つの操作が**並行**である」という
判定であり、それを消費するのは並行編集の提示 UX である。**§2 でそれを明示的に非目標にしている
以上、4d で払うコスト (レコード形式・GC・端末増加時のサイズ) に見合う消費者が存在しない。**
並行提示を実装する Phase で導入すべきで、そのときには actor が端末一意になっている (本 Phase の
成果) ので移行も容易。

**`foldFileStructure` (§1.4) は 4d では触らない**: 順序規則変更だけでは不十分な可能性がある
(`sheet.reorder` の「最新が全部勝つ」は並行編集で片方の並べ替えを丸ごと捨てる)。
**現状維持 + 現挙動をテストで固定**し、改善は 4e 以降へ。ここを 4d で触ると 4d-3 が破裂する。

### 3.3 受信の適用先 — ローカル正典への書き込みと 3 つの不変条件

受信 batch は **daemon の op-log (`POST /files/:id/batches`, べき等) へ書く**。
既存の読取経路・べき等性 (W1)・「ローカル正典が source of truth」を再利用できる。

> **初版はここで「以下が自動的に満たされる」と書いたが、楽観だった (critic 指摘)。**
> 以下の 3 条件を**追加で満たして初めて**成立する。

- **(a) 受信は fanout を通してはならない** (§1.11 D-5)。`FanoutSyncProvider.push` を使うと
  `remoteQueue.enqueue` が走り受信したものを remote へ送り返す (echo ループ)。
  受信は `POST /files/:id/batches` への直書きに限る。
- **(b) 受信の書き込みは migration marker と整合しなければならない** (§1.8)。
  4d-0 のガード (op-log が空でなければ migration しない) が入るまで、受信 batch を 1 件でも
  書いてはならない。
- **(c) 受信は自端末 clock を `observe` で前進させなければならない** (§1.6 / §3.2a)。

### 3.4 受信の起動契機 — 起動時 (ファイルオープン時) + `online` + 手動。subscribe は採らない

送信側 catch-up が既に「起動時 + `online` + 手動」で配線済み (`useEventSyncTap.ts:64-75`) なので、
**同じ `useEffect` に相乗りでき対称性も保てる**。W3d5 で検証済みの発火経路を再利用できる。

`subscribe` (10 秒 poll) を採らない理由:

- cursor が壊れている (§1.3) 以上、subscribe も同じ欠陥を継承する (内部で `this.pull` を呼ぶ)。
  **cursor を直さずに常時 poll を入れると取りこぼしが常態化する。**
- `pull` が全件 list である (§1.5) ため、10 秒ごとの全件取得は履歴とともに線形に重くなる。
- baseline 確立が失敗すると恒久的に取りこぼす (§1.5)。
- W3d5 で「まず送信だけを実機で通す」と絞ったのと同じ理由 — 一度に動かす部品を減らす。

subscribe は cursor 修正 (4d-4) と `list()` のページング両方が済んでから、Jetstream 化と併せて
別 Phase で扱う。

### 3.5 ローカル編集との干渉

受信は編集フローをブロックしてはならない (W3d5 §3.1 の不変条件「ローカル正典の前進は remote の
成否に依存しない」の受信版)。取り込み中でも編集・undo/redo は途切れないこと。
受信 batch は undo 対象外 (§1.7)。

---

## 4. 実装スライス分割

W3d5 と同様、**PDS 非依存の単体で閉じるスライスを先に積み、実機は最後に 1 つ**。

| スライス | 内容 | PDS 依存 |
|---------|------|---------|
| **4d-0** ✅ | **受信 batch を lazy migration から守る** (§1.8)。`EventStore.appendReceivedBatches` = 追記 + marker 立てを 1 tx で。marker を「正典宣言」として使い、`migrateToOplog` は無変更で W3d-1 の仕様を保つ | なし (server 単体) |
| **4d-1** ✅ | `BatchRecord.fileId` 必須化 + mapper 往復。`fileId` 無しレコードは counted skip (§3.1)。`RemoteBatch` エンベロープ + `Outbox<T>` 一般化。**`catchUp` の fileId フィルタ (§1.11 D-6) は 4d-4 へ送る** — `pull` が fileId を返せるようになってからでないと実装できないため | なし |
| **4d-2** | 端末一意 `actor` = `did#deviceId` (§3.1)。deviceId の生成・永続化。`LOCAL_ACTOR` 削除 | なし |
| **4d-3** | 順序規則: `observe` の配線 (§3.2a) + tiebreak を `clock → actor → id` へ (§3.2b)。単一 actor での同順序を回帰テストで固定。`foldFileStructure` は現挙動をテストで固定するのみ | なし |
| **4d-4** | `pull` の cursor をレコード順ベースへ (§1.3)。`maxClock` が返却対象外を算入する問題も修正 | なし |
| **4d-5** | 受信経路の配線 — remote pull → `POST /files/:id/batches` 直書き (§3.3)。3 つの不変条件を満たす | なし |
| **4d-6** | 実機 e2e (device A/B)。受入基準は §5 | **あり** |

**4d-0 は最優先**。受信 batch を 1 件でも書く前に入っていなければ、4d-6 の実機検証で
データ消失として現れる (§3.3b)。**現行コードにも存在する潜在バグ**なので単独で先に潰せる。

4d-3 が最も難度が高い。`observe` の配線 (受信規則) を含むため、順序規則だけの変更ではない。

初版の 4d-5 に畳まれていた「再 projection・画面反映」は §1.9 のとおり本体級の問題なので
**Phase 4e へ分離した** (§2 非目標)。

---

## 5. 受入基準

W3d5 §4.1 の教訓を継承する — **「画面に見える」を証拠にしない**。跨端末の伝播は legacy snapshot
経路 (`app.conversensus.graph.file`) が肩代わりしており、batch op-log が 1 件も届いていなくても
画面は正常に見える (W3d5 critic A2 を実機で確認済み)。

**さらに §1.10 により「op-log に行が増えた」も十分な証拠ではない** — 未知 sheetId 宛の content
batch は着地しても無言で projection から落ちる。基準 6 はこの穴を塞ぐためにある。

1. device A の編集が **device B のローカル op-log (`GET /files/:id/batches`) に現れ、かつ
   B の `projectFile` 結果に A の編集内容が含まれる**。
2. 取り込みが**べき等** — 2 回受信しても op-log の batch 数が増えず projection も変わらない。
   **併せて migration marker の状態も検査する** (§1.8 の回帰検出になる)。
3. **取りこぼしが無い** — §1.3 の cursor 回帰は**単体テストで固定**する。§1.1 の seed 機構により
   両端末の clock は genesis max から揃って進むので、実機で意図的に作らないと再現しない。
   **実機では「受信件数 = 送信件数」で代替する。**
4. **ローカル編集が壊れない** — 受信中の編集が消えない、受信 batch が undo 対象にならない。
5. 双方が**同じ projection に収束する** (A と B で `projectFile` の結果が一致)。
6. **適用不能 op が 0 件** — 受信 batch の全 op が実際に projection へ効いたこと
   (未知 sheetId / 未知 target による無言 no-op が無いこと) を計測して検査する (§1.10)。

検査は W3d5-7 の `scripts/inspect-remote-batches.ts` を拡張し、**ローカル op-log 側も検査**できる
ようにする。

---

## 6. リスク

- **4d-3 が step1 で最も設計依存の強い変更**。`projectFile` は読取経路の中核なので、単一端末の
  挙動にも影響しうる。「単一 actor では現行と同じ順序」を回帰テストで固定する (§3.2 のとおり
  `tick()` の単調性から構造的に証明できる)。
- **legacy snapshot 経路との二重反映**。受信で op-log に入った内容が legacy `file` レコード経由でも
  届くと二重に効く可能性がある。W3e (snapshot 退役) 前なので両系統が生きている。
- **コンフリクトの実物が初めて出る**。非目標に置いたが、収束した結果が人間に不可解な場合
  (「知らないうちに自分の変更が負けた」) の扱いは実機で観察して後続へ送る。
- **Phase 4e が実質的に大きい**。§1.9 (画面反映) + §1.10 (bootstrap) + §1.11 D-4 (新規ファイル伝播)
  が集まっており、4d より重い可能性がある。4d 完了時に改めて設計を起こす。

---

## 7. 未解決点

- **deviceId の再生成条件** (§3.1) — localStorage クリアで新端末扱いになる。正しさは失われないが、
  同一端末が actor を増やし続ける状況 (ブラウザのデータ削除を繰り返す等) の実害を実機で観察する。
- **Phase 4e のスコープ** — §1.9 / §1.10 / §1.11 D-4 をまとめて 1 Phase とするか分割するか。
  4d 完了後に改めて設計する。
- **`inspect-remote-batches.ts` の拡張範囲** (§5) — ローカル op-log 検査をどこまで自動判定にするか。

---

## 8. 確定した決定 (レビュー・合意ログ)

- 2026-07-20 (起案): W3d5 §6.1 の「`(clock, actor)` で tiebreak するので順序が決定不能」という
  記述を**訂正**。実装の tiebreak は `clock → timestamp → id` (`project.ts:44`) であり、actor が
  同一でも順序は決定論的に決まる。真の問題は (a) 端末をまたぐ clock 比較が因果的に無意味、
  (b) 第 2 キーの `timestamp` が端末間で信頼できない、の 2 点 (§1.1)。
- 2026-07-20 (起案): `projectFile` / `foldFileStructure` の **single-actor 前提** (`project.ts:195`,
  W3b critic H2-new) を受信の前提条件として明示 (§1.4)。
- 2026-07-20 (起案): 受信 batch は **undo 対象外**とする (§1.7)。構造上すでにそうなっているが、
  「他人の編集を自分の Ctrl+Z で消せてはならない」という要件として明記する。
- 2026-07-20 (起案): 受入基準は **ローカル正典の直接検査**とし、画面表示を証拠にしない (§5)。
- **2026-07-20 (critic レビュー REVISE 反映)**: 以下を確定。
  - **初版 §1.6 の訂正**: 「受信で seed に他端末 clock が混ざる、Lamport として正しい」は誤り。
    `ensureRestored` は起動時 1 回のみ (`eventSyncTap.ts:81`)、**`LamportClock.observe` は本番
    未使用**であり、**受信規則は実装されていない** (§1.6)。順序規則より先にこの配線が要る。
  - **初版 §1.3 の訂正**: cursor の取りこぼしは**現存の欠陥ではなく潜在欠陥**。cursor を永続化する
    主体が存在しない (`FanoutSyncProvider.pull` は local 委譲、`catchUp` は常に `INITIAL_CURSOR` で
    返り値を捨てる)。受信は cursor 永続化を前提とするので、直す必要があるという結論は不変 (§1.3)。
  - **W3d5-7 実測の clock 衝突は偶然ではない**: genesis の連番 clock + `seed` が +1 しないため、
    同一 snapshot から出発した端末は**構造的に同じ clock を発番する** (§1.1)。
  - **[Critical] lazy migration が受信 batch を DELETE する** (§1.8)。marker 単独のゲートは受信を
    想定していない。**4d-0 として最優先で潰す** — 現行コードにも存在する潜在バグ。
- **2026-07-20 (4d-1 実装): `fileId` は統一語彙 `Batch` に載せず、remote 境界のエンベロープ
  `RemoteBatch = { fileId, batch }` で運ぶ。** 判断の根拠は非対称性 — ローカルでは op-log が
  ファイル単位に仕切られており (`batches.file_id` 列) fileId は文脈から復元できるが、ATProto の
  batch コレクションは repo 全体で 1 つなので埋め込みが要る。`Batch` に載せると列と二重持ちに
  なり食い違う余地が生まれる。(対比: `sheetId` は 1 ファイルに複数シートがあり文脈から復元
  できないので `Batch` に載る。) 供給元はファイル単位の `FanoutSyncProvider`、消費先は
  セッション単位の `RemoteSyncQueue` / `AtprotoSyncProvider`。
  - 付随して **`Outbox` を `Outbox<T>` に一般化**した (重複排除キーの取り出しを `getId` で受け取り、
    `flush` は provider ではなく push 関数を取る)。キューの論理は項目の型に依らないため。
  - **`AtprotoSyncProvider` は `SyncProvider` ではなく `RemoteBatchTarget` を実装する**ようにした。
    `SyncProvider` はファイル単位の境界で、remote の repo 全体という粒度と噛み合わない。
  - **`catchUp` の fileId フィルタ (D-6) は 4d-4 へ送った** — `pull` が fileId を返せるように
    なってからでないと実装できない。現状は batch id (UUID) の突合なので誤マッチはせず、
    残っているのはコスト (無関係な全件を舐める) のみ。
- **2026-07-20 (4d-0 実装): §1.8 の対策を「op-log が空でなければ migration しない」から
  「受信時に marker を立てる」へ変更した。** 前者は W3d-1 が意図的に仕様化しテストで固定した
  「pre-W3 増分ログを破棄して genesis で作り直す」挙動 (`eventStore.test.ts:186`) を壊す。
  op-log の中身から pre-W3 部分ログと受信 batch は判別できない (genesis の有無・actor・id の
  いずれでも不可) ため、**書き込む側が marker で「正典である」と宣言する**方式を採った。
  `migrateToOplog` は無変更。両者を分けるのが marker の役割になる (§1.8)。
  - **[Critical] 受信は画面に出ない** (§1.9)。読取は `openFile` の 1 回きり。→ **Phase 4e へ分離**。
  - **[Critical] bootstrap ギャップ** (§1.10)。未知 sheetId 宛の content batch は着地しても無言で
    projection から落ちる。→ 受入基準 6 (適用不能 op が 0 件) を新設し、4d のスコープは
    「両端末が同一 snapshot から genesis 済のファイル」に限定する。
  - **`actor` = `did#deviceId` の複合文字列** (§3.1)。DID 単独では端末を区別できず、deviceId 単独
    では出自が失われる。`Actor = string` なので型変更不要。deviceId は初回起動時 UUID を
    localStorage へ。人間可読な値は混ぜない (PDS 上に公開される)。
  - **順序規則 = `observe` の配線 + `(clock, actor, id)` 全順序。vector clock は不採用** (§3.2)。
    `tick()` の単調性より**単一 actor では現行と完全に同順序**であることが構造的に証明できる。
    vector clock の追加情報は「並行である」判定のみで、それを消費する UX を §2 で非目標にして
    いる以上、消費者が存在しない。並行提示を実装する Phase で導入する。
  - **`foldFileStructure` は 4d では触らない** (§3.2)。現挙動をテストで固定するのみ。触ると
    4d-3 が破裂する。
  - **受信の起動契機 = 起動時 + `online` + 手動。subscribe は不採用** (§3.4)。送信側 catch-up と
    同じ `useEffect` に相乗りでき対称性も保てる。
  - **`fileId` 無しレコードは受信側で無視 (恒久ルール)** (§3.1)。破棄操作は不要。ただし
    **silent skip ではなく counted skip** — W3d5-7 の「400 が無言だった」事故の反省。
  - **§3.3 に不変条件を 3 つ追加**: 受信は fanout を通さない (echo ループ回避) / 受信の書き込みは
    migration marker と整合 / 受信は自端末 clock を `observe` で前進。
  - **スコープを「受信の着地」までに絞る** (§2)。画面反映・bootstrap・新規ファイル伝播は
    Phase 4e へ。受入基準が既に画面を証拠にしていないので、**画面反映が無くても 4d は完全に
    検証可能**。W3d5 で送信のみに絞った判断と同型。
