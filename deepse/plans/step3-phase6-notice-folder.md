# step3 Phase 6: 通知とフォルダ — 設計

> ステータス: **Q1〜Q7 確定 (2026-10-03、すべて既定案)、実装中** / 作成日: 2026-10-03
> 親: [step3 実装計画](./step3-implementation.md) の Phase 6 (S6-1, S6-2)。仕様は [notification](../architecture/step3/notification.md) と
> [design-language](../architecture/step3/design-language.md) の Folder の節 (端末間の同時編集の決定 2026-10-02 を含む)。
> 計画の Q4 で「通知の内容は op-log から導出し、PDS に置くのは既読状態とフォルダ」と確定している。

## 0. この Phase で入れるもの

| | 変更 | 計画の番号 |
| --- | --- | --- |
| 1 | **通知の既読状態を PDS に置く**: 閉じた通知は自分の他の端末でも出ない。閉じるまでは再読み込みしても残る | S6-1 |
| 2 | **フォルダ**: File を入れ子の Folder で整理する。actor 固有・端末間共通・オフラインで操作できる | S6-2 |

---

## 1. コードを読んで判明した事実

🔵 = コードで確認 / ⚪ = 推論・仕様の読み・未確認

### F1: 通知はすべて「受信の瞬間」に検出され、React の state にしか無い

🔵 通知は 3 種類で、App の右下の箱に積まれる (`App.tsx` の `conflictNotice` / `overwriteNotice` / `arrivedForks`、すべて `useState`)。

| 種類 | 検出 | 内容の出所 |
| --- | --- | --- |
| 競合 (implicit / explicit merge) | `detectIncomingConflicts` (受信) / merge の結果 | 受信前の手元と新着の差 |
| 上書きの報告 | `detectOverwrites` (受信) | 同上 |
| fork の到着 (相手が保留した競合) | `detectArrivedForks` (受信前後の `foldBranches` の差) | op-log の trunk にある fork |

🔵 「閉じる」は state を空にするだけ。**再読み込み・File の切り替えで、閉じていない通知も消える**。localStorage にも PDS にも何も残らない。
背後のタブのセッションは通知を出さない (Phase 3 の積み残し)。

### F2: 受信時の検出は、すでに「キュー」の働きをしている

🔵 受信は「手元の op-log に無い batch」を新着とし (`receiveParticipantBatches`)、検出は新着についてだけ行う。手元は端末ごとの
ブラウザ内 eventStore である。

⚪ 帰結: オフラインの間 (あるいはログインしていない間) に相手が書いた batch は、**次に開いたときの catch-up で新着になり、
そのとき通知が出る**。notification.md の「ユーザが active でなければキューに置き、ログイン時に知らせる」は、内容に関しては
op-log と受信の検出で**既に満たされている**。足りないのは「閉じた」ことを覚える場所だけである — Q4 の判断と合う。

⚪ 逆に、**自分の端末の数だけ同じ通知が出る** (各端末の catch-up がそれぞれ新着として検出する)。既読を PDS に置けば、
1 台で閉じたものを他の端末で出さずに済む。

### F3: 通知の同一性の鍵は、競合と fork には使えるが、上書きには使えない

🔵 `conflictKeyOf` = 種別・対象・揉めた単位・**対立した 2 つの batchId** (整列済み)。どの端末で検出しても同じ鍵になる。
fork も同じ鍵で同定している。

🔵 `overwriteKeyOf` = 種別・対象・単位で、**batchId を含まない** (溜める時の重複除けのための鍵)。これを既読の鍵にすると、
同じ対象への**将来の**上書きまで既読になってしまう。

⚪ 帰結: 上書きの既読の鍵には、上書きした側と上書きされた側の batchId を足す (`overwriteNoticeKeyOf`)。

### F4: 再読み込み後に通知を作り直せるのは fork だけである

🔵 fork は trunk の op-log に永続し、`foldBranches` で畳めば「まだ merge されていない fork」はいつでも求まる。
競合と上書きは「受信前の手元」を分岐点にした検出なので、**受信が済んだ後には同じものを求め直せない**
(手元と新着の区別が消える)。

