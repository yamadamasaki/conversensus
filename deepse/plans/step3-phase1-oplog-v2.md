# step3 Phase 1: op-log v2 — 設計

> ステータス: **Q1〜Q3 確定、実装中** / 作成日: 2026-09-30
> 親: [step3 実装計画](./step3-implementation.md) の Phase 1。入力は [step3-entry](./step3-entry.md) の
> §2.1 (clock) と §2.2 (二本立て)、[architecture/step3.md](../architecture/step3.md) の §3 (D1〜D3)、
> Phase 0 の実測 (S0-3)。
>
> **互換性は考えない** (architecture §1.1)。既存の op-log は読まず、移行もしない。

## 0. この Phase で入れるもの

| | 変更 | 種類 |
| --- | --- | --- |
| 1 | batch に**因果の文脈** (actor ごとの連番と依存 vector) を持たせる | 畳み込みの**判断**の規則 |
| 2 | 分岐点を vector で切る (`Commit.baseVector`) | 畳み込みの規則 |
| 3 | 競合検出 (T5) と上書きの報告 (T8) を「並行か」で判定し直す | 判定の規則 |
| 4 | 参加期間を vector で判定し直す (step3-entry §2.1 の 4 つ目の限界) | 判定の規則 |
| 5 | merge の写しが他人の名前で clock を振らないようにする | 語彙の変更 |
| 6 | DtR の撤去 | 語彙の削除 |
| 7 | sheet の種別プロパティと `TemplateRef` | 語彙の追加 |
| 8 | 導出 node を受け付ける畳み込み (metagraph の前提) | 畳み込みの規則 |
| 9 | 保存形式 (collection・rkey・lexicon) を v2 にする | 形式 |

---

## 1. コードを読んで判明した事実

### F1: 全順序はそのまま使える

🔵 `compareByClockActorId` (clock → actor → id) が projection の決定論 = SEC の土台である。
Lamport は受信で `observe` (max+1) するので、**因果の順と矛盾しない全順序**になっている。
vector は**畳み込みの順序を置き換えない**。順序はこれまでどおり scalar で決め、vector は
「並行か」を問う判断 (競合・上書き・参加期間・分岐点) にだけ使う。

→ **SEC の性質テスト (`convergence.test.ts`) は形を変えずに生き残る。**畳み込みの規則を
変えるのは 2 と 8 だけである。

### F2: actor の clock は単調だが連続しない

🔵 `LamportClock.tick()` は +1、`observe()` は max+1 なので、同じ actor の clock は
**厳密に増えるが飛ぶ** (5, 6, 19, 20, …)。したがって clock からは「この actor の batch を
**歯抜けなく**受け取ったか」が分からない。vector の前提 (「actor A の n 番目まで見た」は
「A の 1〜n 番目をすべて持っている」) が作れない。

→ **actor ごとの連番 (`seq`) が別に要る** (D1)。

### F3: merge の写しが、書いた人の名前で merge した人の clock を振っている

🔵 `mergeBranch.ts` は branch の batch を trunk へ写すとき、**id と `actor` (書いた人) を保ち、
clock だけを merge した人の発番器で振り直す** (`restampedBy` に merge した人を残す)。

vector は「actor A の batch に番号を振るのは A だけ」という前提に立つ。写しがこれを破るので、
**今の写し方のままでは vector を載せられない。**step3-entry 問 10 (merge を写しから参照へ) が
ここで避けられない問いになる (D2 / Q1)。

### F4: 競合と上書きの境界は scalar 1 つ

🔵 `conflicts.ts` の T5 は `local.filter(b => b.clock >= oldestIncoming)` を「相手が見ていなかった
私の op」とし、`overwrites.ts` の T8 はその**厳密な補集合**を取る。純粋な並行が clock の大小で
「競合」と「変わりました」に振り分けられる (step3-entry §2.1、実行で確認済み)。

### F5: 参加期間は、別の actor の clock どうしを比べている

🔵 `wasParticipatingAt` は期間の `from` (承認した本人の clock) と `to` (取り消した人の clock) を
対象者の batch の clock と比べる (step3-entry §2.1 の 4 つ目の限界、実行で確認済み)。

