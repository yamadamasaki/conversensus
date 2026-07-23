# step1 Phase 4e 画面反映と bootstrap (受信 op-log → 構造の跨端末伝播 → 画面) — 設計

Phase 4d で **受信がローカル正典へ安全に着地する** ところまで通した (基準 1〜4 実機 PASS)。
だが 4d-6 の実機で **基準 5 (収束)・6 (適用不能 op 0 件) が原理的に達成できない** ことが
確定した。原因は 3 つの穴が残っていたためで、本 Phase はそれを塞ぐ:

1. **§1.10 bootstrap ギャップ** — genesis batch が remote に載らない (C1) ため、受信側は
   `sheet.create` を知る手段が無く、受信 content op が全件 `unknown-sheet` で落ちる。
2. **§1.9 画面反映** — `projectFile` は `openFile` の 1 回きり。受信してもローカル正典に
   着地するだけで、開いている画面 (`activeFile` React state) には反映されない。
3. **§1.11 D-4 新規ファイル伝播** — 受信先ファイルがローカルに無い場合が未定義。genesis が
   載らないので新規ファイルは op-log 経由で伝わらず、現状 legacy snapshot 頼み。

節番号 (§1.9 / §1.10 / §1.11) は Phase 4d 設計 `step1-phase4d-receive.md` を引き継ぐ。

> **本設計は critic レビュー (2026-07-22, Opus, 実コード裏取り込み) を経て REVISE 判定を受け、
> 指摘を反映した第 2 版である。** 初版は §1 の事実主張こそ実コードと一致していたが、
> **設計判断とスライス計画に 3 件の MAJOR があった**: (M1) 4e-0 で外そうとしている C1 除外を
> **既存テストが固定していた** (`remoteFilter.test.ts:80,85`) — Phase 4d の教訓 (既存仕様との衝突) の
> 再発、(M2) スライス 4e-2 の「PDS 依存なし」ラベルが誤り (client の発見経路は PDS 依存)、
> (M3) §3.2b の `GET /files` 和集合が「op-log-only ファイルは名前を持たない」問題を過小見積り。
> 反映の経緯も各節に残す。

---

## 1. 現状把握 (コード実態・2026-07-22 時点)

### 1.1 bootstrap ギャップの機構 (4d-6 実機で確定)

3 つの事実が積み重なって「受信 content op が全件無言で落ちる」を作る:

- **genesis batch は remote に載らない** — `filterBatchesForRemote` が `actor === GENESIS_ACTOR`
  の batch を丸ごと落とす (`remoteFilter.ts:34`)。これが C1 不変条件。
- **`sheet.create` は genesis batch にしか無い** — ファイル作成時に `graphFileToBatches` が
  各シートについて `sheet.create` を発行する (`genesis.ts:216-223`)。通常編集で
  `sheet.create` が出る経路は無い (構造イベントの `SHEET_CREATED` は syncRecord へ流れるが、
  新規ファイル作成の初期シートは genesis 側で作られる)。
- **`projectFile` は未知 sheetId の content batch を丸ごと無視** (`project.ts:295` 付近)、
  `applyOp` の更新系は対象が無ければ無言で no-op。

→ **受信側は op-log 経由でシートの存在を知る手段が原理的に無い**。4d-6 で device B の
受信 op 5 件がすべて `unknown-sheet` で落ちた。

### 1.2 genesis は content-addressed で端末間べき等 (C1 見直しの前提)

C1 のコメントは「受信経路が無い**現状で** genesis を remote に載せると、各端末が独立生成する
genesis と clock が衝突し remote が汚染される」(`remoteFilter.ts:8-10`) と条件付けている。
Phase 4d で受信経路ができた今、この前提を検証し直す。

- **genesis batch の id は ops 内容だけから決定論的に導く** — `id =
  deterministicUuid(stableStringify(ops))` で、**actor / timestamp / clock を含めない**
  (`genesis.ts:47-48, 77`)。
- **genesis の clock は一意連番** `GENESIS_CLOCK_START(=1) .. N` (`genesis.ts:196, 201`)。
- ゆえに **同一 snapshot から genesis した 2 端末は、batch の id も clock も完全に一致する**。

→ **genesis を remote に載せても、受信側は id 一致でべき等 dedup できる**
(`appendBatch` の batch_id べき等性)。C1 のコメントが警戒した「clock 衝突で汚染」は、
**同一 snapshot なら起きない**。汚染が起きるのは「**異なる** snapshot から genesis した
2 端末が push する」場合に限られる (§3.1 でこの残余リスクを扱う)。

