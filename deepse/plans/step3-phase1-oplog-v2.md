# step3 Phase 1: op-log v2 — 設計

> ステータス: **草案 (レビュー待ち)** / 作成日: 2026-09-30
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
`baseVector` に覆われるもの」。分岐後に届いた、分岐時には見えていなかった batch が
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
| **S1-1** | DtR の撤去 (D6) | App 結合 / 単体 (撤去後も緑) |
| **S1-2** | 点と依存の型、因果の判定、到達点 (D1) — 純粋関数 | **性質**: 因果の判定は半順序、到達点は歯抜けを越えない、全順序と矛盾しない |
| **S1-3** | 発番と保存 (tap・判断ログ・eventStore・PDS の v2 形式、D1 / D9)。移行コードの撤去 | 単体 / App 結合 (2 端末の往復) |
| **S1-4** | merge の写しを merge した人の点にする (D2) | 性質: 並行 merge でも畳み込みが一致する |
| **S1-5** | 分岐点を vector で切る (D3) | 例: 分岐後に届いた古い batch が base に入らない (step3-entry の再現) |
| **S1-6** | T5 / T8 を並行で判定する (D4) | **性質**: 両端末で同じ組が同じ側に振られる |
| **S1-7** | 参加期間を vector で判定する (D5) | 例: step3-entry §2.1 の再現 (clock の大小で結果が逆にならない) |
| **S1-8** | sheet の種別プロパティ・`TemplateRef` (D7) | 単体 |
| **S1-9** | 導出 node (D8) | 性質: 導出 node への op は sheet が在る限り受け付け、無ければ捨てる |

S1-2 から S1-7 は**間違えても静かに違う答えを出す側**なので、性質テストで固める
(step3-entry §2.1 の「スキーマの変更はうるさく失敗するが、畳み込みの規則の変更は静かに
違う答えを出す」)。

## 4. 着手前に訊くこと (Q)

| | 問い | 既定案 |
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