### F6: 判断ログとグラフの op-log は同じ clock 空間を共有する

🔵 `appendJudgment` は既知の判断ログの最大 clock で tap の発番器を seed してから振る。
pre 条件が「この操作より前」を問うので、2 つのログは同じ物差しで並ばなければならない。
→ **連番 (`seq`) も 2 つのログで共有する** (D1)。

### F7: 取得は毎回全件 (S0-3)

🔵 rkey は `v1~<fileId>~<clock>~<batchId>` で、ファイル単位の範囲取得はできるが、
**既読位置を持たないので毎回全件読む。**10 人 × 2000 件で 1 サイクル約 10 秒・10 MB。
actor ごとの cursor は連番の上でしか正しく持てない。

---

## 2. 設計方針 (D)

### D1: batch は「点」と「依存」を持つ

```ts
type Seq = number;                       // actor ごとの連番。1, 2, 3, … 歯抜けなし
type VersionVector = Record<Actor, Seq>; // actor ごとに「何番まで歯抜けなく見たか」

Batch = {
  …今までどおり (id, actor, clock, timestamp, sheetId, ops),
  seq: Seq,              // この batch の点 (actor, seq)
  deps: VersionVector,   // 書いた時点で見ていたもの (自分の分は seq - 1 と決まるので載せない)
}
```

- **`deps` は「持っているもの」ではなく「因果として知っているもの」である** (S1-2 で確定)。
  受け取った batch の `deps` も取り込んだ vector (普通の vector clock) で、持っていない batch も
  含みうる。こうしないと推移律が崩れる — B が A を見て書いた batch を、A を持たない C が
  受け取って書いても、A は C より前でなければならない
- **因果の判定は定数時間**: a が b より前 ⇔ `a.actor === b.actor ? a.seq < b.seq : (b.deps[a.actor] ?? 0) >= a.seq`。
  どちらでもなければ並行
- **手元の到達点 (frontier)** は、actor ごとに**歯抜けの無い最大の seq**。歯抜けの先に届いた
  batch は畳み込みには入る (順序は F1 の全順序で決まるので害が無い) が、vector を使う判断では
  「まだ見ていない」側に数える
- **連番は判断ログと共有する** (F6)。判断 batch も同じ `seq` / `deps` を持つ
- **発番の前提**: 同じ actor の batch の seq は、その端末で連続して振られ、永続化される。
  tap の復元 (`seed`) を clock と同じ経路で行う

### D2: merge の写しは、merge した人自身の batch にする (Q1 の既定案)

写しは **merge した人の新しい点** (新しい id・merge した人の actor・その人の seq と deps) を持ち、
元の batch を `copyOf: { actor, seq }` で指す。書いた人の名前で番号を振らなくなるので、
D1 の前提が守られる。

- 同じ branch を 2 人が並行に merge すると写しが 2 組できる。畳み込みは `copyOf` が同じ
  写しのうち全順序で最初のものだけを採る
- 参加期間の判定は、写しについては**写した人** (= その batch の actor) で行う。
  `stackedBy` / `restampedBy` は要らなくなる
- 参照型 (写さずに branch の op-log を引く) は取らない。trunk を畳むのに branch の op-log の
  取得が要り、S0-3 の取得費用がさらに増える

### D3: 分岐点は vector で切る

`Commit.baseVector: VersionVector` を持つ。branch の base は「trunk の batch のうち
`baseVector` に覆われるもの」。**`baseVector` は分岐した時点で actor ごとに持っていた最大の seq**
(S1-5 で確定。「歯抜けなく持っていた範囲」ではない — 下の実装の記録)。分岐後に届いた、分岐時には見えていなかった batch が
遡って base に入る穴 (step3-entry §2.1) が塞がる。`Commit.at` (scalar) は表示と
branch の発番の下限 (`clockFloor`) のために残す。

### D4: 競合と上書きは「並行か」で判定する