> **critic MED1 (残余リスク・float 経路)**: この dedup は 2 端末が **バイト等価な snapshot** から
> genesis することに依存する。genesis ops には `node.setLayout` の x/y など float が含まれ
> (`genesis.ts:86-104`)、W3d5-7 で **PDS が float を拒否した**実績がある
> (`fanoutSyncProvider.ts:122-124`)。float の直列化差が端末間・PDS 往復で生じると
> `stableStringify` がずれ id が食い違い dedup が外れる。**4d で layout を整数へ丸める対策
> (`toUnified.ts` の `nodeSetLayoutOp`) を入れたのでこの経路は塞がっているはず**だが、
> 4e-4 実機で 2 端末の genesis id を突き合わせて確認する (§5 / §7)。

> **critic Minor (非暗号ハッシュ)**: `deterministicUuid` は 32bit FNV-1a (`genesis.ts:50-56`) で
> 暗号強度が無い。異内容 genesis の id 衝突 (一方が誤 dedup で消える) は理論上あり得るが、
> 1 ユーザのファイル数では無視できる。

**ユーザー決定 (2026-07-22): 方針 A = genesis を push (C1 見直し) を採る。** bootstrap を
op-log 内で完結でき、snapshot 退役 (W3e) の方向とも一致する。方針 B (legacy snapshot で
bootstrap) は退役予定の経路への依存を強めるため不採用。

### 1.3 画面反映が無い — 読取は openFile の 1 回きり (§1.9 の再掲・実コード再確認)

- `projectFile` が走るのは `openFile` → `loadFile` のとき、および `handleCreate` の作成直後
  (`useFileSheetOperations.ts:147-188, 224-226`)。**いずれもファイルを開く/作る瞬間の 1 回きり**で、
  受信を契機に走る経路は無い (import は projection せず直接 `setActiveFile`, `:393`)。
- 編集中の状態は `activeFile` (React state, `setActiveFile`) を `GraphEvent` / `applyEvent` で
  進める片道。op-log への書き込みは tap 経由で、読取とは非対称。
- 受信 (`receiveRemoteBatches`) はローカル正典 (daemon op-log) に書くだけで `activeFile` に
  触れない。→ **受信しても画面は変わらない**。

反映を実現するには 3 つが要る (Phase 4d §1.9 の指摘):
1. 受信時の**再 projection トリガ**。
2. 再 projection 結果と**編集中 in-memory 状態のマージ** — 未 flush の pending event / outbox を
   失わないこと。
3. React Flow の**選択状態・編集中ノード・undo スタックの整合**。

### 1.4 新規ファイルがサイドバーに出ない (§1.11 D-4 の再掲)

- `POST /files/:id/batches` (および `/received`) は fileId の存在を検査せず追記する
  (`index.ts` 付近)。batches テーブルに FK は無い (`eventStore.ts`)。
- Sidebar のファイル一覧は **snapshot storage 由来** (`listFiles` → `storage.ts`)。op-log にしか
  存在しないファイルは一覧に出ない。
- `receiveRemoteBatches` は**開いているファイル 1 つ**にスコープを絞り、他ファイル宛の batch を
  捨てる (`receiveRemoteBatches.ts:60-63`)。→ そもそも新規ファイルは受信対象にすらならない。

→ genesis が push されるようになれば (§1.2) 受信側はファイルの `file.setName` と `sheet.create` を
op-log から得られる。あとは **「未知 fileId の genesis を受信したらローカルにファイルを作る」**
経路が要る。

### 1.5 受信スコープの現状 — 1 ファイル pull

`receiveRemoteBatches` は `pullRemote()` で repo 全体を取得し fileId で 1 ファイル分に絞る
(`receiveRemoteBatches.ts:56-63`)。新規ファイル発見 (§1.4) には **repo 全体を走査して未知
fileId を見つける**経路が要り、現状の 1 ファイルスコープでは足りない。ただし repo 全体 pull は
既に `pullRemote` が返しているので、**フィルタを変えるだけで済む** (追加の pull は不要)。

---

## 2. 目標と非目標

### 目標 — 「受信が構造ごと画面に反映され、両端末が収束する」まで

- **bootstrap**: 受信側が `sheet.create` を含む genesis を op-log 経由で取得し、
  未知シート宛の content op が正しく着地する (§1.10 を塞ぐ)。
- **画面反映**: 受信がローカル正典に着地したら、開いている画面に反映される (§1.9 を塞ぐ)。
  未 flush の編集を失わない。
- **新規ファイル伝播**: 未知 fileId の genesis を受信したらローカルにファイルが現れる
  (§1.11 D-4 を塞ぐ)。