⚪ 帰結: 閉じていない競合・上書きの通知を再読み込みの後まで残すには、(a) 検出した通知を端末に控えるか、
(b) 検出を op-log 全体からの導出 (並行な batch の組を全部見る) に変えるか、のどちらかが要る。(b) は step2 以来の
「分岐点は受信側の状態」(第三者の検出は届き方で決まる) を変えることになり、Phase 6 の範囲を超える (Q2)。

### F5: PDS の collection は 2 つで、足すときの型が決まっている

🔵 `app.conversensus.v2.batch` と `app.conversensus.v2.judgment`。lexicon は `lexicons/app/conversensus/v2/*.json`、
NSID と Record 型は `atproto/types.ts`、読み書きは `atproto/collections.ts` の collection ごとのオブジェクト
(汎用の `putRecord` / `listRecordsPage` などはモジュール内に閉じている)。

🔵 判断ログは outbox を通さず `judgmentStore.ts` が直に書く (outbox は batch の語彙で組まれている)。
OAuth の scope は `atproto transition:generic` で collection を限定していない。`fakePds` は collection 名を問わない。

⚪ 帰結: 新しい collection は scope も fakePds も変えずに足せる。ただし**オフラインで操作できる**フォルダは、
判断ログのような「直に書く」では足りない (書けないときの控えと、後で送る仕組みが要る)。

### F6: File 一覧は op-log の初出順の平らな列である

🔵 `Sidebar` は `fileOps.files` を `map` するだけ。`files` は `EventStore.listOplogFiles` (op-log の初出順、削除済みと
シート 0 枚を除く) から来る。作成・import・参加の発見・削除 (tombstone) はすべてこの `files` に届く。

⚪ 帰結: フォルダは `files` を**置き換えず、上に重ねる**。「fileId → どこに置くか」を別に持ち、表示のときに `files` と
突き合わせる。`files` に無い fileId (削除済み・共有が外れた) は表示から黙って外れ、どこにも置かれていない File は
トップ・レベルに出る — 仕様の「作成・招待・import された File はいったんトップ・レベル」と「削除された File は黙って外す」が
**突き合わせだけで**満たされる。

### F7: 仕様の「項目ごとに併合できる形」は、record を項目ごとに分ければ PDS 上でそのまま得られる

⚪ PDS の record は rkey ごとの後勝ちである。Folder 1 つ・File の置き場 1 つをそれぞれ 1 record にすれば、
端末 A が Folder X を作り、端末 B が Folder Y を作っても**両方残る** (1 record に木を持つと片方が消える — 仕様の注意)。
同じ項目を 2 台が同時に変えたときだけ後勝ちになる。

---

## 2. 設計

### 2.1 通知の既読 (S6-1)

**通知の内容は今のまま受信で検出し、PDS には「閉じた」ことだけを置く** (Q4)。

```ts
// app.conversensus.v2.noticeDismissal — 1 件の「閉じた」が 1 record (Q1)
type NoticeDismissal = {
  fileId: FileId;
  key: NoticeKey;          // conflictKeyOf / fork の鍵 / overwriteNoticeKeyOf (F3)
  dismissedAt: string;     // ISO 8601
};
// rkey: `<fileId>~<hash(key)>` — File ごとに範囲で引ける (batch の rkey と同じ流儀)
```

- 通知を出す前に、**その File の既読集合**で落とす。既読集合は File を開くときに読み、閉じるたびに足す
- 既読は**足すだけの集合** (grow-only set) なので、2 台が同時に別の通知を閉じても両方残る
- 閉じていない通知は**端末に控える** (localStorage、File ごと)。再読み込みしても残る (F4 の (a)、Q2)。PDS には置かない
- fork は控えなくても op-log から求め直せるので、「まだ merge されていない fork で、閉じていないもの」を出す
  (今の「到着したもの」より強い。merge 済みの fork は自然に消える)
- File を削除したら、その File の既読 record も消す (片付け。消し損ねても害は無い)
- ログインしていないときは端末の控えだけで動く (PDS に書かない)

### 2.2 フォルダ (S6-2)