- **T5 (競合)**: 新着の batch と**並行な**手元の batch との間で `mergeBranches` を当てる
- **T8 (上書きの報告)**: 私の最後の値が相手の batch の**因果の過去にある**ものだけを報告する
- 2 つは「並行」と「前」で**排他かつ網羅**になる。どちらの手元でも同じ組が同じ側に振られる。
  layout (fork を作らない) の非対称もここで閉じる

### D5: 参加期間は「開いた判断の後」かつ「閉じた判断が見ていたもの」(Q2 の既定案)

actor の batch b が取り込まれる ⇔

1. その DID の参加を開いた判断 (genesis / accept / reopen) が b の因果の過去にある (または b 自身が
   その判断の後に同じ actor が書いたもの)
2. 閉じる判断 (resign / revoke) があるなら、**b がその判断の因果の過去にある**

2 が要点である。取り消し (revoke) は取り消した人の到達点を持つので、「取り消した人が見ていた
操作までは有効、それ以外は無効」になる。**取り消された人が取り消しを知らずに続けた編集は、
誰の手元でも落ちる。**別の actor の clock を比べないので、4 つ目の限界が消える。
自分で辞める (resign) ときは自分の点なので、辞める前の自分の編集がちょうど入る。

**変えるのはグラフの batch を取り込む判定だけである。**名簿そのものの畳み込み (判断 op の
pre 条件。取り消し合いが起きても全順序で誰の手元でも同じ結論になる、`participation.md` の
「整合性」節) は全順序のまま変えない。仕様の「参加していない期間の操作は project されない (6-3)」
「引き取りは新しい期間を開くだけ」とも両立する (2026-09-30 に突き合わせた)。

### D6: DtR を撤去する

判断ログの `dtr.*` と、名前による判別 (`isDtrSheetName` など)、`startDtr.ts`、関連 UI。
**判断ログそのもの (participation) は残す。**これで step3-entry の C・D と問 11〜18 がほぼ消える。

### D7: sheet の種別プロパティと `TemplateRef`

architecture §3.3 D3・§3.4 のとおり。`sheet.setProperty` を足し、種別は
`app.conversensus.sheetKind` に置く。`sheet.create.templateIds` は
`TemplateRef = 作り込みの id | { sheet: SheetId, at: VersionVector }` の配列にする。

### D8: 導出 node

architecture §3.2 D2 のとおり。導出 node の id は SheetId から決定的に作り (U4)、
畳み込みは「`node.add` の無い導出 node への `node.setLayout` と、それを端点にする edge」を受け付ける。

### D9: 保存形式を v2 にする (Q3 の既定案)

- **collection を新しくする** (`app.conversensus.v2.batch` / `app.conversensus.v2.judgment`)。
  古い記録は別の collection に残り、新しい読み手には最初から見えない。rkey の版を
  切り替えるより境界がはっきりし、移行の分岐 (`migrateRemoteRkey.ts` など) を丸ごと消せる
- **rkey は `<fileId>~<deviceId>~<seq>`** (seq は 12 桁の 0 詰め)。点 (actor, seq) で一意なので
  batchId は入れない。**actor ごとの範囲取得ができる形にしておく** — 実際に cursor を持つのは
  この Phase ではないが (N)、後で持つときに形式を変えずに済む
- ローカルの eventStore (SQLite) も seq / deps の列を持つ。Phase 2 でブラウザへ移るので、
  ここでは列を足して古い DB を捨てるだけにする

---

## 3. スライス (S)

撤去を先に置く。**触る面積を減らしてから規則を変える。**