- **収束**: device A と B の `projectFile` 結果が一致する (Phase 4d の旧基準 5)。
- **適用不能 op 0 件**: 受信 batch の全 op が projection へ効く (Phase 4d の旧基準 6)。

### 非目標 (後続へ)

- **コンフリクトの UX** — 決定論的に収束することまでを扱い、意味的衝突の提示は後続。
- **並行編集の判定** (vector clock) — Phase 4d §3.2 の理由により採らない。
- **`foldFileStructure` の並行マージ改善** — `sheet.reorder` の「後勝ち」等は現挙動維持
  (Phase 4d でテスト固定済)。意味的マージは後続。
- **常時同期 (subscribe / Jetstream)** — Phase 4d §3.4。起動時 + `online` + 手動のまま。
- **snapshot 経路の退役 (W3e)** — 本 Phase で bootstrap が op-log に移っても、snapshot 読取
  フォールバック (`READ_FROM_OPLOG`) と Sidebar の snapshot 由来一覧は残す。退役は W3e。
- **branch の op-log 化** (step2)。受信は trunk のみ。
- **undo スタックへの受信の統合** — 受信 batch は undo 対象外 (Phase 4d §1.7)。受信で
  undo 履歴を壊さないことは扱うが、受信を undo できるようにはしない。

---

## 3. 設計判断

### 3.1 C1 見直し — genesis を remote へ push する

**`filterBatchesForRemote` の genesis 除外 (§1.1) を外す。** presentation 除外 (D7) は残す
(genesis batch にも presentation op は含まれ得るため、remote には非 presentation だけ載せる)。

**残余リスク: 異なる snapshot からの genesis 分岐** (§1.2)。同一ファイルを 2 端末が
**異なる内容の snapshot** から genesis すると、低位 clock (1..N) を共有しつつ id が食い違う
2 系統の構造履歴が remote に載る。これが起きるのは:

- device A がファイルを作り編集 (snapshot が進む) → その snapshot から genesis。
- device B が **A の編集前の古い snapshot** を持っていて、そこから独立 genesis。

**対策: 受信側は genesis を「自前生成」より「受信」を優先する。** 具体的には:

- 未知 fileId の genesis を受信したら、その genesis を**そのまま**ローカル正典へ書く
  (自前で `graphFileToBatches` し直さない)。→ 作成端末の genesis が唯一の起源になる。
- 既知 fileId で、ローカル genesis と受信 genesis の id が一致するなら dedup (§1.2)。
- id が食い違う (異なる snapshot 由来) 場合は **両方 op-log に載る**が、`orderBatches`
  (`clock → actor → id`) で決定論的に順序づき、`projectFile` が畳む。**収束はする**が、
  片方の初期構造がもう片方に上書きされる形になり得る。**この分岐は本 Phase の受入基準では
  「収束する」ことのみ要求し、意味的な正しさ (どちらの構造が勝つべきか) は非目標**とする。

> **収束が成り立つ本当の理由 (critic MED2 反映)**: 2 系統の genesis が食い違っても収束するのは、
> **entity ID (sheetId / nodeId / edgeId) が両端末で一致する**ためである。device B は A のファイルを
> snapshot 経由で得ており、snapshot は entity ID をそのまま持つので、B の genesis は A と同じ
> entity ID で構造 op を作る。ゆえに 2 系統の genesis は「同じ entity に対する重複した create/setName」
> になり、`projectFile` の畳み込みで決定論的に 1 つへ収斂する (別 entity を増やすのではない)。
> genesis 同士の `orderBatches` tie-break は clock も actor (`GENESIS_ACTOR`) も共有するので
> **最終的に id で決まる** (`project.ts:53-59`)。
>
> **critic MED2 の訂正**: 初版の「bootstrap を op-log に移せば分岐が減る」は**定常状態でのみ真**。
> 既存ファイルの初回 cross-device 共有は、誰かが genesis を push するまで op-log に載らないので
> 依然 snapshot 経由である。異 snapshot 分岐は「オフライン並行編集の限定シナリオ」ではなく、
> **作成端末が genesis 後に編集してから B が古い snapshot で開けば通常フローで起きる**。
> それでも entity ID 共有により収束するので受入基準は満たせる。