```ts
// app.conversensus.v2.folder — Folder 1 つが 1 record。rkey = FolderId
type FolderRecord = {
  name: FolderName;
  parent?: FolderId;       // 無ければトップ・レベル
  createdAt: string;       // 名前の重複を解くときの順序 (§2.3)
};

// app.conversensus.v2.filePlacement — File の置き場 1 つが 1 record。rkey = FileId
type FilePlacementRecord = {
  folder: FolderId;        // トップ・レベルに戻す = record を消す
};
```

- **表示は導出する**: `buildFolderTree(folders, placements, files)` が木を作る純関数。入力のどの組み合わせでも木になる
  (性質で書く)
- 操作: Folder の作成 (トップ・レベルか、ある Folder の下)・改名・削除 (空のときだけ)・File を Folder へ移す / トップへ戻す・
  折り畳み
- **Folder 自体の移動は入れない** (Q3)。入れなければ、2 台の同時移動で親子が輪になる場合を考えずに済む

### 2.3 端末間の同時編集 (仕様の決定を導出の規則にする)

| 起きること | 規則 | どこで解くか |
| --- | --- | --- |
| 同じ階層で名前が重複 | `createdAt` (同じなら id) の後の方を「名前 (2)」に改名する | 導出で見つけ、**改名を書く** (Q4)。どの端末が見つけても同じ名前を書くので、2 台が書いても後勝ちで同じ値になる |
| File の行き先の Folder が無い | トップ・レベルに出す | 導出 (書かない) |
| 親の Folder が無い Folder | トップ・レベルに出す | 導出 (書かない) |
| 削除された File | 表示から外す。その File しか持たない Folder は空とみなす | 導出 (F6) |

### 2.4 オフラインと端末の控え

- Folder と置き場は**端末に写し**を持ち (localStorage、actor ごと)、操作はまず写しに当てる。表示は写しから導出する
- 写しで変えた項目には「未送信」の印を付け、オンラインで PDS に送る (項目ごとの put / delete。後勝ちなので順序は要らない)。
  起動時・`online`・「今すぐ同期」・受信のポーリングで、PDS から読んで未送信でない項目を差し替える
- outbox (batch 用) は使わない。項目ごとの最新値を送るだけなので、キューではなく「未送信の項目の集合」で足りる
- ログインしていないときは写しだけで動く。ログインしたら未送信として送る (Q5)

---

## 3. スライス (案)

| | 内容 | 検証 |
| --- | --- | --- |
| **S6-0** | lexicon 3 つ (`noticeDismissal` / `folder` / `filePlacement`)、`types.ts`、`collections.ts` のオブジェクト | 単体 (fakePds) |
| **S6-1a** | 既読集合: `overwriteNoticeKeyOf` (F3)、閉じたら PDS に足す、出す前に既読で落とす | 単体 + App 結合 (2 端末: 片方で閉じると他方で出ない) |
| **S6-1b** | 閉じていない通知の端末の控え (再読み込みで残る)、未 merge の fork を op-log から出す | App 結合 |
| **S6-2a** | `buildFolderTree` (§2.3 の規則) | 単体 + 性質 |
| **S6-2b** | 写しと未送信の項目、PDS との往復 (オフライン → オンライン) | 単体 + App 結合 (2 端末の同時作成で重複が改名される) |
| **S6-2c** | 左サイドバーの UI (作成・改名・削除・移動・折り畳み) | App 結合 + 実機 |

---

## 4. 着手前に訊くこと (Q)