| | 内容 | 固めるテスト |
| --- | --- | --- |
| **S1-1** ✅ | DtR の撤去 (D6) | App 結合 / 単体 (撤去後も緑) |
| **S1-2** ✅ | 点と依存の型、因果の判定、到達点 (D1) — 純粋関数 | **性質**: 因果の判定は半順序、到達点は歯抜けを越えない、全順序と矛盾しない |
| **S1-3** ✅ | 発番と保存 (tap・判断ログ・eventStore・PDS の v2 形式、D1 / D9)。移行コードの撤去 | 単体 / App 結合 (2 端末の往復) |
| **S1-4** ✅ | merge の写しを merge した人の点にする (D2) | 性質: 並行 merge でも畳み込みが一致する |
| **S1-5** ✅ | 分岐点を vector で切る (D3) | 例: 分岐後に届いた古い batch が base に入らない (step3-entry の再現) |
| **S1-6** ✅ | T5 / T8 を並行で判定する (D4) | **性質**: 両端末で同じ組が同じ側に振られる |
| **S1-7** ✅ | 参加期間を vector で判定する (D5) | 例: step3-entry §2.1 の再現 (clock の大小で結果が逆にならない) |
| **S1-8** | sheet の種別プロパティ・`TemplateRef` (D7) | 単体 |
| **S1-9** | 導出 node (D8) | 性質: 導出 node への op は sheet が在る限り受け付け、無ければ捨てる |

S1-2 から S1-7 は**間違えても静かに違う答えを出す側**なので、性質テストで固める
(step3-entry §2.1 の「スキーマの変更はうるさく失敗するが、畳み込みの規則の変更は静かに
違う答えを出す」)。

## 4. 着手前に訊くこと (Q)

**すべて既定案で確定した (利用者判断 2026-09-30)。**

| | 問い | 確定 |
| --- | --- | --- |
| **Q1** | merge の写しをどうするか (F3) | **merge した人自身の batch にし、元を `copyOf` で指す** (D2)。参照型は取得費用が増えるので取らない |
| **Q2** | 参加期間の閉じ方 (D5) | **取り消した人が見ていた操作までを有効にする。**取り消された人が知らずに続けた編集は落ちる |
| **Q3** | 保存形式の切り替え方 (D9) | **collection を新しくする** (`app.conversensus.v2.*`)。古い記録は読まない |

## 5. 未決 (U)

- **U1**: deps の大きさ。actor (端末) の数に比例する。step3-entry の概算は 1 batch あたり
  約 800 バイトだった (⚪)。S1-3 で実測し、大きければ「自分の直前の batch から変わった分だけ
  載せる」差分形式を考える
- **U2**: actor の退役規則 (step3-entry 問 7)。使われなくなった端末の項目を vector から
  落とせるか。**この Phase では作らない** (N)。U1 の実測で要否を決める
- **U3**: 歯抜けの先に届いた batch をいつまで「まだ見ていない」扱いにするか。
  全件取得を続ける限り、次のサイクルで埋まる
- **U4**: 導出 node の id の作り方 (UUIDv5 か、端点に SheetId を直接許すか)

## 6. この Phase でやらないこと (N)

- **actor ごとの cursor** (問 25)。rkey の形 (D9) だけ先に整え、取得の仕方は変えない
- actor の退役規則 (U2)
- merge の取り消し (問 17)
- 画面の変更 (Phase 3 以降)。DtR の撤去で消える画面を除く

## 7. 実装の記録

### S1-1 DtR の撤去 (2026-09-30)

`dtr.ts` / `startDtr.ts` / `remergeDtr.ts` とそのテスト、判断 op の `dtr.*`、`DtrId`、merge コミットの
`dtrId`、再 merge の写しを落とす関門 (`admissibleBatches` と `dtrJudgmentsRef`)、`onRoster` の DtR の腕、
サイドバーの `⇄` と 💬、競合の通知の「対話を始める」を外した。

- **関門を外したので、再 merge の写しは他の merge の写しと同じく常に畳み込みに入る。**
  承認という概念が無くなったので、落とす理由が無い
- **競合の通知の文言は残した** (「どちらを採るかは対話で決めます」など)。決着の手段は
  Phase 5 の merger になるので、文言はそこで merger への導線と一緒に直す
- `spikes/u6/` は自前の型を持つ過去の記録なので残した

### S1-2 因果の判定 (2026-09-30)

`shared/src/events/causality.ts`。点 `(actor, seq)` と `deps` から前・後・並行を答える判定と、
手元の到達点。性質テストは「判定が実際の因果そのものである」ことを、3 人が書いて互いの一部を
受け取る履歴で確かめる。