> **方針 C を退けた理由への補足 (critic Skeptic 反映)**: 方針 C (bootstrap 専用レコードを
> 端末一意 actor で push) は、異 snapshot 分岐を**構造的に防げる**利点がある (genesis を単一起源に
> できる)。それでも A を採るのは、(1) genesis の content-addressed べき等 (§1.2) で分岐しても
> **収束は保証される**こと、(2) 新レコード種別の設計・mapper・GC コストが、防げる分岐の稀さに
> 見合わないこと、による。分岐が実害を生むと 4e-4 で判明したら方針 C を後続で再検討する。

### 3.2 受信スコープの拡張 — repo 全体を走査し未知ファイルを発見する

現状の「開いているファイル 1 つ」スコープ (§1.5) を、**2 段**にする:

- **(a) 開いているファイルの差分受信** — 現状どおり。`receiveRemoteBatches` が担う。
- **(b) 未知ファイルの発見と materialize** — `pullRemote` の結果を fileId ごとにまとめ、
  ローカル正典に存在しない fileId について genesis を含む batch 群をローカルへ書き、
  **Sidebar 一覧に現れるようにする**。

**(b) の起動契機**: (a) と同じ「起動時 + `online` + 手動」に相乗りする (Phase 4d §3.4)。
新規ファイル発見は起動時に 1 回走れば十分で、subscribe は要らない。

**materialize は `POST /files/:id/batches/received` (marker 経路) を使う (critic ギャップ反映)**。
plain `appendBatches` で書くと、snapshot が存在する fileId に対して次の
`GET /files/:id/batches` が `migrateFileToOplog` (`index.ts:261`) を起動し
`DELETE FROM batches` で受信 genesis を破棄し得る (§1.8 と同型の事故)。marker 経路
(`eventStore.ts:263` の `appendReceivedBatches`) なら追記と marker 立てが 1 tx なので、
lazy migration が「op-log は正典宣言済み」と判断して破棄しない。**受信 (a) と同じ書込口を使う**。

**「Sidebar に現れる」の実現方法** (§1.4): Sidebar は snapshot storage 由来の `listFiles`
(`storage.ts:19-31`、`{id, name, description}` を返す)。op-log にしか無いファイルを一覧に
出すには、`listFiles` を **snapshot storage と op-log の和集合**にする必要がある。

> **critic M3 (名前解決の過小見積り)**: op-log 側は「batches テーブルの distinct file_id」だが、
> **distinct file_id は ID だけで name を持たない**。Sidebar が要求する `GraphFileListItem`
> (`useFileSheetOperations.ts:105`) は name を要する。op-log-only ファイルの name を得るには
> **`file.setName` op を畳む** (最低限 file 構造 fold、実質 per-file の軽量 projection) 必要がある。
> → `EventStore` に (1) distinct file_id 列挙 + (2) 各 file_id の file 構造 op を畳んで
> `{name, description}` を得るメソッド (既存 `projectFile` の再利用も可) を追加する。
> **重複排除**: snapshot と op-log の両方に在るファイルは fileId で distinct にし、
> **snapshot 側の name/description を正**とする (op-log projection は fallback)。
> **順序**: 既存の snapshot 順を先に、op-log-only を後に足す (作成 clock 順)。

**この変更は hot path (ファイル一覧) に触る**ので慎重に。dual-read と同様、snapshot 側を
既定で残し op-log 側を足す。

> **4e-2a 実装時の追加判断 (2026-07-23)**: op-log 側の列挙は **projection が 0 シートの
> file_id を除外する** (`EventStore.listOplogFiles`)。有効な GraphFile は必ず 1 シート以上
> 持つ (W3d-2 の読取失敗判定と同じ基準) ため、genesis の無い孤児 batch だけの file_id
> (D-4、テスト用の生 file_id への直接 POST などで生じる) を一覧に出すと、開いても
> 描画できない項目が並ぶ。name の fold は `projectFile` を再利用 (第 2 実装を作らない)。

### 3.3 画面反映 — 受信後の再 projection と in-memory マージ

**方針: 受信が着地したら、開いているファイルを再 projection し、`activeFile` を差し替える。**
ただし **編集中の未 flush 状態を失わない**ことが不変条件。

- **再 projection トリガ**: `receiveRemoteBatches` が `appended > 0` を返したら、
  `loadFile(activeFile.id)` 相当を再実行して `activeFile` を作り直す。