| | 問い | 既定案 |
| --- | --- | --- |
| **Q1** | 既読の record の形 | **1 件の「閉じた」を 1 record** (grow-only set)。File ごとに 1 record (鍵の配列) にすると、2 台が同時に閉じたとき片方の既読が後勝ちで消える (通知が出直すだけで害は小さいが、F7 と同じ理由で避ける) → **確定: 既定案のとおり (2026-10-03)** |
| **Q2** | 閉じていない競合・上書きを再読み込みの後まで残す方法 (F4) | **端末に控える** (localStorage、PDS には置かない = Q4 の「内容は導出」を守る)。検出を op-log 全体からの導出に変えるのは分岐点の定義を変えるので Phase 6 ではやらない。fork だけは op-log から求め直す → **確定: 既定案のとおり (2026-10-03)** |
| **Q3** | Folder を別の Folder へ移せるようにするか | **入れない**。仕様は File の移動だけを明記している。入れると同時移動で輪ができ、その解き方の規則が要る。要るとなったら別 issue → **確定: 既定案のとおり (2026-10-03)** |
| **Q4** | 名前の重複を「表示だけ変える」か「改名を書く」か | **改名を書く**。仕様は「片方の名前を変える」。規則が決定的なので、2 台が同時に書いても同じ値になる → **確定: 既定案のとおり (2026-10-03)** |
| **Q5** | ログインしていないときのフォルダ | **端末の写しだけで動き、ログインしたら送る** (別の actor でログインしたら? → 写しは actor ごとに分け、未ログインの写しはログインした actor へ引き継ぐ) → **確定: 既定案のとおり (2026-10-03)** |
| **Q6** | 折り畳みの状態の置き場 | **端末ごと (localStorage)**。開閉は見た目の都合で、端末間で揃える意味が薄い → **確定: 既定案のとおり (2026-10-03)** |
| **Q7** | 背後のタブの通知 (Phase 3 の積み残し) | **Phase 6 では扱わない**。S6-1b で控えが File ごとになるので、その File を開いたときに出る。右サイドバーの通知 pane などは FPR 後 → **確定: 既定案のとおり (2026-10-03)** |

## 5. 未決 (U)

- **U1**: 既読 record の数。通知を閉じるたびに 1 件増える。File の削除で片付けるが、長く使う File では溜まる。
  merge 済みの fork や、op-log に居ない batch を指す鍵の record を掃除するかは、量を見てから
- **U2**: ~~lexicon の `$type` と検証~~ → **S6-0 で解消**: 新しい 3 つは mapper で Zod 検証する

## 6. 実施記録

### S6-0: lexicon と PDS の読み書き層 (2026-10-04)

- lexicon 3 つ (`lexicons/app/conversensus/v2/noticeDismissal.json` / `folder.json` / `filePlacement.json`)、
  `NSID` と Record 型 (`atproto/types.ts`)、`collections.ts` の `noticeDismissals` / `folders` / `filePlacements`。
  3 つとも**自分の repo だけ**を読む (他の actor の整理や既読を読む理由が無い)
- 型: `FolderId` (branded UUID) と `FolderName` を `shared/schemas.ts` に、`Folder` / `FilePlacement` を
  `folders/types.ts`、`NoticeKey` / `NoticeDismissal` を `notices/types.ts` に
- **既読の rkey は `<fileId>~<鍵の SHA-256>`** (`noticeDismissalRkey`)。鍵は `\u0000` を含み長さも決まらないので
  hash する。fileId を先頭に置くので batch と同じ prefix 範囲取得 (`listByRkeyPrefix`) で 1 File 分を引ける
- **Folder と置き場の id は rkey にだけ持つ** (`folderMapper`)。後勝ちが rkey の単位なので、同一性の権威を 1 箇所にする
- 3 つとも mapper で Zod 検証する (U2 を解消)。壊れたレコードは `null`
- 全件取得 `listAllRecords` を `rangeFetch.ts` に足した (ページ数の上限・cursor が進まないときの停止付き)

#### 検証

- 単体: rkey の文法・長さ・prefix・単射 (性質)、往復 (性質)、壊れたレコード、`listAllRecords` の 4 件
- 変異: rkey の hash を 2 文字に切ると単射の性質が落ちる
- lint / typecheck / `bun run test` (単体 1934 + App 結合 41) 緑

### S6-1a: 閉じた通知を PDS に書き、出す前に落とす (2026-10-04)

- **既読の鍵** (`notices/noticeKeys.ts`): 競合 = `conflictKeyOf` (= fork の鍵。競合を閉じた人には同じ競合の fork も
  出さない)、fork = `conflictKey`、上書き = `overwriteKeyOf` + 上書きされた / した batchId (F3)