- **`deps` を因果の知識にした** (D1 に追記)。持っているものの vector にすると推移律が崩れる
- **最初の生成器は推移律の破れを見逃した。**古い batch を満遍なく拾うと「A → B → C」の連鎖が
  めったに起きない。受け取りを直近の batch に偏らせて捕まえた (`causality.test.md`)

### S1-3 発番と保存 (2026-10-01)

batch と判断 batch に `seq` / `deps` を必須で足し、発番・受信・保存・PDS の形式を v2 にした。

- **発番器** (`shared/src/events/causalClock.ts`): Lamport clock・自分の seq・因果の知識の 3 つを持つ。
  trunk の tap が File ごとに作り、**branch の tap・判断ログ・merge の再スタンプで共有する**
  (App が `trunkCausal` を branch へ渡す)。開いていない File への書き込み (承認・削除の tombstone) は、
  その File のログから復元した使い捨ての発番器で振る
- **受信**: `observeRemote` は clock の数値ではなく batch 列を受け取り、Lamport の受信規則と
  因果の知識への取り込みを両方行う。判断ログを読んだ分も同じ口で観測する
- **genesis**: グラフの genesis は固定の擬似 actor なので seq 1〜n・deps 空で決定的に振る。
  判断ログの genesis (作成者の実 actor) は **seq 0** にした — `covers` で常に覆われ、
  「誰にとっても因果の過去にある」ことになる (clock 0 が「あらゆる op より前」であるのと揃う)
- **PDS**: collection を `app.conversensus.v2.batch` / `.v2.judgment` にし、rkey を
  `<fileId>~<actor の # を : に>~<seq12>` にした。id は本文に持つ。lexicon は `lexicons/app/conversensus/v2/`。
  v1 の lexicon・NSID・移行コード (`migrateRemoteRkey` と全件取得・まとめ書きの口) を撤去した
- **ローカル**: eventStore に `dot_seq` / `deps_json` 列を足し、DB ファイルを `events-v2.db` にした
  (行の採番の `seq` 列と名前がぶつかるので `dot_seq`)。旧 DB の列を足す移行も撤去した
- **merge の写し** (S1-4 までの暫定): 写しは元の batch と**同じ点**を保ち、clock だけを振り直す。
  fileId が違うので rkey は衝突しない

#### 分かったこと

- **v2 の rkey では、ファイル列挙の着地点が削除の tombstone とは限らない。**v1 の rkey は clock 順
  だったので、各ファイルの最大 rkey が tombstone になり、本体を引かずに削除に気づけた。v2 は
  actor → seq 順なので、着地点は「辞書順で最後の actor の最大 seq」になる。**削除の判定の正しさは
  発見側の 2 段目の検査** (引いた op-log に `file.remove` があるか) が既に持っていたので、失うのは
  削除済みファイルの本体を転送せずに済ませる近道だけである
- **tap の復元は最初の書き込みで走る。**App 結合テストで「受信した batch が deps に入る」を確かめる
  筋書きを最初に書いたとき、alice の編集が bob の最初の書き込みより前に届いていたので、復元の経路で
  知識に入り、受信の経路を外す変異が通った。受信の経路を検証するには、復元を済ませてから届ける
- **移行の marker のテストに依存していたものがあった。**名簿の起点の marker の読み書きは
  「移行の marker と同じ形なので、そちらのテストが固定している」とされていた。移行を消すと
  どこにも固定されなくなるので、`bootstrapParticipation.test.ts` に移した

#### 検証

単体 1880 件・App 結合 6 件・E2E 24 件が緑。App 結合の 2 本 (受信した点が deps に入る /
trunk と branch が連番を共有する) は、それぞれ対応する配線を外す変異で落ちることを確かめた。

### S1-4 merge の写し (2026-10-01)

写しを **merge した人自身の batch** にした。新しい id と merge した人の点 (clock・seq・deps) を持ち、
`copyOf: { actor, seq }` で元の batch の点を指す。