- **in-memory マージの問題** (§1.3): 編集は `activeFile` を React state で進め、tap 経由で
  op-log へ**非同期に** flush される。受信時に「op-log にまだ載っていないローカル編集」が
  あると、再 projection がそれを含まない結果で `activeFile` を上書きし、**編集が消える**。
  - **対策案 α (drain 待ち合わせ)**: 再 projection の前に tap の pending を flush し切る。
    op-log が最新のローカル編集を含んでから projection するので取りこぼさない。
    **待ち合わせ点はコード上に存在する (critic MED3)**: `EventSyncTap.settled()`
    (`eventSyncTap.ts:84`) が `flushChain` を await し、`FanoutSyncProvider.push`
    (`fanoutSyncProvider.ts:65-69`) は `local.push` の成功で resolve し remote を待たない。
    ゆえに `settled()` = **ローカル drain 完了**で remote は待たない。
  - **対策案 β (projection を編集の下に敷く)**: 受信分だけを現 `activeFile` に `applyOp` で
    重ねる。projection をやり直さず差分適用。速いが、構造 op (sheet 追加等) の適用ロジックを
    React state 側に二重実装することになり `projectFile` と乖離する危険。
  - **推奨: α (ローカル drain 待ち → 全再 projection)**。`projectFile` は実測 <1ms
    (Phase 4d W3d-3 ベンチ) なので全再 projection のコストは無視できる。二重実装を避けられる。
  - **配線が要る 2 点 (critic MED3)**: (1) `useEventSyncTap` は現在 record コールバックしか
    返さず `settled()` を公開していない (`useEventSyncTap.ts:118-121`) ので、4e-3 で hook の
    戻り値に `settled` を surface する。(2) `settled()` は**ローカル push 失敗時も resolve する**
    (`drain` は offline で throw せず return, `eventSyncTap.ts:162-165`)。初版が書いた
    「ローカル flush はブロッキング成功する」は **local daemon 健在時のみ真**。local 失敗時は
    編集が pending に残り、再 projection がそれを落とし得る。→ **再 projection 前に
    「pending が空になったか」を確認し、空でなければ差し替えを見送る** (次の受信/編集確定まで待つ)。
- **再 projection と record のレース (critic MED4)**: drain → op-log 読取 → `activeFile` 差替の
  間に新規 record が入ると取りこぼす。→ **「drain → 読取 → (その間に pending が増えていないか
  再確認) → 増えていなければ swap、増えていたら再ループ」** の順序保証を入れる。
- **React Flow 整合** (§1.3-3): `activeFile` 差し替え時に、選択中ノード・編集中テキストの
  扱いを決める。**編集中 (ノードのテキスト入力中など) は再 projection を保留**し、編集確定後に
  反映する。「編集中」の検出点は React Flow のどの状態を見るか — **テキスト編集中フラグ
  (ノードの inline editor がアクティブか) と、選択中ノードのドラッグ中フラグ**を候補とし、
  4e-3 実装時に具体化する (§7 で未確定として残す)。undo スタックは受信を含めない
  (受信は undo 対象外, §2)。

> **critic に問う点 (§7)**: 対策 α の「ローカル drain 待ち」は、tap の現 API で
> ローカル flush だけを待てるか? `FanoutSyncProvider.whenRemoteSettled()` は remote 用。
> ローカル push は await 済み (同期) なので、pending event が record されてから
> graphEventToBatch → local push が完了するまでの待ち合わせ点が要る。

> **4e-3 実装時の実績 (2026-07-23)**:
> - 順序保証 (drain → pending 確認 → 読取 → pending 再確認 → swap) は純関数
>   `reprojectAfterReceive` に切り出した (receiveRemoteBatches / discoverRemoteFiles と
>   同じ調整層の型)。MED4 のリトライは上限 3 回で打ち切り `defer` — 編集が連続する間は
>   差し替えないほうが安全で、次の受信契機が拾う。
> - **設計からの逸脱: `settled()` は hook の戻り値ではなく `onReceived` コールバックの
>   引数 (TapHandle) として渡す。** 戻り値を record 関数からオブジェクトへ変えると
>   全呼び出し箇所とテストが割れる一方、待ち合わせ点が要るのは受信着地の瞬間だけ。
>   `useEventSyncTap({ onReceived })` が `(fileId, result, { settled, pending })` を渡し、
>   `useFileSheetOperations` が reproject → `activeFile` / `activeSheetId` 差し替えを行う
>   (開いていたシートが受信で消えていたら先頭へ退避)。
> - **編集中の検出は `document.activeElement` ヒューリスティック** (App.tsx): inline
>   editor は `<textarea>` (EditableNode) / `<input>` (EditableLabelEdge) なので、
>   フォーカスが入力要素にあれば編集中とみなし swap を保留する。**ドラッグ中の検出は
>   入れていない** (§7 未解決点のまま): ドラッグ中の swap は React Flow の内部状態と
>   ずれ得るが、drop 時の NODE_MOVED が最終位置を record し次の受信で収束する。
>   実機 (4e-4) で問題が観測されたら React Flow の drag 状態を足す。

