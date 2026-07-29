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
| **p7-1** | rkey 純関数 (`batchRkey` / `parseBatchRkey`) + テスト。`pushRemote` を新 rkey へ切替。**読取は全件のまま**で両形式を許容 (非破壊) | なし |
| **p7-2** | `listByFile` / `pullRemoteForFile` を追加し `receiveRemoteBatches` を載せ替え | なし (旧経路は残存) |
| **p7-3** | `listFileIds` / `listRemoteFileIds` を追加し `discoverRemoteFiles` を「列挙 → 未知ファイルだけ prefix 取得」へ | なし |
| **p7-4** | 移行 (§3.4): 1 回だけ全件受信 → 新 rkey で再 push → marker。実測 (件数・所要時間) | **あり** (PDS へ書く) |
| **p7-5** | 全件 list の撤去: `pullRemote()` / `collections.batches.list()` / `subscribe` を退役 | **あり** (削除) |
| **p7-6** | **実機 e2e + 実測**: 2 端末での伝播、リクエスト数・転送量の before/after、PDS 直接検査 | 検証のみ |

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