- **べき等**は `copyOf` の集合で得る (trunk にある写しの `copyOf` = 写し済みの元)。写しの写しは
  いちばん元の点を指すので、何段写しても判定がずれない
- **並行 merge の重複**は畳み込み (`orderBatches`) が除く。同じ元を指す写しのうち全順序で最初の 1 つ
  だけを残す。step2 ではこれを保存側 (`EventStore` の `compareCopies`) が同じ id の写しの位置を
  置き換えることで行っていたが、写しの id が分かれたので畳み込みへ移り、**保存は追記のみに戻った**
- `restampedBy` / `stackedBy` / `compareCopies` を撤去した。写しの actor が merge した人なので、
  参加期間の判定・送信の著者判定は actor を見るだけで済む
- merge の依存を `seedClock` / `tick` から発番器 (`causal`) に替え、tap の `clockControl`・
  `TapClock`・`CausalClock.tickClock` を撤去した (merge の振り直し専用の口だった)
- 写しの clock は trunk と branch の両方の先端より後になる。発番器に branch を観測させるので、
  Lamport の受信規則どおり branch の元より後に振られる (以前は trunk 先端の次だった)

#### 分かったこと

- **写しの重複除去は、同じ編集を 2 回当てるだけでは結果が変わらない。**App 結合の並行 merge の
  テストは、除去を外しても通った。除去が効くのは「2 つの写しの間に別の編集が挟まり、後ろの写しが
  それを巻き戻す」場面で、これを畳み込みの例として固定した (外すと落ちることを確認)
- **branch の一覧は非同期に読み直される。**App 結合の driver の `openBranch` は行の出現を待つようにした
  (開き直した直後は一覧がまだ無い)。merge 後は表示が「b1 (merged)」になるので、照合もそれに合わせた

#### 検証

単体 1881 件・App 結合 7 件・E2E が緑。畳み込みの重複除去は、外すと例 2 本と性質 1 本が落ちる。

### S1-5 分岐点を vector で切る (2026-10-01)

branch / fork の base コミットに `baseVector` を持たせ (`makeBaseCommit`)、base の切り出し (`batchesUpTo`) と
merge の対立検出 (「分岐後の trunk 側の変更」) を vector で行うようにした (`isUpTo`)。vector を持たない
コミット (branch の途中のコミット) は、これまでどおり clock で切る。`at` は branch の発番の下限と表示に残る。

#### 分かったこと

- **分岐点の vector は「歯抜けなく持っていた範囲」ではなく「持っていた最大の seq」にした。**最初は
  歯抜けで止まる `contiguousFrontier` で切っていたが、既存テストの fixture (seq が飛んでいる) で 15 件
  落ちた。原因を追うと、**歯抜けは恒久的に生じうる**ことに行き当たった — 参加期間のフィルタは離脱中の
  batch を取り込まないので、いったん離脱して戻った人の batch は手元で永久に歯抜けになる。歯抜けで
  止めると、その人のその後の編集がどの分岐点にも入らなくなる。
  最大の seq で切った場合に残る穴は「同じ actor の歯抜けが分岐後に埋まる」ときだけで、同じ actor の
  batch は順に送られ順に読まれるので起きにくい
- この判断は S1-2 の「到達点 (`contiguousFrontier`) は歯抜けで止まる」と対になる。**到達点は
  「何を判断できるか」**(歯抜けの先は判断しない)、**分岐点の vector は「何が見えていたか」**(持っていた
  ものはすべて) で、問いが違う

#### 検証

単体 1888 件・App 結合 7 件・E2E が緑。merge の対立検出を scalar で切る変異で、
「分岐後に届いた clock の小さい変更」のテストが落ちる。

### S1-6 競合と上書きを「並行か」で判定する (2026-10-01)

T5 (`detectIncomingConflicts`) は手元の全部を ours にして `mergeBranches` を当て、出てきた組
(手元の batch, 新着の batch) のうち**並行なもの**だけを残す。T8 (`detectOverwrites`) は
**手元の側が新着の因果の過去にある**組だけを報告する。どちらも組の関係 `relationOfPair`
(`concurrent` / `seen` / `other`) で振り分けるので、境界は新着の集合に依らない。