### 3.4 適用不能 op の扱い — 計測器を実機ゲートに使う

Phase 4d-6 で作った `applicability.ts` (op が projection へ効いたかの計測) を、本 Phase の
**受入基準 6 の判定器**としてそのまま使う。bootstrap が塞がれれば `unknown-sheet` の drop が
0 件になるはずで、それを実機で確認する。

---

## 4. 実装スライス分割

Phase 4d と同様、**PDS 非依存で単体で閉じるスライスを先に積み、実機は最後に 1 つ**。

| スライス | 内容 | PDS 依存 |
|---------|------|---------|
| **4e-0** | C1 見直し: `filterBatchesForRemote` の genesis 除外を外す (§3.1)。presentation 除外は残す。genesis の id 一致べき等を単体テストで固定。異なる snapshot 由来の分岐が entity ID 共有により `orderBatches` で収束することもテストで固定。**既存テストの書換必須 (critic M1)** — 下記 | なし |
| **4e-1** | 受信スコープ拡張 (§3.2a): `receiveRemoteBatches` が genesis を含む未知シートを取り込めることを確認 (4e-0 で genesis が pull に載るようになった上で)。bootstrap が塞がることを `applicability` 計測で単体確認 | なし |
| **4e-2a** | `GET /files` を snapshot storage と op-log の和集合に (§3.2b)。`EventStore` に distinct file_id + file 構造 fold で `{name, description}` を得るメソッドを追加。重複排除・順序は §3.2b。**server 単体で閉じる** | なし |
| **4e-2b** | 未知ファイルの発見と materialize (§3.2b): client が `pullRemote` を fileId ごとに束ね、ローカル未存在のファイルを `POST /files/:id/batches/received` (marker 経路) へ書く。**発見経路は remote/PDS 取得を含む** (critic M2) | **あり** |
| **4e-3** | 画面反映 (§3.3): 受信後の再 projection トリガ + `EventSyncTap.settled()` を hook から公開 + ローカル drain 待ち + pending 再確認 + `activeFile` 差し替え。編集中は保留。React state マージの単体テスト (未 flush 編集が消えないこと) | なし |
| **4e-4** | 実機 e2e (device A/B)。Phase 4d の旧基準 5 (収束)・6 (適用不能 op 0 件) を含む全 6 基準を検査。4e-2b の発見経路もここで実機検証。`inspect-local-oplog.ts` + `applicability.ts` を再利用 | **あり** |

**4e-0 が最初** — genesis が pull に載らなければ後続すべてが空回りする。
**4e-3 (画面反映) が最も難度が高い** — React state マージと編集中保留の整合。

**4e-0 で書き換える既存資産 (critic M1)**: 以下は C1 の**旧**挙動 (genesis を remote に載せない) を
固定・記述しているので、新挙動 (genesis が remote に通る) へ書き換える:
- `remoteFilter.test.ts:80` `it('genesis actor の batch は ... 丸ごと除外する (C1)')` — 削除ないし反転。
- `remoteFilter.test.ts:85` `it('複数 batch: genesis 除外・presentation skip・content 通過...')` — genesis が通るよう書き換え。
- `remoteFilter.ts:8-14` のヘッダコメント (genesis 除外の理由) を更新。
- `genesis.ts:7-16` の「local-only / remote へは通常 push しない」コメントを更新。

> **4e-0 実装時の実績 (2026-07-23)**: 上記に加え、旧 C1 を固定する既存資産が 3 ファイルで
> 追加で見つかった (M1 リストの過小見積り — Phase 4d 教訓の再発):
> `remoteSyncQueue.test.ts` (enqueue / catchUp の genesis 除外 2 本)、
> `fanoutSyncProvider.test.ts` (remote leg フィルタ 1 本)、
> `useEventSyncTap.test.ts` (起動時 catch-up 1 本)、および各 `.test.md` と
> `remoteSyncQueue.ts` ヘッダコメント。すべて新挙動 (genesis 通過) へ書き換えた。

### スライスの依存

- 4e-1 は 4e-0 に依存 (genesis が remote に載ってから受信を確認できる)。
- 4e-3 は 4e-1 に依存 (bootstrap が塞がってから画面反映を確認する意味がある)。
- 4e-2a (server 単体・和集合) は 4e-0 と独立に進められる。4e-2b (client 発見・materialize) は
  4e-0 と 4e-2a に依存し、検証境界が実機寄りなので 4e-4 の実機と組で見る。

---

## 5. 受入基準

