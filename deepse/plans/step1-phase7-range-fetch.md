# step1 Phase 7: 範囲取得 (R3) — 設計 (初版ドラフト)

> ステータス: **ドラフト (レビュー前)** / 作成日: 2026-07-30 / 対象 main = `d0b37ce`
> 位置づけ: [step1 実装計画](./step1-implementation.md) §2 Phase 7 (範囲取得・R3) の設計。
> 前提: Phase 6 (W3e snapshot 完全退役, PR #169) が merge 済で、op-log が唯一のモデルになっている。
>
> R3 = 「remote の全件 list をやめる rkey/コレクション設計」([step1 アーキテクチャ](../architecture/step1.md) §リスク表)。
> リリース gating の残タスクは本 Phase と Phase 8 (Tauri 配布・R1・VPS 役割変更) のみ。

---

## 1. 背景と現状把握

### 1.1 なぜ Phase 7 か

remote (ATProto) からの受信が **毎回 repo 全体の batch レコードを取得する**契約になっている。
「開いているファイル 1 つの差分を受信する」ためにも repo 全体を落とし、他ファイル分を
JS で捨てている。ファイル数と履歴が増えるほど、起動と復帰 (`online`) が線形に重くなる。

Phase 4d-4 はこれを**意図的に**選んだ (§1.4)。当時は既読位置に使える値が ATProto 側に
無かったためで、その但し書きが `atprotoSyncProvider.ts:104` に残っている:

> rkey を時系列ソート可能なキーへ変える案は Jetstream 化と同じ Phase で扱う。

本 Phase がその回収である。ただし後述のとおり、**採るべきキーは「時系列ソート可能」ではなく
「ファイル単位に prefix 分割された決定論的キー」**だった (§3.1)。

### 1.2 全件 list の実態 【コード裏取り済】

| 場所 | 現状 |
|---|---|
| `src/client/src/atproto/collections.ts:50` `listRecords` | `limit: 100` で cursor を最後まで回し、`app.conversensus.graph.batch` を **repo 全件**返す |
| `src/client/src/atproto/atprotoSyncProvider.ts:109` `pullRemote` | 全件を `RemoteBatch[]` に写し、`(clock, actor, id)` で JS ソート。**既読位置を持たない** |
| `src/client/src/atproto/remoteSyncQueue.ts:134` | `pullRemote` の素通し (`since` を取らないのは意図的, 同 41 行) |
| `src/client/src/sync/receiveRemoteBatches.ts:56` | 全件取得 → **1 ファイル分だけ残す**。捨てた数を `skippedOtherFile` で返す |
| `src/client/src/sync/discoverRemoteFiles.ts:55` | 全件取得 → fileId ごとに束ね、**ローカル既知のファイルは捨てる** (`skippedKnown`) |

起動契機は「起動時 + `online` + 手動」に限られる (subscribe は §3.4 of Phase 4d で不採用)。
つまり頻度は低いが、**1 回のコストが repo 全履歴に比例する**。

戻り値の 2 つのカウンタ (`skippedOtherFile` / `skippedKnown`) が、そのまま
「無駄に落とした量」の指標になっている点は本 Phase の実測で使える (§5)。

### 1.3 🔴 外部 API の実際 — `rkeyStart` / `rkeyEnd` は使えない

R3 の文言「rkey 範囲取得」は、`com.atproto.repo.listRecords` の `rkeyStart`/`rkeyEnd` を
想定していた。**この 2 つは現行 lexicon から削除されており、公式クライアント経由では渡せない**。

`@atproto/api@0.19.6` の `com/atproto/repo/listRecords.d.ts`:

```ts
export type QueryParams = {
  repo: string;
  collection: string;
  limit?: number;
  cursor?: string;
  reverse?: boolean;   // Flag to reverse the order of the returned records.
};
```

PDS 側 (self-host する公式実装, `infra/pds` の docker image) の挙動は以下:

- `listRecordsForCollection` は `orderBy('record.rkey', reverse ? 'asc' : 'desc')`。
  **既定は rkey 降順**、`reverse: true` で昇順。
- `cursor` があればそれが優先され、`reverse: true` → `where(rkey, '>', cursor)` /
  `reverse: false` → `where(rkey, '<', cursor)`。`rkeyStart`/`rkeyEnd` は cursor 不在時の
  deprecated fallback として内部にのみ残る。
- ハンドラが返す `cursor` は **最後のレコードの rkey そのもの** (AT-URI ではない)。
- **入力 cursor に検証は無い** — 単なる文字列として rkey と比較される。

→ 帰結: **前回応答由来でない「合成した cursor」を渡して任意の rkey 位置へ seek できる**。
これが本設計の土台である。範囲取得は「rkey を構造化し、cursor で seek し、範囲を出たら
止める」形で実現する。

> 教訓の適用 ([[feedback_design_vs_existing_spec]]): 設計の対策を書く前に外部 API の型に
> 突き合わせた結果、R3 の当初の言葉 (`rkeyStart`/`rkeyEnd`) が**使えない**ことが判明した。
> 実装中に気付いていたら、スライスを 1 本無駄にしていた。

### 1.4 現行 rkey = batchId (ランダム UUID) が範囲取得を不可能にしている

`atprotoSyncProvider.ts:87-108` が既読位置を捨てた根拠は 3 点あり、いずれも今も有効:

1. `clock` は端末をまたぐと単調でない → clock cursor は取りこぼす。
2. `listRecords` の cursor は **rkey 位置**。rkey = batchId (ランダム UUID) なので順序が
   時系列にならず、後から書いた batch の UUID が保存済み cursor より小さいと永久に落ちる。
3. `indexedAt` は repo の `listRecords` 出力に無く、`rev` はレコード単位で露出しない。

本 Phase が変えるのは **2 番の前提** (rkey の構造) だけである。1 と 3 は変えられないので、
**「既読位置を永続化しない」契約は維持する** (§2.2)。範囲を絞るのは
「repo 全体 → 1 ファイル」の軸であって、「全履歴 → 差分」の軸ではない。

---

## 2. スコープと非目標

### 2.1 目標

1. **開いているファイルの受信が O(そのファイルの履歴)** になる (repo 全体に比例しない)。
   `receiveRemoteBatches` の `skippedOtherFile` が構造的に 0 になる。
2. **未知ファイルの発見が O(ファイル数) の小リクエスト**になる。
   `discoverRemoteFiles` が既知ファイルの batch を落とさなくなる (`skippedKnown` が 0)。
3. `pullRemote()` (repo 全件) の消費者が 0 になり、`collections.batches.list()` ごと撤去される。
4. 上記が**実測**で確認される (リクエスト数・転送量の before/after, §5)。

### 2.2 非目標

- **Jetstream / firehose 購読**、`subscribe` の実装 — Phase 8 (§step1-implementation §2)。
  本 Phase は「起動時 + `online` + 手動」の契機を変えない。
- **既読位置 (cursor) の永続化** — §1.4 の理由で今も不可能。取りこぼしゼロを構造で保証する
  現在の契約を維持する。「書くが読まない」型の二重モデルを作らない (Phase 6 §6.1 の判断と同じ)。
- **ファイル履歴そのものの圧縮 (checkpoint / 圧縮 snapshot)** — 1 ファイルの履歴が単調増加する
  問題は本 Phase では解かない。残課題として §6.4 に明記する。
- **PDS 上の legacy レコードの物理削除** — Phase 6 と同じ「放置」判断 (`collections.ts:4-8`)。
  旧 rkey の batch レコードも放置する (§3.4)。
- **旧版クライアントとの併用** — 移行後の repo に旧版 (旧 rkey で書く) が混ざる運用は
  サポートしない。理由と限界は §3.4 / §6.2。
- `cidCache` 永続化 — Phase 7 の課題として計画に載っていたが、**すでに解消済**。
  op-log では batch が不変で CID 差分検出が不要になり、`cidCache.ts` は Phase 6 p6-4/p6-5b で
  削除された。R3 に残っていたのは範囲取得のみ。

---

## 3. 設計判断

### 3.1 【最大の判断】rkey スキームを `v1~<fileId>~<clock12>~<batchId>` にする

```
rkey = `v1~${fileId}~${String(clock).padStart(12, '0')}~${batchId}`
例:    v1~3f2a…-…-…c1~000000000042~9b7e…-…-…d0
```

満たすべき要件と満たし方:

| 要件 | 満たし方 |
|---|---|
| ファイル単位に prefix でまとまる | `v1~` の直後が `fileId` (UUID 固定長 36) |
| **旧 rkey と rkey 空間で分離される** | 先頭 `v1~` の `v` が、旧 rkey (小文字 hex UUID = 先頭は `0-9a-f`) のどの先頭文字よりも ASCII で大きい。§3.3 の走査が旧レコードを 1 件も踏まない (この判断の理由は下記) |
| **決定論的** (同じ batch → 同じ rkey) | `fileId`/`clock`/`batchId` はいずれも batch の不変な属性 |
| `batch.id` が復元できる | 第 4 セグメント。body に入れないので **lexicon 変更不要** (`batch.json` は `"key": "any"`) |
| rkey として合法 | 許容文字は英数と `. - _ : ~`。UUID のハイフンと区切りの `~` はいずれも合法。長さ 3+36+1+12+1+36 = **89** ≤ 512 |
| ファイル内でおおむね書込順 | `clock` を 12 桁ゼロ詰めで辞書順 = 数値順にする |
| 将来 rkey 形式を変えられる | 先頭が形式バージョン。`v2~` は `v1~` より大きいので、同じ分離の論法が次の変更でも使える |

**`v1~` を付ける理由 (当初案から改めた点)**: 旧 rkey (UUID 単体) のレコードを PDS に
残す判断 (§3.4) と、§3.3 の「降順に 1 ファイル 1 リクエストで列挙する」走査は、
prefix 無しでは**両立しない** — 旧レコードは rkey 空間に散在するので、走査が
それらを 1 件ずつ踏み、リクエスト数が旧レコード数に比例してしまう
(= 全件 list を別の形でやり直すことになる)。`v1~` を付けると
**旧レコードはすべて `v1~…` より小さい**ので、新旧が rkey 空間で完全に分離し、
新経路の走査は旧レコードに一切触れない。旧レコードを削除する必要も消える。

> **前提**: 旧 rkey は `crypto.randomUUID()` 由来の**小文字 hex** UUID である
> (先頭は `0-9a-f`)。大文字混在なら `A-F` (0x41-0x46) でこれも `v` より小さいので順序は
> 変わらないが、**実 PDS のレコードで確認する** (p7-0 の観測項目, §4)。

**決定論性が要件に入っている理由**: 現行の `pushRemote` は `rkey = batchId` なので、同じ batch を
再送しても同じレコードを上書きする = **PDS レベルでべき等**。この性質は outbox の再送と
移行の再 push (§3.4) が依存している。rkey に書込時刻を混ぜると再送のたびに別レコードが増える。

**なぜ TID ではないのか**: ATProto 標準の TID (時刻ベースの並べ替え可能キー) は
(a) 生成時刻依存で非決定論的 → 上記のべき等性を失う、(b) 端末間のクロックずれで順序が壊れる →
§1.4-2 と同型のバグを再生産する。**ファイル内の順序は rkey に頼らない** — 受信側は
`(clock, actor, id)` で正規化ソートしており (`atprotoSyncProvider.ts:126-132`)、
その規則はローカル正典の `orderBatches` と同一なので、rkey 順が不完全でも結果は変わらない。
rkey に `clock` を入れるのは「デバッグ時に PDS を眺めて読める」ことと、
将来 checkpoint (§6.4) を入れるときの下地としての価値にとどまる。

`batch.id` の復元は `parseBatchRkey(rkey)` に閉じる。`v1~` で始まり 4 セグメントに割れない
rkey は **壊れたレコードと同じ扱い** (数えて warn、取り込まない, §3.6)。旧 rkey (UUID 単体) の
レコードもここで弾かれるが、そもそも `v1~` 分離により走査の範囲外なので読まれない。

### 3.2 ファイル単位の範囲取得 = prefix への cursor seek

```
listByFile(fileId):
  prefix = `v1~${fileId}~`
  cursor = `v1~${fileId}`             // ← 合成 cursor。prefix より小さく、直前の rkey より大きい
  loop:
    res = listRecords({ collection, limit: 100, reverse: true, cursor })
    for r of res.records:
      if (rkey が prefix で始まらない) → return   // 範囲を出た = このファイルは終わり
      collect(r)
    if (!res.cursor) return
    cursor = res.cursor
```

境界が成立する根拠:

- `reverse: true` は rkey 昇順 + `rkey > cursor` (§1.3)。`v1~F` < `v1~F~…` (同 prefix で
  長い方が大きい) なので、**そのファイルの最初のレコードから始まる**。
- fileId は UUID 固定長 36 なので、ある fileId が別の fileId の prefix になることはない。
  よって `v1~F~…` 群は rkey 空間で**連続**し、他ファイルのレコードが間に挟まらない。
- 旧 rkey のレコードはすべて `v1~…` より小さい (§3.1) ので、この昇順走査には現れない。
- 走査の停止は「prefix が変わった 1 件を見た時点」。この 1 件の読み過ぎは正常動作で、
  異常として数えない (§3.6)。

**取りこぼしゼロは構造で保証されたまま**である — cursor を保存せず、毎回そのファイルの
先頭から読む。二重取り込みは受信側の `(file_id, batch_id)` べき等性が無害化する
(`EventStore.appendReceivedBatches`)。変わるのは「毎回 repo 全部」→「毎回そのファイル全部」。

### 3.3 ファイル列挙 (distinct fileId) も cursor seek で行う

`discoverRemoteFiles` が必要とするのは、まず **remote に存在する fileId の集合**である
(batch 本体は未知ファイルの分だけあればよい)。prefix rkey なら降順 seek で
**1 ファイル 1 リクエスト**で列挙できる:

```
listFileIds():
  cursor = undefined
  loop:
    res = listRecords({ collection, limit: 1, reverse: false, cursor })  // 降順
    if (res.records.length === 0) return ids
    if (rkey が `v1~` で始まらない) return ids   // 旧 rkey 領域へ落ちた = 新形式は尽きた
    fileId = parseBatchRkey(rkey).fileId
    ids.push(fileId)
    cursor = `v1~${fileId}`  // ← 合成 cursor。このファイルの全レコードを一気に飛ばす
```

降順 + `rkey < cursor` なので、`cursor = v1~F` はそのファイルの全レコード
(`v1~F~…` はすべて `v1~F` より大きい) を一気に飛ばし、次に小さい fileId の
最終レコードに着地する。**リクエスト数 = ファイル数 + 1**、各 1 レコード。
最後の 1 回は「旧 rkey 領域の最大レコード 1 件」または空応答で、そこで止まる
(旧レコードは `v1~` より小さいので、**1 件見るだけで走査が終わる** — §3.1 の分離が
効いているのはここ)。

**代替案 (不採用): ファイル索引コレクションを新設する。**
`app.conversensus.graph.fileIndex` (rkey = fileId) を genesis 時に書き、列挙はその
コレクションの list 1 発にする案。リクエスト数は 1 で最良だが、
(a) **書込経路が増え**、batch op-log と索引の整合を取る責務が生まれる (索引だけ書けた/
書けなかった状態が生まれる = 小さな二重モデル)、(b) 既存 repo には索引が無いので
結局 batch 側からの復元経路が必要になる。**ファイル数は個人利用で 1〜数十のオーダー**であり、
N+1 の小リクエストで足りる。よって索引は作らない。
ただし p7-0 で cursor seek が否定された場合の **fallback 案として温存**する (§4, §6.1)。

### 3.4 移行: ローカル正典を新 rkey で一括再 push し、旧レコードは放置する

旧 rkey (UUID 単体) のレコードは `v1~` 分離により新経路の走査の外にある (§3.1)。
放置すれば「読まれないゴミ」になるだけで**削除も不要**だが、**そのレコードにしか存在しない
batch がある**場合 (別端末が push し、この端末はまだ受信していない分) は情報を失う。
よって順序が重要:

1. **旧経路で 1 回だけ全件受信する** — 現行の `pullRemote()` + `discoverRemoteFiles` +
   `receiveRemoteBatches` をそのまま 1 回走らせ、PDS にしか無い batch をローカル正典へ取り込む。
2. **ローカル正典を新 rkey で再 push する** — 各ファイルの全 batch を
   `filterBatchesForRemote` を通してから `pushRemote`。rkey が決定論的なので何度実行しても
   同じレコードに収束する (べき等)。
3. **移行済 marker を記録する** — 以後は 1 の全件 list を実行しない。
4. 以後は prefix 読取のみ。旧 rkey のレコードは PDS に残るが読まれない
   (Phase 6 の legacy レコード放置と同じ判断)。

**marker の置き場所は端末ローカル** (`localStorage`, DID 単位のキー)。
「この repo の batch コレクションは新 rkey 形式で揃っている」は本来 repo 単位の不変条件だが、
PDS 上に marker レコードを置いても**旧版クライアントが後から旧 rkey を書く**可能性は消えない
(marker があっても嘘になる)。したがって marker は「この端末は 1 回目の全件受信を済ませた」
という端末の事実だけを表し、**全端末を更新することを運用前提とする** (旧版併用は非目標, §2.2)。
試験リリース・個人利用段階 (§0 of 実装計画) で受容できる割り切りであり、
リリースノートに明記する。

**再 push の量**は「ローカル正典の全 batch (presentation 除外後)」。`putRecord` を 1 件ずつ
直列に投げると件数分の往復になるため、`com.atproto.repo.applyWrites` (1 リクエストに複数 write)
でまとめる選択肢を p7-4 で評価する。所要時間とレート制限の実測を受入基準に入れる (§5)。
Phase 6 p6-0 の「起動時一括移行 + 実測してから受入基準を決める」と同じ運びにする。

### 3.5 API 境界の変更

| 層 | 現在 | Phase 7 後 |
|---|---|---|
| `collections.batches` | `list(): 全件` | `listByFile(fileId)` / `listFileIds()` |
| `BatchCollection` (DI 境界) | `put` / `list` | `put` / `listByFile` / `listFileIds` |
| `AtprotoSyncProvider` | `pullRemote(): 全件` | `pullRemoteForFile(fileId)` / `listRemoteFileIds()` |
| `RemoteBatchTarget` / `RemoteSyncQueue` | `pullRemote` 素通し | 同上を素通し |
| `receiveRemoteBatches` deps | `pullRemote()` | `pullRemoteForFile(fileId)` (fileId フィルタは不要になるが、**防御として残す** — 孤児 batch 防止の不変条件 D-4 は rkey の正しさに依存させない) |
| `discoverRemoteFiles` deps | `pullRemote()` | `listRemoteFileIds()` + `pullRemoteForFile(fileId)` |
| `subscribe` | 全件 poll ベース | **消費者 0 のまま。撤去する** (Phase 8 で Jetstream として作り直す) |

`pullRemote()` (全件) は p7-4 の移行経路が最後の消費者になり、p7-5 で移行コードごと
1 回限りの位置に閉じ込める。`collections.batches.list()` はそこでのみ生き残るか、
移行を `listFileIds` ベースに書ける場合は完全に消える (p7-5 で判断)。

### 3.6 無言の失敗を作らない

W3d5-7 (PDS が float を拒否して全 push が 400、しかしコンソールは無言) の教訓を継ぐ:

- **`v1~` で始まるのに割れない rkey**: 数えて `console.warn`。`isBatchRecordValue` で弾いた
  件数と同じ扱いにする (`pullRemote` の `skipped` を踏襲)。
- **prefix 走査の停止で読んだ 1 件**: 正常。数えない (異常カウンタを汚さない)。
- **移行 (p7-4)**: 受信件数・再 push 件数・失敗件数を warn/info に出す。失敗したら marker を
  立てない (次回起動で再試行される)。
- **列挙の異常**: `listFileIds` のリクエスト数に上限を設け、超えたら warn して打ち切る。
  §3.1 の分離が効いていればリクエスト数はファイル数 +1 に収まるので、**上限超過は
  「rkey 順序の前提が崩れた」ことの検知器**になる (静かに何百回も回らせない)。

---

## 4. 実装スライス分割

| スライス | 内容 | 不可逆性 |
|---|---|---|
| **p7-0** | **実機 spike**: docker PDS で cursor 意味論を確定する。①合成 cursor が受理される ②`reverse: true` が rkey 昇順 + `rkey > cursor` ③`reverse: false` + `cursor = v1~<fileId>` がそのファイルを飛ばす ④`limit` 上限 ⑤既存レコードの rkey が小文字 hex UUID である (§3.1 の前提)。**否定されたら §3.3 の索引コレクション案へ切替**を判断する | なし (捨てるコード) — **✅ 完了 (2026-07-30): 全 12 項目 PASS, §5.1**  |
| **p7-1** | rkey 純関数 (`batchRkey` / `parseBatchRkey`) + テスト。`pushRemote` を新 rkey へ切替。**読取は全件のまま**で両形式を許容 (非破壊) | なし — **✅ 完了 (2026-07-30)** |
| **p7-2** | `listByFile` / `pullRemoteForFile` を追加し `receiveRemoteBatches` を載せ替え。**catch-up も同じ経路に載せた** (§5.2) | なし (旧経路は残存) — **✅ 完了 (2026-07-30)** |
| **p7-3** | `listFileIds` / `listRemoteFileIds` を追加し `discoverRemoteFiles` を「列挙 → 未知ファイルだけ prefix 取得」へ | なし — **✅ 完了 (2026-07-30)** |
| **p7-4** | 移行 (§3.4): 1 回だけ全件受信 → 新 rkey で再 push → marker。実測 (件数・所要時間)。**再 push は `applyWrites` のまとめ書き + 差分計算に変えた** (§5.4) | **あり** (PDS へ書く) — **✅ 完了 (2026-07-31)** |
| **p7-5** | 全件 list の撤去: `pullRemote()` / `collections.batches.list()` / `subscribe` を退役 | **あり** (削除) |
| **p7-6** | **実機 e2e + 実測**: 2 端末での伝播、リクエスト数・転送量の before/after、PDS 直接検査 | 検証のみ — **✅ 完了 (2026-07-31): 全基準 PASS, §5.5** |

**順序の根拠** (Phase 6 §6.1 の教訓「e2e を不可逆化の前に」):
p7-1〜p7-3 はすべて非破壊で、旧経路 (全件 list) が生きたまま新経路に切り替わる。
不可逆な削除 (p7-5) の前に p7-4 の移行と実機確認を通す。**p7-6 の e2e を p7-5 の前に
実施する**運びにし、「新経路だけで全機能が動く」ことを確認してから旧経路を落とす。
安全弁フラグは**設けない** — Phase 6 で「倒す先が無い安全弁」「書くが読まない二重モデル」が
実害を出した経験に従い、非破壊スライスの順序で安全性を担保する。

---

## 5. 受入基準

1. **p7-0 の実測ログ** — §4 の 4 項目それぞれについて、実 PDS のリクエストと応答を記録する。
   推測で先へ進まない (この設計の §1.3 はリファレンス実装の**ソース**による裏取りであり、
   稼働中の image による裏取りではない)。
2. **単体テスト** (in-memory collection で決定論的に):
   - `batchRkey` / `parseBatchRkey` の往復。3 セグメントに割れない rkey が弾かれること。
   - `listByFile` が prefix 境界で止まること。隣接 fileId のレコードを含めないこと。
   - `listByFile` / `listFileIds` が**旧 rkey のレコードを 1 件も走査しない**こと
     (旧レコードを混ぜた in-memory collection で、リクエスト数と結果の両方を固定する)。
   - `listFileIds` が全 fileId をちょうど 1 回ずつ返すこと (リクエスト数 = N+1)。
     上限超過時に打ち切って warn すること (§3.6)。
   - 移行 (p7-4) のべき等性: 2 回実行してもレコードが増えないこと。
   - `receiveRemoteBatches` / `discoverRemoteFiles` の既存不変条件 (echo ループ回避・
     marker 経路・`observe`・孤児 batch 防止) が保たれること。
3. **実機 e2e (2 端末, PDS 共有)** — [user-test-environment.md](../requirements/user-test-environment.md) §4 の手順で:
   - 端末 A の編集が端末 B に伝播する (既存の受入基準の再確認)。
   - 端末 A の新規ファイルが端末 B に materialize する。
   - **ファイルを 3 つ以上持つ状態で**、B の起動時リクエストが「列挙 N+1 件 + 開いている
     ファイル 1 つ分」に収まる (ネットワークタブで確認)。他ファイルの batch を落としていない。
4. **PDS 直接検査** — [user-test-environment.md](../requirements/user-test-environment.md) §5.1 の
   スクリプトで batch コレクションの rkey が新形式であることを確認する。
   **画面は証拠にしない** (W3d5 critic A2 の教訓)。
5. **実測 before/after** — 同一データで、リクエスト数と転送量を Phase 6 時点と比較して記録する。
   改善が無ければ設計が誤っている。
6. **full gate** — lint / typecheck / 全テスト green、client build 成功。

### 5.1 【p7-0 実施結果】cursor 意味論を実機で確定 — 全 12 項目 PASS (2026-07-30)

docker PDS (`ghcr.io/bluesky-social/pds:latest`, :2583) に対し、**投棄前提の spike スクリプト**
(生の XRPC を fetch で叩くだけ・依存ゼロ) で観測した。**`alice.test` を汚さないよう
spike 専用アカウントを invite code から作り、検証後に `com.atproto.admin.deleteAccount` で
repo ごと削除した** (実行後に `alice.test` の batch 21 件が無傷であることを確認済)。

仕込んだデータ: 新形式 rkey = 3 ファイル (先頭が `1…` / `5…` / `9…` の UUID) × 各 3 batch、
加えて**旧形式 rkey (小文字 hex UUID) 4 件**を同じコレクションに混ぜた。

| 観測 | 結果 |
|---|---|
| ⓪ rkey 構文 | `~` を含む **89 文字**の rkey が `putRecord` に受理された (9 件) |
| ② 昇順 | `reverse=true` の並びが rkey 昇順 (13 件) |
| ② 降順 | `reverse` 省略時は rkey 降順 |
| ① 合成 cursor | 前回応答由来でない `cursor = v1~<fileId>` が **200 で受理**された |
| ① 昇順 seek の先頭 | 1 件目が対象ファイルの先頭レコード (`v1~5555…~000000000001~…`) |
| ① prefix の連続性 | 対象ファイルの 3 件が連続し、他ファイルが間に挟まらない |
| ① 旧 rkey 不出現 | `v1~` より小さい旧 rkey は昇順 seek に**現れない** |
| ③ ファイル飛ばし | 降順 + `cursor = v1~<fileId>` が対象ファイル 3 件を飛ばし、**1 つ小さいファイルの最終レコードに着地** |
| ③ ファイル列挙 | 全 fileId をちょうど 1 回ずつ降順で列挙。**リクエスト数 4 = ファイル数 3 + 1** (§3.3 の予測どおり) |
| ④ limit 上限 | `limit=101` は **400 InvalidRequest** / `limit=100` は 200 → **上限 100** (現行実装の `PAGE_LIMIT = 100` は既に上限値) |
| ⑤ 既存 rkey 形式 | `alice.test` の batch **21 件すべてが小文字 hex UUID** (逸脱 0 件) |
| ⑤ `v1~` 分離 | 既存 rkey の最大値 `f28b4dce-…` **< `"v1~"`** — 新旧が rkey 空間で分離する |

**帰結**: §3.2 (prefix seek) / §3.3 (ファイル列挙) / §3.1 (`v1~` 分離) はいずれも実機で成立した。
§3.3 の索引コレクション fallback へ切り替える必要はない。§6.1 (PDS 実装依存) のリスクは
「稼働 image で確認済」まで下がるが、**契約ではなく実装の性質である**点は変わらないので
緩和策 (b)(c) — 2 関数への封じ込めと fallback 案の温存 — はそのまま維持する。
§6.6 の前提 (旧 rkey は小文字 hex) も実データで裏取りできた。

### 5.2 【p7-2 実施結果】ファイル単位の範囲取得 (2026-07-30)

`pullRemoteForFile(fileId)` を追加し、**ファイル単位の消費者をすべてそちらへ載せ替えた**。
`pullRemote()` (repo 全件) に残るのは `discoverRemoteFiles` (p7-3 で置換) だけになった。

| 変更 | 内容 |
|---|---|
| `rangeFetch.ts` (新規) | `listByRkeyPrefix(listPage, prefix, seekCursor)`。**合成 cursor への依存をこのファイルに閉じ込めた** (§6.1 の緩和 b)。ページ取得を引数で受けるので `getAgent()` 非依存で、停止条件とリクエスト数を単体で固定できる |
| `collections.ts` | 内部 `listRecords` を `listRecordsPage` (1 ページ・`reverse`/`cursor` 受け) に分解し、その上に全件版と `batches.listByFile(fileId)` を載せた。`PAGE_LIMIT = 100` は p7-0 で確認した PDS の上限値 |
| `atprotoSyncProvider.ts` | `pullRemoteForFile` を追加。レコード → `RemoteBatch` の翻訳 (id 復元・整列・counted skip) を `toRemoteBatches` に括り出し、全件版と共有 |
| `remoteSyncQueue.ts` | `RemoteBatchTarget` / `RemoteSyncQueue` に `pullRemoteForFile` を通し、**`catchUp` の取得もファイル単位へ**。以前は 4d-4 で JS 側の絞り込みだけが入り転送量は全件のままだった |
| `receiveRemoteBatches.ts` | deps を `pullRemoteForFile` へ。**fileId フィルタは防御として残し** (§3.5)、0 件でなければ warn する検知器にした |
| `useEventSyncTap.ts` | 受信の配線をファイル単位取得へ |

**設計との差分 (1 点)**: §4 のスライス表は p7-2 を「`receiveRemoteBatches` の載せ替え」と
書いていたが、`RemoteSyncQueue.catchUp` も**ファイル単位の消費者**だったので同じスライスで
載せ替えた。ファイル単位の消費者を 1 つだけ旧経路に残す理由が無く、p7-5 の削除条件を
先に整えられるため。非破壊であることは変わらない。

**テスト (+16 件, 全 663 pass)**:
- `rangeFetch.test.ts` (新規): 実 PDS の cursor 意味論を模した pager で、**結果とリクエスト数
  と cursor 列**を固定。prefix 境界での停止 (1 リクエスト)、複数ページの継承、
  旧 rkey 40 件を混ぜてもリクエスト数が比例しないこと、空ページ + cursor での無限ループ回避。
- `atprotoSyncProvider.test.ts`: in-memory collection の `listByFile` を実 PDS と同じ手順で
  実装し**走査件数を公開**。隣接 fileId 不混入 / 走査が repo 全体に比例しない (11 件中 2 件) /
  旧 rkey を 1 件も走査しない / 既読位置を持たない / 整列規則 / 合成 cursor の境界性質。
- `remoteSyncQueue.test.ts`: catch-up が全件 pull を呼ばない (`fullPulls === 0`) こと。
  D-6 の JS フィルタは「範囲取得が漏らした」状況を作って防御として検証する形に変えた。
- `receiveRemoteBatches.test.ts`: 取得が**開いている fileId を引数に**呼ばれること。

**gate**: lint / typecheck / 663 tests green、client build 成功。
実測 (§5-5) と実機 e2e は p7-6 で行う。

### 5.3 【p7-3 実施結果】ファイル列挙と未知ファイルの発見 (2026-07-30)

`discoverRemoteFiles` を「repo 全件取得 → 既知分を捨てる」から
**「fileId を列挙 → 未知ファイルの分だけ本体を取る」**へ変えた。
**`pullRemote()` (repo 全件) の消費者はこれで 0 になった** — 残るのは移行 (p7-4) だけ。

| 変更 | 内容 |
|---|---|
| `rangeFetch.ts` | `listBatchFileIds(listPage, maxRequests?)` を追加。降順 1 件 seek + 合成 cursor `v1~<fileId>` でファイルを丸ごと飛ばす (§3.3)。`ListRecordsPage` に `limit` を足し、列挙は **1 リクエスト 1 レコード**にした |
| `collections.ts` | `batches.listFileIds()`。`listRecordsPage` が `limit` を受けるようになった |
| `atprotoSyncProvider.ts` | `listRemoteFileIds()` (collection への委譲) |
| `remoteSyncQueue.ts` | `RemoteBatchTarget` / `RemoteSyncQueue` に `listRemoteFileIds` を通す |
| `discoverRemoteFiles.ts` | deps を `listRemoteFileIds` + `pullRemoteForFile` へ。取得結果の fileId フィルタは防御として持ち、食い違いは warn。**batch が 0 件のファイルは materialize しない** (列挙にだけ現れた食い違いで空ファイルを作らない) |
| `useFileSheetOperations.ts` | 発見の配線を列挙経路へ |

**設計との差分 (2 点)**:

1. **`skippedKnown` → `skippedKnownFiles` に改名**した。§2.1 の目標は「`skippedKnown` が 0」
   だったが、既知ファイルの batch を 1 件も落とさなくなった結果、**batch 数を数える
   フィールドは常に 0 の飾りになる**。単位がファイル数に変わったことを名前で伝える方が
   誠実なので改名した (呼び出し側は `discovered` / `appended` しか読んでいない)。
2. **壊れた新形式 rkey に着地したときの扱い**を実装で決めた (設計は未規定)。飛ばす cursor が
   作れないので**その 1 件分だけ cursor を進める**。止めると以降のファイルを見落とし、
   進めないと同じ場所を回り続ける。件数は warn に出す。
   あわせて**同じ fileId への再着地を検知して止める** — 上限 (§3.6) に達するまで回らせず、
   前提が崩れた瞬間に気付けるようにした。

**テスト (+10 件, 全 673 pass)**:
- `rangeFetch.test.ts`: **リクエスト数 = ファイル数 + 1** (3 ファイルで 4)、`limit` が 1 で
  あること、旧 rkey 30 件を混ぜても 2 リクエストで終わること、壊れた rkey を 1 件跨ぐこと、
  再着地の検知、上限での打ち切り。fileId は実データと同じ UUID 固定長で作る。
- `atprotoSyncProvider.test.ts`: 列挙が fileId を返すこと / 旧 rkey しか無いファイルは
  現れないこと (移行前の穴は §3.4 の全件受信が塞ぐ)。
- `discoverRemoteFiles.test.ts`: **既知ファイルの本体を取得しない** (`pulledFor` で固定)、
  未知なしなら取得も書き込みも 0、列挙にだけ現れて batch が取れないファイルは
  materialize しない。

**gate**: lint / typecheck / 673 tests green、client build 成功。

### 5.4 【p7-4 実施結果】移行と再 push コストの実測 (2026-07-31)

§3.4 の手順を 1 つの手続き (`src/client/src/sync/migrateRemoteRkey.ts`) に固定し、
起動経路 (`useFileSheetOperations` の発見 effect) の**発見より前**に置いた。

#### 実測 — `applyWrites` を採る (§6.3 の判断点)

docker PDS (`ghcr.io/bluesky-social/pds:latest`, :2583) に対し、**投棄前提の spike**
(生の XRPC・依存ゼロ) で計測した。p7-0 と同じく **spike 専用アカウントを invite code から
作り、検証後に `com.atproto.admin.deleteAccount` で repo ごと削除**している。

| 書き方 | 200 件の所要 | 1 件あたり | リクエスト数 |
|---|---|---|---|
| 直列 `putRecord` (現行 `pushRemote`) | 4084ms | 20.4ms | 200 |
| `applyWrites` × 25 | 409ms | 2.0ms | 8 |
| `applyWrites` × 50 | 387ms | 1.9ms | 4 |
| `applyWrites` × 100 | 250ms | 1.3ms | 2 |
| **`applyWrites` × 200** | **209ms** | **1.0ms** | **1** |

**局所 PDS で RTT がほぼ 0 の条件での 20 倍差**である。つまりこれは往復回数ではなく
**repo commit 回数**の差 — 1 レコード 1 commit だと MST 更新・署名・firehose イベントの
費用が件数分かかる。WAN 越し (VPS) ではここに RTT の差が上乗せされるので、差はさらに開く。
**採用する。**

境界も実機で確定した:

| 観測 | 結果 |
|---|---|
| ① 1 リクエストの write 上限 | 200 は 200 OK / **201 は `400 InvalidRequest "Too many writes. Max: 200"`** |
| ② `#update` を存在しないレコードへ | **500** (使えない) |
| ③ `#create` を既存 rkey へ | **500** — `putRecord` と違い**べき等ではない** |
| ④ チャンクの原子性 | `[既存, 新規]` の create は 500 で、**新規側も書かれない** (巻き戻る) |
| ⑤ `putRecord` の再実行 | 2 回とも 200 (上書き = べき等。現行 `pushRemote` の前提は健在) |

#### ③④ が設計を変えた点 — 再 push は「差分だけ」を書く

§3.4 は「ローカル正典の全 batch を再 push、rkey が決定論的なので何度実行しても収束」と
書いていた。これは `putRecord` のべき等な上書きに依存した記述で、`applyWrites#create`
では成立しない (既存 rkey が 1 件でもあるとチャンクごと失敗する)。

そこで再 push を **「ローカル正典 − すでに新 rkey で載っている分」** に変えた。差分は
p7-2 の範囲取得 (`pullRemoteForFile`) で取る — **新形式しか見ない**ので、旧 rkey で
載っているレコードを「載っている」と誤判定しない。結果として:

- 1 回目は全件が差分になり、まとめ書きで一気に載る。
- **やり直し (marker が立つ前の再実行) では載っていない分だけを書く** — §6.2 の
  「何度でもやり直せる」が、べき等な上書きではなく**差分計算**によって保たれる。
- 通常の送信 (outbox の再送) は**べき等な `pushRemote` (putRecord) のまま**。
  非べき等な口は移行だけが使う (`createRemote`)。

#### 設計との差分 (3 点)

1. **再 push の対象を「全件受信で remote に見えたファイル」に限った**。§3.4 は「各ファイル」
   としか書いていなかったが、それだと**一度も push していないローカルファイル**
   (ログアウト中に作った等) まで移行のついでに PDS へ上がる。移行は「PDS 上の旧形式
   レコードを載せ替える」作業であって同期作業ではないので、線を引いた。remote に無い
   ファイルは通常の catch-up (開いたとき) が回収する。
2. **再 push を `applyWrites` のまとめ書きにし、差分計算を入れた** (上記)。
3. **移行が失敗しても発見は走らせる**。設計は移行と発見の関係を規定していなかった。
   発見は非破壊で移行と独立に価値があるので、移行の例外は warn に出して発見へ進む
   (marker は立たないので次の契機で再試行される)。

#### 実装

| 変更 | 内容 |
|---|---|
| `sync/migrateRemoteRkey.ts` (新規) | 手続き本体と marker。1 が失敗したら 2 へ進まず marker も立てない (§6.2) |
| `sync/safeStorage.ts` (新規) | localStorage の try/catch ラッパ。`actor.ts` と marker が同じ守りを要したので括り出した |
| `sync/actor.ts` | `didFromActor` (= `composeActor` の逆)。marker が DID 単位のキーを要する |
| `atproto/collections.ts` | `createRecords` (applyWrites, 200 件チャンク) と `batches.createMany` |
| `atproto/atprotoSyncProvider.ts` | `createRemote(entries)` — **べき等でない**ことを型の説明で明示 |
| `atproto/remoteSyncQueue.ts` | `createRemote` を素通し。**キューを経由しない**理由 (上限 `REMOTE_QUEUE_MAX` で溢れると完了判定が嘘になる) をコメントに固定 |
| `hooks/useFileSheetOperations.ts` | 発見 effect の前段に移行を差し込み。marker を deps 化 (テストが移行の副作用に汚染されないため) |

**テスト (+22 件, 全 694 pass)**:
- `migrateRemoteRkey.test.ts` (新規, 16 件): 未受信の旧 rkey レコードが取り込まれること、
  2 回実行してレコードが増えないこと、**部分失敗後のやり直しで載っていない分だけを書く**こと、
  1 が失敗したら 2 へ進まず marker も立てないこと、ローカル専用ファイルを読みにも行かないこと。
  fake は **`applyWrites#create` の非べき等性と原子性を写して**あり、差分計算が抜けると落ちる。
- `atprotoSyncProvider.test.ts` (+2): `createRemote` が `pushRemote` と同じ rkey で書くこと、
  既存 rkey が混ざると失敗しレコードが増えないこと。
- `useFileSheetOperations.test.ts` (+3): 移行が発見より前に 1 回だけ走ること、marker が
  あれば全件 list を実行しないこと、移行が失敗しても発見は走ること。
- `actor.test.ts` (+3): `didFromActor` の往復と未ログイン時の扱い。

**gate**: lint / typecheck / 694 tests green、client build 成功。
実機 e2e と before/after の転送量実測は p7-6 で行う。

---

### 5.5 【p7-6 実施結果】実機 e2e と転送量の実測 (2026-07-31)

**環境**: docker PDS (:2583, `alice.test`) を共有し、device A = daemon :3000 / client :5173
(`DATA_DIR=data`)、device B = daemon :3001 / client :5175 (`DATA_DIR=data-b`) の 2 組。
別オリジンなので localStorage が分かれ、deviceId も session も独立する。
検証データは **Phase 6 以前に書かれた旧 rkey レコード 21 件を意図的に残したまま**始めた —
p7-4 の移行が実機で走るのは今回が初めてであり、これが唯一の実データだったため。

#### 移行 (p7-4) の実機初走行 — 成功

device A でログインした時点で移行が走り、**旧 rkey 21 件がすべて新形式で再 push された**
(fileId 別も一致: `aaaa1111…` 7 件 / `0ef2bb3d…` 14 件)。rkey は
`v1~<fileId>~<clock 12 桁>~<batchId>` の形式で、辞書順が clock 順と一致している。

**べき等性も実機で確認できた**: device B は marker を持たない別オリジンなので、
ログイン時に移行が再度走る。PDS のレコード数は **48 件のまま 1 件も増えなかった** —
差分計算 (§5.4) が「新形式で載っている分は書かない」と正しく判定している。
`applyWrites#create` が非べき等である以上、この判定が壊れれば 500 で失敗するので、
「増えなかった」は「差分計算が効いた」の十分な証拠になる。

#### 受入基準の結果

| 基準 | 結果 | 証拠 |
|---|---|---|
| §5-3 A→B の伝播 | **PASS** | A の編集 (`A-device edit for p7-6`) が B のローカル op-log に clock=4 で着地 |
| §5-3 B→A の伝播 | **PASS** | B の編集が clock=6/7 で PDS に載り A が受信。actor の deviceId が `97a7255b…` / `1af696c0…` に分かれ、`observe` が clock を 4 → 6 に前進させている |
| §5-3 新規ファイルの materialize | **PASS** | B が知らなかった C・D を列挙経由で発見し materialize |
| §5-3 起動時リクエスト数 | **PASS** | ファイル 4 つで **列挙 5 リクエスト (= N+1)、すべて `limit=1`**。ファイルを 1 つ開くと **そのファイルの prefix に対して 2 リクエスト** (catch-up と receive が 1 回ずつ)。**repo 全件 list は 1 度も発行されていない** |
| §5-4 PDS 直接検査 | **PASS** | `inspect-remote-batches.ts` の 4 項目すべて PASS (下記の修正後) |
| 収束・適用不能 op 0 件 | **PASS** | `inspect-local-oplog.ts` を両端末で実行し全項目 PASS。**projection fingerprint が両端末で一致** (`d46bad43789e6dcd`)、全 8 op が projection へ効いた |

起動時リクエストの実測 (device B, ファイル 4 つ):

```
listRecords?limit=1                                        ← 最大 rkey へ着地
listRecords?limit=1&cursor=v1~ef63b629-…                   ← 1 ファイル飛ばす
listRecords?limit=1&cursor=v1~aaaa1111-…
listRecords?limit=1&cursor=v1~8c518613-…
listRecords?limit=1&cursor=v1~0ef2bb3d-…                   ← 旧 rkey 領域に落ちて終了
```

降順 (`e` > `a` > `8` > `0`) に 1 ファイル 1 リクエストで進み、5 回目で旧 rkey 領域に
着地して止まっている。§3.3 の走査がそのまま実機で成立した。

#### §5-5 転送量の before/after

同一データ (batch 48 件 / ファイル 4 つ) に対し、走査の論理は本番コード (`rangeFetch.ts`)
のまま、ページ取得だけを計測付きの生 fetch に差し替えて測った (投棄前提のスクリプト)。

| 経路 | リクエスト数 | 転送レコード数 | バイト数 |
|---|---|---|---|
| **before**: repo 全件 list (Phase 6 相当) | 2 | 48 | 31,700 |
| **after**: 列挙 (N+1) | 5 | 5 | 3,594 |
| **after**: 開いたファイル 1 つ (最小ケース `ef63b629`) | 2 | 2 | 1,106 |
| **after**: 開いたファイル 1 つ (最大ケース `0ef2bb3d`) | 1 | 27 | 18,158 |

起動 1 回分 (列挙 + ファイル 1 つ) は **4,700〜21,752 バイト = 全件 list の 14.8〜68.6%**。
リクエスト数は増える (2 → 7) が、**1 リクエストあたりが軽くなり総転送量が減る**方向で、
これは設計が意図した交換である。

#### ⚠️ 正直な限界 — prefix 走査は「1 ファイル分」より多く**転送**する

上表の最大ケースが示すとおり、**転送量は対象ファイルの batch 数では決まらない**。
`listByRkeyPrefix` は `limit=100` の 1 ページを受け取ってから prefix 境界で読むのをやめる
ので、**そのファイルより後ろにあるレコードも同じページに載って転送される**。
`0ef2bb3d` は rkey 空間の先頭にあるため、自分の 14 件に加えて後続 13 件を受け取っていた。

つまり実際の上限は「**そのファイルの batch 数 + 最大 1 ページ (99 件) の読み過ぎ**」である。
`rkeyStart`/`rkeyEnd` が使えない (§1.3) 以上、上端を cursor で指定する手段が無いため、
これは現行 API での構造的な下限にあたる。重要なのは **repo 全体には比例しない**ことで、
履歴とファイル数が増えるほど全件 list との差は開く。§5-3 の「他ファイルの batch を
落としていない」は**保持**については成立しているが、**転送**については上記の読み過ぎがある
— 受入基準の文言が転送と保持を区別していなかったので、ここに事実を書き残す。

#### 検査スクリプトの偽 FAIL を修正した (移行後の世界への追随)

移行直後に `inspect-remote-batches.ts` を回すと **2 件 FAIL** (「genesis id が分岐」
「同一スコープで clock 衝突」) が出た。原因は実装ではなく検査器にある — 移行は旧 rkey の
レコードを消さない (§3.4) ので、移行済みの batch は**旧 rkey と新 rkey の 2 レコード**として
repo に存在する。全件を走査する検査器はこれを 2 つの batch と数えていた。
実際には **21 件すべてが同一 id で新形式にも存在**しており、分岐も衝突も起きていない。

本番の読取経路 (`pullRemoteForFile`) は `v1~` 以外を走査しないので、**検査器も
新形式だけを見るように揃えた** (旧 rkey は件数だけ表示し、黙っては捨てない)。
新形式が 0 件で旧 rkey がある場合は「移行が未実行」として明示的に落とす。

これは 4d-6 で得た教訓「検査器がノイズで赤くなると本当の欠落が埋もれる」と同型で、
放置すれば移行後の repo では検査器が**恒久的に赤**になっていた。

**gate**: lint / typecheck / 全テスト green。

---

## 6. リスクと未解決点

### 6.1 【High】cursor の挙動が PDS 実装依存である

§1.3 はリファレンス実装のソースに基づく。`cursor` に検証が無く rkey として直接比較される
ことは、lexicon が保証する契約ではなく**実装の性質**である。将来の PDS が cursor を
opaque token 化したら §3.2 / §3.3 は壊れる。

**緩和**: (a) p7-0 で稼働 image に対して実測して確定させる。(b) 合成 cursor に依存する箇所を
`listByFile` / `listFileIds` の 2 関数に閉じ込め、壊れたときの差し替え面を小さくする。
(c) fallback 案 (索引コレクション, §3.3) を設計として温存する。
(d) 自分たちが self-host する PDS なので、更新のタイミングを握っている。

### 6.2 【High】移行の順序を誤ると PDS にしか無い batch を失う

§3.4 の 1 (旧経路で 1 回だけ全件受信) を飛ばして 2 (再 push) から始めると、
別端末が push した未受信 batch が prefix 走査の外に取り残される。ローカル正典にも無いので
**復元できない**。

**緩和**: p7-4 で 1 → 2 → 3 を 1 つの手続きに固定し、1 が失敗したら 2 へ進まない・marker を
立てない。単体テストで「未受信の旧 rkey レコードがある状態」から移行して取り込まれることを
固定する。旧レコードは**削除しない**ので、marker が立つ前なら何度でもやり直せる。

### 6.3 【Medium】再 push のコストとレート制限

ローカル正典の全 batch を PDS へ書き直す。件数が多いと `putRecord` の往復とレート制限が効く。

**緩和**: p7-4 で実測してから受入基準を決める (Phase 6 §6.2 と同じ運び)。
`applyWrites` によるまとめ書きを評価する。許容外なら「開いたファイルから順に移行する」
遅延移行へ切り替える判断点を p7-4 に置く。ただし遅延移行は移行中の期間が延びる = 二重状態が
長引くので、まず一括を試す。

**【p7-4 で解消】** 実測 (§5.4) の結果、`applyWrites` のまとめ書きで **200 件 209ms
(1.0ms/件)** になった。1 件 1 commit の `putRecord` (20.4ms/件) の約 20 分の 1 で、
個人利用の規模なら一括移行が起動経路に載る。**遅延移行へは切り替えない。**
レート制限には触れなかった (200 件 = 1 リクエスト、局所 PDS)。VPS 越しの実測は p7-6。

### 6.4 【Medium】1 ファイルの履歴の単調増加は解決しない

本 Phase 後も、開いているファイルは**毎回そのファイルの全履歴**を読む。編集を続ければ
そのファイルのコストは単調に増える。R3 の「全件 list をやめる」は満たすが、
根本 (差分だけ読む) には到達しない。

**なぜ本 Phase で解かないか**: 差分読取は既読位置を要求し、それが §1.4 の 3 つの理由で
今も安全に作れない。サーバ割当の単調な値 (repo の `rev`) を使う道は
`com.atproto.sync.getRepo?since=<rev>` = CAR 差分の解釈が必要で、Jetstream 化 (Phase 8) と
同じ層の仕事になる。**Phase 8 で firehose 卒業を判断するときに、この 2 つを併せて扱う**
のが正しい切り方。もう 1 つの道は checkpoint (ある clock までを 1 レコードに畳む) で、
これは op-log の圧縮 = 拡張エンジン (step2) の題材。

**受入基準に含める**: 実測 (§5-5) で「1 ファイルあたりの履歴量」も記録し、
Phase 8 の判断材料として残す。

### 6.5 【Low】branch は影響を受けない

branch は local op-log 専業 (Phase 5 §9.2 の不変条件, Phase 6 §6.4 で再確認)。
remote 読取経路の変更を受けない。

### 6.6 【Low】`v1~` 分離は「旧 rkey が小文字 hex UUID」に依っている

§3.1 の分離は、既存レコードの rkey がすべて `crypto.randomUUID()` 由来 (先頭 `0-9a-f`) で
あることに依る。大文字 hex でも順序は変わらないが、もし将来 `v` より大きい先頭文字を持つ
rkey を別用途で書いたら分離が崩れる。

**緩和**: p7-0 の観測項目⑤で実 PDS のレコードを確認する。以後 batch コレクションの rkey は
`batchRkey()` **だけ**が生成する (直書きを許さない) ことをコメントで固定し、
§3.6 の上限超過 warn を崩れの検知器として残す。

### 6.7 【Low】lexicon の記述ドリフト

`lexicons/app/conversensus/graph/batch.json` の説明文が
「rkey = BatchId (UUID)」「genesis-actor batches are never pushed to remote」と書いており、
前者は本 Phase で、後者は Phase 4e-0 で既に事実と違う。`"key": "any"` なので**動作には
影響しない**が、p7-1 で説明文を実態へ合わせる。

---

## 7. 前フェーズ教訓との突き合わせ

| 教訓 | 出典 | Phase 7 での適用 |
|---|---|---|
| 設計の対策は既存仕様・外部 API の型と突き合わせる | [[feedback_design_vs_existing_spec]] | §1.3 — `rkeyStart`/`rkeyEnd` が使えないことを設計段階で発見し、cursor seek へ設計を組み替えた |
| 二重モデルは実害を出す | Phase 5 §10.2-1 / Phase 6 §6.1 | §2.2 — 既読位置を持つ「書くが読まない」経路を作らない。§3.3 — 索引コレクションを既定にしない |
| 安全弁は倒す先が無いと成立しない | Phase 6 §3.7 / §4.3 | §4 — フラグを設けず、非破壊スライスの順序で安全性を担保する |
| e2e を不可逆化の前に通す | Phase 6 §6.1 | §4 — p7-6 の e2e を p7-5 の削除より前に実施する |
| 無言の失敗を作らない | W3d5-7 / Phase 5 M3 | §3.6 — 弾いたレコード・移行結果を必ず数えて出す |
| 画面は証拠にならない | W3d5 critic A2 | §5-4 — PDS レコードとネットワークタブで判定する |
| コストは実測してから受入基準を決める | Phase 6 §6.2 | §5-5 / §6.3 — before/after の実測を受入基準に置く |

---

## References (実コード裏取り, main = `d0b37ce`)

- `src/client/src/atproto/collections.ts:50` — `listRecords` (repo 全件, `limit: 100` の cursor 全周) / `:86` `batches` (put/get/list/delete)
- `src/client/src/atproto/atprotoSyncProvider.ts:87-142` — `pullRemote` (全件・既読位置なし) の根拠コメントと実装 / `:157` `subscribe` (消費者 0)
- `src/client/src/atproto/remoteSyncQueue.ts:41,118,134` — `since` を取らない理由 / `pullRemote` 素通し
- `src/client/src/atproto/batchMapper.ts` — `batchToRecord` / `recordToBatch` (id を rkey から復元) / `isBatchRecordValue` (数えて warn する境界ガード)
- `src/client/src/atproto/types.ts` — `NSID.batch` / `BatchRecord` (fileId 必須) / `RemoteBatch`
- `src/client/src/sync/receiveRemoteBatches.ts:56-63` — 全件取得 → 1 ファイル分に絞る (`skippedOtherFile`)
- `src/client/src/sync/discoverRemoteFiles.ts:55-72` — 全件取得 → 既知ファイルを捨てる (`skippedKnown`)
- `src/client/src/atproto/remoteFilter.ts` — `filterBatchesForRemote` (再 push でも通す)
- `lexicons/app/conversensus/graph/batch.json` — `"key": "any"` (rkey 形式を lexicon が縛らない)
- 外部: `@atproto/api@0.19.6` `com/atproto/repo/listRecords.d.ts` (`rkeyStart`/`rkeyEnd` 不在) /
  PDS リファレンス実装 `packages/pds/src/actor-store/record/reader.ts` (`orderBy(rkey, reverse ? 'asc' : 'desc')`, `where(rkey, reverse ? '>' : '<', cursor)`) /
  `packages/pds/src/api/com/atproto/repo/listRecords.ts` (返す cursor = 最後のレコードの rkey, 入力 cursor は無検証)