#### 分かったこと

- **当事者は両方とも検出するようになった。**step2 は clock の小さい側が並行を取り逃し、相手の
  fork の到着 (T7-5) が唯一の知らせだった。いまは両方が同じ `conflictKey` の fork を書き、
  畳み込みが 1 つに畳む。**fork の到着が意味を持つのは、自分では検出しなかった第三者**
  (対立の片側がまだ届いていない、または両側が同じ受信で新着になった) に変わった。
  T7-5 のテストを当事者 (到着に数えない) と第三者 (到着する) の 2 本に分けた
- **3 つ目の関係がある。**因果の知識は batch より先に届きうる (carol 経由で bob の点を知った上で
  書いた後に、bob の batch そのものが届く)。新着の方が前なので、競合でも上書きでもない (`other`)
- **最初に書いた性質は間違っていた。**「互いの最後の編集を見ていなければ、両方の手元で同じ組が
  競合になる」には反例が出た — bob の最後の編集が bob の手元で既に alice の別の編集に上書き
  されていると (その対立は前の受け取りで検出済み)、alice の新しい編集は bob の**いまの値**から
  見て順次編集になる。**対称なのは組の振り分けであって、誰の手元でどの組が比べられるかではない。**
  性質は「排他 (同じ組は常に同じ側)」と「完全 (いまの値と並行な新着は必ず競合)」に直した
- 第三者の検出は届き方で決まる。ours は手元の全部なので、前に受け取った Alice の編集と
  いま届いた Bob の編集の対立は Carol も検出する。step2 の「相手同士の競合は見ない」は
  「両側が同じ受信で新着なら見ない」が正確だった。fork は誰が書いても畳まれるので、ours を
  自分の batch に絞ることはしなかった

#### 検証

単体 1892 件・App 結合 7 件・E2E が緑。T5 を step2 の境界 (新着の最小 clock) に戻す変異で、
性質 1 件と例 3 件が落ちる。

### S1-7 参加期間を因果で判定する (2026-10-01)

名簿の出来事 (`ParticipationEvent`) に判断 batch の因果の点 (`point`) を持たせ、期間
(`ParticipationPeriod`) は開いた判断と閉じた判断の点 (`opened` / `closed`) を持つ。
同期のフィルタは `wasParticipatingIn(participation, did, batch)` — 開いた判断が batch の
因果の過去にあり、閉じているなら batch が閉じた判断の因果の過去にある — で判定する。
clock の区間 (`wasParticipatingAt`) は撤去した。期間の `from` / `to` は再参加の義務の鍵
(`rejoinObligation`) と表示のために残る。名簿の畳み込み (pre 条件) は全順序のまま変えていない。

#### 分かったこと

- **genesis の判断が seq 0 であることがそのまま効く。**seq 0 の点はどの vector にも覆われる
  ので、作成者の期間は File の始まりから開く (`JUDGMENT_GENESIS_CLOCK = 0` と同じ意図が、
  因果の側でも成り立つ)
- **同じ人の別端末は、承認を受け取ってから書いたものだけが入る。**clock の区間では、承認より
  clock の大きい別端末の編集はすべて通っていた。因果で見ると「承認を知らずに書いた」は外になる
- **型を迂回した fixture が 3 箇所あった。**`{ kind: 'accept', clock: 0, ... }` を型注釈なしで
  名簿に入れていたので、`point` を必須にしても型検査が通り、実行時に `happenedBefore` で落ちた。
  「最初から参加している」は seq 0 の点で表し、型を付けた
- 受信の経路のテスト (`receiveParticipantBatches.test.ts`) は、出来事の点を対象者自身の点
  (actor = DID, seq = clock) にして clock の区間と同じ結果に保った。意味論は
  `participationFilter.test.ts` に集めた

#### 検証

単体 1897 件・App 結合 7 件・E2E が緑。clock の区間に戻す変異で、フィルタの 🔴 2 件と
「別端末で承認を受け取る前に書いた」が落ちる。