Phase 4d の 6 基準を継承し、**4d で 4e へ送った基準 5・6 を本 Phase で達成する**。
Phase 4d の教訓 —「画面に見える」も「op-log に行が増えた」も証拠にしない — を継承する。

1. **bootstrap が塞がる**: device B が A の `sheet.create` を op-log 経由で受け取り、A の
   content op が着地する (`unknown-sheet` drop が 0 件)。
2. **画面反映**: 受信後、B の開いている画面に A の編集が現れる。**かつ** B 自身の**ローカル未 flush
   編集** (daemon 到達前、remote 未送信ではない — critic Ambiguity) が消えない。
3. **新規ファイル伝播**: A が新規作成したファイルが、B の Sidebar に op-log 経由で現れる
   (legacy snapshot を消しても現れること)。**前提 (critic ギャップ)**: materialize が marker 経路
   (`/batches/received`) で書いていること。marker 未設定だと snapshot 削除後の
   `GET /files/:id/batches` が空を返し openFile が失敗する (`loadFile` の sheets.length===0 →
   snapshot fallback → 404)。基準 3 の成立はこの依存に乗る。
4. **収束** (旧基準 5): A と B で `projectFile` の結果が一致する。
5. **適用不能 op 0 件** (旧基準 6): 受信 batch の全 op が projection へ効く。
   `applicability.ts` の `drops` が 0 件。
6. **べき等・ローカル編集非破壊** (Phase 4d 基準 2・4 の回帰): 2 回受信で batch 数・projection
   不変、marker 保持、受信中の編集残存、受信 batch が undo 対象にならない。

検査は Phase 4d と同じ `scripts/inspect-local-oplog.ts` + `applicability.ts`。基準 3 は
「legacy snapshot を消した状態で B の Sidebar にファイルが出るか」で判定する
(op-log 経由の伝播であることを保証するため)。

**4e-4 で追加確認する項目 (critic MED1)**: 2 端末の genesis batch の id を突き合わせ、
同一 snapshot からの genesis が実機でも id 一致すること (float 直列化差で dedup が外れて
いないこと) を確認する。外れていたら §1.2 の残余リスクが現実化している。

---

## 6. リスク

- **[High] `GET /files` の hot path 変更** (§3.2b) — Sidebar 一覧に op-log 側を足すのは
  全ファイル一覧の性能・正しさに直結する。dual-read と同様に snapshot 側を既定で残す。
- **[High] 画面反映の React state マージ** (§3.3) — 未 flush 編集の消失は最も起きやすい
  退行。ローカル drain 待ちの待ち合わせ点が正しく取れないと編集が消える。
- **[Medium] 異なる snapshot 由来の genesis 分岐** (§3.1) — 収束はするが意味的正しさは
  保証しない。受入基準は「収束」のみ要求。
- **[Medium] 編集中保留の判定** (§3.3) — 「編集中」の定義 (テキスト入力中 / ノード選択中) が
  曖昧だと、反映が遅れる or 編集が飛ぶ。

---

## 7. 未解決点

critic レビューで解決した項目は §3 本文へ反映済み。残る未確定は以下:

- **[4e-3 実装時に確定] 「編集中」の検出点**: テキスト inline editor がアクティブか +
  選択中ノードのドラッグ中フラグ、を候補とする (§3.3)。React Flow のどの state を見るかは
  4e-3 実装時に具体化する。
- **[4e-4 実機で確認] 異 snapshot 分岐の実害と float 経路**: entity ID 共有で収束はするが
  (§3.1)、片方の初期構造上書きがユーザ体感にどう出るか、および 2 端末の genesis id が
  実機で一致するか (§1.2 MED1) を 4e-4 で確認する。実害が出たら方針 C を後続で再検討。
- **[要判断] β の可否**: 対策 α (全再 projection) は `projectFile` <1ms 前提。本 Phase の
  ファイル規模でこの実測が成り立つかは Phase 4d W3d-3 ベンチの範囲。逸脱したら β (差分適用) を
  再検討する。

### critic が解決した点 (§3 へ反映済み)

- **§3.3 ローカル drain 待ち合わせ点**: `EventSyncTap.settled()` が存在する (MED3)。
  hook から公開する配線が 4e-3 に要る。local push 失敗時 (`settled()` が失敗でも resolve) の
  扱いも §3.3 に追記済み。
- **§3.2b 名前・順序・重複排除**: op-log-only ファイルは file 構造 fold で name を得る (M3)。
  snapshot 側 name を正、fileId で distinct、snapshot 順→op-log-only 順、と §3.2b に確定。