- **既読の集合** (`notices/noticeDismissals.ts`): File ごとに 1 度だけ PDS から読む。閉じた鍵はすぐ手元で既読にし、
  PDS へは未記録のものだけを書く。読めない・書けないときは警告だけで、閉じる操作は手元で完結する。ログインして
  いなければ記憶の中だけで動く。保存先は `atproto/noticeDismissalStore.ts` (judgment と同じく outbox を通さない)
- **`hooks/useNoticeInbox.ts`**: App にあった 3 つの通知の state (競合 / 上書き / 届いた fork) をここへ移し、
  出す前に File の既読を待って落とす。競合の通知は検出のたびに置き換わるので、既読を待つ間に次の検出が来たら
  古い方を捨てる (連番)。通知に File を付けるため、`ConflictNoticeState.fileId` (implicit / explicit merge の両方で
  付ける) と `onOverwrites(fileId, detected)` を足した

#### 分かったこと

- **2 台目は同じ競合を自分でも検出する** (fork の到着だけが知らせになるとは限らない)。自分の repo と相手の repo を
  別々に引くので、自分の編集が先に手元に入り、相手の編集が新着として 2 側構造で検出される。どちらの経路でも
  鍵は同じなので、既読で落ちる
- 上書きの報告の既読は配線したが、App 結合では見ていない (鍵の単射は単体の性質で見ている)

#### 検証

- 単体: 鍵 (上書きの鍵の単射を性質で)、既読の集合 (読み込み 1 回・未記録だけ書く・別の端末が読む・未ログイン・
  読めない / 書けない、2 台が別々に閉じても和集合になる性質)
- App 結合: bob の 2 台目に、1 台目で閉じた競合の通知が出ない
- 変異: 既読で落とす filter を外すと App 結合が落ちる (このとき `toBeNull` に要素を渡すと bun が DOM 全体を
  整形して止まらなくなったので、`textContent` で比べる形にした)
- lint / typecheck / `bun run test` (単体 1944 + App 結合 42) 緑

### S6-1b: 閉じていない通知の端末の控えと、未決着の fork (2026-10-04, Q2)

- **控え** (`notices/noticeCache.ts`): 競合の通知と上書きの報告を localStorage に **DID ごと**に控える
  (`conversensus.notices.<did|local>`)。空になったら消す。壊れていたら読まない
- **未決着の fork** (`openForksOf`, `sync/forkArrival.ts`): merge / close されていない fork を op-log から求める。
  App は File を開くたびにこれを `handleForksArrived` に渡す。既読のものと、**競合の通知に出ている競合と同じ鍵**の
  fork は落とす (自分が検出して書いた fork を再読み込みの後に求め直すと、競合の通知と重なるため)
- `useNoticeInbox` は actor が替わったら控えを読み、**今の通知に足す** (置き換えない)。そのうえで、控えから
  戻したもの・復元の前に検出したもの・届いた fork を、その actor の既読で落とし直す

#### 分かったこと

- **受信はセッションの復元より先に走りうる** (did が React の state に載る前)。最初は actor が替わったときに控えで
  **置き換えて**いたので、復元の直前に検出した競合の通知が消えた (S5-3 の App 結合が落ちて判明)。足す形にした
- 同じ理由で、復元の前に作られた受け取り口は保存先の無い既読を握っている。受け取り口は ref でいまの既読を引く
- 閉じた直後に再読み込みすると、PDS への既読の書き込みが間に合わずに失われうる (他の端末で出直すだけ)

#### 検証

- 単体: 控えの往復・actor ごと・空なら消す・壊れた控え・localStorage 無し / `openForksOf` (決着した fork を除く)
- App 結合 2 件: 再読み込みしても残り fork を重ねず、閉じた後は出ない / 控えが無くても未決着の fork が出る
- 変異: 控えを書かない・fork を重ねる・開いても fork を求めない、の 3 つは落ちる。復元の後に fork を既読で落とし直す
  処理を外す変異は**落ちない** (テストでは復元の前に fork を求める窓に入らない。防御として残した)
- lint / typecheck / `bun run test` (単体 1952 + App 結合 44) 緑
