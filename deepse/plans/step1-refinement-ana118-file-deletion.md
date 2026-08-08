# step1 refinement ANA-118 / ANA-127 / ANA-126: ファイル削除の伝播設計

> 対象: Linear ANA-118「GraphFile 削除時にエラーが起きる」(GitHub #186)、
> ANA-127「[確認] File 削除は PDS 経由で伝播しない?」(GitHub #195)、
> ANA-126「[確認] File の「保存」ボタンは何のためにある?」(GitHub #193)。
>
> 位置づけ: ANA-118 と ANA-127 は**同じ 1 個の穴の表と裏**である。ANA-126 は別件だが、
> 「保存」「削除」という語が何に効くのかが UI から読めないという点で同じ場所を指しており、
> 変更が小さいので同じ PR に含める (2026-08-08 ユーザー決定)。
>
> 本書は ANA-107 と同じく、**個別の症状を潰す前に構造を特定してから直す単位を決める**
> ためのものである。

---

## 1. 結論

| issue | 症状 | 原因 |
|---|---|---|
| ANA-127 | ローカルで削除したファイルが PDS から復活する | **原因 A** |
| ANA-118 | 削除時に `ATProto session not initialized` が出る | **原因 A** (同じ 1 行) |
| ANA-126 | 「保存」ボタンが何のためにあるか分からない | 別件 — UI 語彙 |

**原因 A: ファイル削除だけが op-log の外にある。**

`OpSchema` には `sheet.remove` があるのに `file.remove` が無い (`unified.ts:174`)。
`GraphEvent` にも `FILE_DELETED` が無い。ノード・エッジ・シート・名前・概要のすべてが
op-log に載る中で、**ファイル削除だけが正典に載らない破壊的操作**になっている。
その結果、削除は「ローカル DB の行を消す」だけの操作に留まり、正典にも他端末にも
伝わらない。

ANA-107 の原因 A (「グループ解除が一級の操作として存在しない」) とまったく同じ形である。

したがって修正は 3 件ではなく、**3 つのスライス** (§5) に分ける。

---

## 2. 診断

### 2.1 削除が PDS に伝わらない経路 (ANA-127)

`handleDeleteFile` (`useFileSheetOperations.ts:330`) がやっているのは 2 つだけである。

```
1. deps.removeFile(id)         → DELETE /files/:id
                                 → EventStore.deleteFile: batches / commits /
                                   branches / file_migrations を 1 tx で物理削除
2. deps.atprotoFilesDelete(id) → files.delete(id)
                                 → deleteRecord(NSID.file, fileId)
```

2 が触っているのは **legacy の `files` コレクション**である。`collections.ts` の冒頭
コメント自身がそう書いている (「`files`: legacy file レコードの後始末 (ファイル削除時の
`delete` のみ)」)。

**Phase 4c 以降の唯一の同期単位である `batches` コレクションには一切触っていない。**

したがって PDS には削除したファイルの op-log がまるごと残る。そして起動時と `online`
イベントで `discover()` が走る (`useFileSheetOperations.ts:531`):

```
listRemoteFileIds()  → PDS の batches rkey から fileId を列挙 (Phase 7 p7-3)
                       削除したファイルもここに現れる
listLocalFileIds()   → GET /files = listOplogFiles = batches テーブルの GROUP BY
                       1 で物理削除したので、このファイルは現れない
→ 差集合 = 「未知ファイル」に分類される
→ pullRemoteForFile → appendReceived で materialize
```

**次回起動で削除が取り消される。** ANA-127 の推測は正しい。

条件つきであることに注意する。ATProto にログインしていなければ `remoteQueue` が null で
`discover` 自体が走らない (`useFileSheetOperations.ts:531` の effect は `remoteQueue`
に依存する)。**ログイン中に削除したファイルだけが復活する。**

### 2.2 エラーの正体 (ANA-118)

ANA-118 のスタックトレースは §2.1 の 2 番そのものである。

```
Error: ATProto session not initialized. Call login() first.
currentDid — client.ts:92        ← session が無いので throw
deleteRecord — collections.ts:135
（anonymous関数） — useFileSheetOperations.ts:345   ← deps.atprotoFilesDelete(id)
```

`handleDeleteFile` はこの呼び出しを try/catch して `console.warn` している
(`useFileSheetOperations.ts:346`)。だから issue にある通り「表面上は支障がない」。

ここで重要なのは、**このエラーを黙らせるだけの修正は ANA-127 を隠すことになる**という点
である。エラーはノイズであると同時に「削除が PDS に伝わっていない」ことの兆候そのもの
だからだ。そして呼び出し自体が正典に対して無意味である — 消すべきは catch ではなく
呼び出しの方である。

### 2.3 「保存」ボタン (ANA-126)

`SettingsPopup.tsx:197` の「保存」は、名前と概要の編集ポップアップのボタンである。
PDS 同期とは無関係で、`onSave` → `handleSaveFileSettings` → `FILE_RENAMED` /
`FILE_DESCRIBED` を op-log へ流すだけである。

現仕様は以下の通りで、**保存する経路が 3 つ、破棄する経路が 1 つ**ある。

| 操作 | 結果 |
|---|---|
| 「保存」ボタン | 保存して閉じる (`handleSave`, :69) |
| 名前欄で Enter | 保存して閉じる (:114) |
| ポップアップの外をクリック | **保存して**閉じる (:51) |
| Escape | 破棄して閉じる (:59) |

つまりボタンは「保存する唯一の手段」ではなく、**明示的な確定の口**でしかない。
「何のためにあるか分からない」のはこのためである。

---

## 3. 前提の確認

設計を組む前に、成立を確かめた事実を挙げる (いずれもコードで確認済)。

1. **`listBatchFileIds` は各ファイルの最大 rkey に着地する** (`rangeFetch.ts:111`)。
   rkey は `v1~<fileId>~<clock12>~<batchId>` (`batchRkey.ts`) で、降順走査は
   ファイルごとに 1 リクエスト・1 レコードだけ読む。着地するのは**そのファイルの
   最大 clock の batch** である。
   → **tombstone を最後の操作として置けば、列挙のコストを 1 リクエストも増やさずに
   削除を検出できる。** これが本設計が成立する土台である。

2. **`listOplogFiles` には既に「隠す」判定がある** (`eventStore.ts:242`)。
   `projectFile` の結果が 0 シートなら一覧から除く。tombstone の除外はこの隣に置ける。

3. **`foldFileStructure` は remove-wins である** (`project.ts:267`)。
   `sheet.remove` は live 集合から外し、削除済みシートの content は projection 時に
   無視される (:330)。`file.remove` を同じ規則で足せる。

4. **`deepse/architecture/` に削除の伝播についての記述は無い。** step0.md には
   `DELETE /files/:id` が API 表にあるだけである。したがってこれは新しい設計判断であり、
   既存設計との衝突は無い。

5. **`files` コレクションの消費者は `atprotoFilesDelete` 1 箇所だけである。**
   これを外すと `collections.ts` の `files` export ごと死ぬ。

---

## 4. 設計方針

### D1: ファイル削除を op-log の一級の操作にする 〔2026-08-08 ユーザー決定〕

`file.remove` op と `FILE_DELETED` イベントを足し、削除を tombstone として batch に
載せる。他の破壊的操作 (`sheet.remove`, `node.remove`) とまったく同じ扱いにする。

**PDS 上の batch 本体は消さない。** 削除は「見えなくする」ことであり、履歴は残る。
容量回収 (GC) は非目標とする (§7)。

削除の伝播は 2 層で成立する。

**層 1 — この端末 (ANA-127 を直す本体)**

削除がローカル op-log に tombstone として残る。したがって:

- `listOplogFiles` は tombstone を持つファイルを一覧から外す → 画面から消える
- **しかし `batches` テーブルには行が残る** → `listLocalFileIds` には現れる
  → discovery が「未知ファイル」と判定しない → **materialize されない**

つまり `listLocalFileIds` が「一覧に出るファイル」ではなく「**この端末が知っている
fileId**」を返すようになれば、それだけで復活が止まる。ここが設計の要である。

**層 2 — 他端末 (伝播)**

tombstone batch が PDS へ push される。他端末の `listRemoteFileIds` は §3-1 により
**その tombstone レコードに着地する**ので、本体を引かずに削除を知れる。

さらに念のため、未知ファイルを pull した後にも tombstone を検査してから materialize
する。pull 済みの batch を見るだけなので**追加コストはゼロ**であり、着地点の検査が
効かなかった場合 (下記) の受け皿になる。

**並行編集との競合**: tombstone より大きい clock の batch が後から来ると、着地点は
tombstone ではなくなる。このとき着地点の検査 (層 2 の前半) はすり抜けるが、pull 後の
検査が拾う。規則は **remove-wins (削除は sticky)** とする — op-log のどこかに
`file.remove` があればそのファイルは削除済みとして扱う。`sheet.remove` が
add-wins (`sheet.create` で復活する) なのと非対称だが、ファイルには「再作成」に相当する
op が無いので add-wins にする意味が無い。

### D2: 削除の書込経路は既存の tap に載せる

`FILE_RENAMED` / `FILE_DESCRIBED` と同じく `syncRecord` (tap.record) で op-log へ流す。
undo は通さない (§7)。これにより remote への push は既存の `remoteSyncQueue` が
そのまま担い、**新しい同期経路を作らない**。

`DELETE /files/:id` (物理削除) は残す。ただし用途を変える:

- 通常の削除 = tombstone (D1)
- `DELETE /files/:id` = **op-log ごと物理的に消す**開発・後始末用の口

サーバの endpoint と `EventStore.deleteFile` はそのままで、**クライアントが通常の削除で
呼ぶのをやめる**。これが最も変更が小さく、かつ「本当に消す」手段を残せる。

### D3: legacy `files` コレクションへの delete 呼び出しを撤去する 〔ANA-118〕

`atprotoFilesDelete` の dep、`defaultFileSheetOpsDeps` の実装、`collections.ts` の
`files` export をまとめて落とす。§3-5 の通り他に消費者はいない。

これで ANA-118 のエラーは**呼び出しごと消える**。catch を足して黙らせるのではない。

### D4: 「保存」ボタンは残し、外クリックの意味論を変える 〔ANA-126〕

§2.3 の通り、混乱の原因はボタンの存在ではなく**保存経路が 3 つある**ことである。
特に「ポップアップの外をクリックすると保存される」は、破棄のつもりでクリックした
ユーザーの操作を保存に変えてしまう。

- ボタンは残す — 明示的な確定の口として必要で、消すとポップアップが未完成に見える
- **外クリックを「破棄して閉じる」に変える** — Escape と揃える
- 名前欄の Enter は保存のまま (入力欄での Enter = 確定は一般的な慣習)

これにより「保存 = ボタンか Enter」「破棄 = 外クリックか Escape」と 2 対 2 に整理される。

> 注: これは振る舞いの変更なので、`SettingsPopup.test.tsx` の既存テスト
> (「クリック外で保存」を固定しているもの) を書き換える必要がある。

---

## 5. 実装スライス

各スライスは独立に commit でき、それぞれの時点で lint / typecheck / test が通ること。

| # | 内容 | 解消する issue | 備考 |
|---|---|---|---|
| **S1** | `file.remove` op + `FILE_DELETED` イベント + projection の tombstone 対応 (`projectFile` / `foldFileStructure` / `listOplogFiles`) | — | 振る舞いを変えない土台。UI からはまだ呼ばない |
| **S2** | `handleDeleteFile` を tombstone 経路に切り替え、`listLocalFileIds` を「知っている fileId」に変更、D3 の legacy 撤去 | ANA-127, ANA-118 | S1 に依存。ここで ANA-127 が直る |
| **S3** | discovery の tombstone 検査 (着地点 + pull 後の 2 段) | ANA-127 (他端末への伝播) | S1 に依存。S2 と独立 |
| **S4** | `SettingsPopup` の外クリックを破棄に変更 | ANA-126 | 他スライスから完全に独立。先に入れてもよい |

S1 → S2 / S3 の順に依存する。S4 はいつでもよい。

## 6. 受入基準

### 共通

- `bun test` / lint / typecheck が通る
- 変更した各モジュールに `.test.ts` と `.test.md` が揃っている (プロジェクト規約)
- `deepse/requirements/operation-manual-for-dev.md` の削除の記述を更新する

### S1

- `file.remove` を含む op-log を `projectFile` に通すと削除済みと判定される単体テスト
- `file.remove` の後に別の op が来ても削除済みのままである (remove-wins) テスト
- `listOplogFiles` が tombstone を持つファイルを返さないテスト

### S2 (ANA-127, ANA-118)

- ファイルを削除すると一覧から消え、**`batches` テーブルには行が残る**テスト
- `listLocalFileIds` が削除済み fileId を含むテスト (= discovery が未知と誤判定しない)
- `atprotoFilesDelete` / `files` export への参照がリポジトリから消えていること
- **実機**: ATProto ログイン中にファイルを削除 → リロード → 復活しないこと
  (op-log projection で tombstone を確認する。[[project_ui_verification_method]] の手順)
- **実機**: 削除時にコンソールへエラーが出ないこと

### S3

- 着地レコードが tombstone のとき `pullRemoteForFile` を呼ばないテスト (リクエスト数を数える)
- pull した op-log に `file.remove` が含まれるとき materialize しないテスト
- tombstone より大きい clock の batch が後続しても materialize しないテスト (remove-wins)

### S4 (ANA-126)

- 外クリックで `onSave` が呼ばれず `onClose` だけが呼ばれるテスト
- ボタンと Enter では従来通り `onSave` が呼ばれるテスト

## 7. 非目標

- **PDS 上の batch 本体の削除 (GC)**。tombstone だけを足し、容量は回収しない。
  「本当に消したい」場合の手段は `DELETE /files/:id` (D2) として残る。
- **ファイル削除の undo**。ノード削除と違い undo スタックには載せない。
  tombstone は op-log に残るので、後から復活の口を足すことは妨げられない。
- **シート削除の semantics 変更**。`sheet.remove` は add-wins のままにする (D1 の末尾)。
- **legacy `files` コレクションの PDS 上のレコード掃除**。放置する既存決定
  (`collections.ts` 冒頭) を踏襲する。
- **ログインしていない端末での削除の伝播**。ローカルにしか残らないのは仕様とする。

## 8. 未決事項

- 削除済みファイルをユーザーに見せる口 (ゴミ箱) を作るか。本 PR では作らない。
  tombstone があるので後から足せる。

## 9. 決定記録

| 日付 | 決定 | 論拠 |
|---|---|---|
| 2026-08-08 | ファイル削除を op-log の `file.remove` として伝播させる (D1)。PDS の batch 実削除は採らない | ユーザー決定。実削除は「他端末がまだローカルに持っていると次の push で復活しうる」「削除したこと自体が他端末に伝わらない」の 2 点で伝播にならない。ANA-107 で Ungroup を一級化したのと同型 |
| 2026-08-08 | ANA-126 を同じ PR に含める (D4) | ユーザー決定。別件だが変更が小さい |