- **§3.1 収束の理由**: entity ID 共有による (MED2)。§3.1 に明記済み。

---

## 8. 確定した決定 (レビュー・合意ログ)

- **2026-07-22 (方針決定)**: bootstrap の分岐点について、ユーザーが **方針 A = genesis を push
  (C1 見直し)** を選択。根拠は genesis が content-addressed で端末間べき等 (§1.2) なので
  C1 のコメントが警戒した clock 衝突が同一 snapshot では起きないこと、および bootstrap を
  op-log 内で完結でき W3e (snapshot 退役) の方向と一致すること。方針 B (legacy snapshot で
  bootstrap) は退役予定経路への依存を強めるため不採用。方針 C (構造 bootstrap 専用レコード) は
  異 snapshot 分岐を構造的に防げる利点はあるが、A でも収束は保証される (§3.1) ため新レコード
  種別のコストに見合わず不採用 (分岐が実害を生むなら後続で再検討)。

- **2026-07-22 (critic REVISE 反映)**: oh-my-claudecode:critic (Opus, 実コード裏取り込み) が
  REVISE 判定。核心前提 (§1.2 genesis id の内容決定性・clock 決定性) は実コードで裏取りでき
  正しいと確認された一方、3 MAJOR を指摘し全て反映した:
  - **M1**: 4e-0 で外す C1 除外を既存テスト (`remoteFilter.test.ts:80,85`) が固定していた
    (Phase 4d の「既存仕様との衝突」教訓の再発)。→ §4 に書換対象として明記。
  - **M2**: 4e-2 の「PDS 依存なし」が誤り (client 発見経路は PDS 依存)。→ 4e-2a (server 単体) と
    4e-2b (client 発見・実機寄り) に分割。
  - **M3**: §3.2b の `GET /files` 和集合が「op-log-only ファイルは name を持たない」問題を
    過小見積り。→ file 構造 fold で name を得る方針を §3.2b に明記。
  - MEDIUM も反映: MED1 (float 経路の残余リスク→§1.2 + §5 で実機確認)、MED2 (収束の理由は
    entity ID 共有→§3.1)、MED3 (`settled()` が待ち合わせ点・local 失敗時の扱い→§3.3)、
    MED4 (再 projection と record のレース→§3.3)。ギャップ (materialize は marker 経路を使う、
    基準 3 の marker 依存) も §3.2b / §5 へ反映。

- **2026-07-23 (4e-4 実機 e2e 完了)**: PDS (docker) + device A/B 2 組 (`data-4e4-a/b`,
  :3000/:5173 と :3001/:5175) + Chrome 実操作で検証した。結果:
  - **§5 の全 6 基準 PASS** (両端末 × `inspect-local-oplog.ts` 2 回実行)。収束 fingerprint は
    両端末で一致 (`dfd0ce8ca7c6cedb`)。べき等 (再受信で batch 14 件・projection 不変) も確認。
  - **MED1 (genesis id 突合) PASS**: 実機の genesis は remote 上で (fileId, clock) ごとに
    1 id へ収束。float 直列化差による dedup 外れは観測されなかった。
  - **4e-2b 発見経路 PASS**: 空の device B が A の新規ファイルを op-log のみから発見・
    materialize し Sidebar に表示 (`discovered 1 remote file(s), 7 batch(es)`)。B は snapshot を
    一度も持たない新規データディレクトリなので、基準 3 の「legacy snapshot なし」条件を
    構成的に満たす。
  - **欠陥発見→修正**: 受信が着地し `reprojectAfterReceive` が swap を返しても、開いている
    画面が変わらなかった。原因は GraphEditor が React Flow の内部 state を file.id /
    activeSheetId の変化でしかリセットしないこと (§3.3 の設計は activeFile 差し替えまでで、
    React Flow への再 seed 配線が抜けていた)。対策として受信 swap ごとに増える
    `receiveEpoch` を導入し reset effect の依存に加えた (commit 11a41f8)。修正後、
    開いたままの画面への受信反映を実機で確認。
  - **検査スクリプトの更新**: `inspect-remote-batches.ts` の検査 1 を旧 C1 (genesis 非 push)
    から「genesis push・id 収束」へ反転 (a827f90)。genesis が batch 列であることを
    実機の誤 FAIL で発見し、(fileId, clock) スロット単位の判定へ修正 (655e65e)。
  - **§7 の未解決点への回答**: 異 snapshot 分岐の実害は本 e2e では観測対象外 (単一
    ファイルを両端末で共有)。genesis id の実機一致は上記のとおり確認済み。
