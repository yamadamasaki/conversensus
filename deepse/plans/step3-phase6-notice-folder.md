# step3 Phase 6: 通知とフォルダ — 設計

> ステータス: **ドラフト (Q 未確定)** / 作成日: 2026-10-03
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
| **Q1** | 既読の record の形 | **1 件の「閉じた」を 1 record** (grow-only set)。File ごとに 1 record (鍵の配列) にすると、2 台が同時に閉じたとき片方の既読が後勝ちで消える (通知が出直すだけで害は小さいが、F7 と同じ理由で避ける) |
| **Q2** | 閉じていない競合・上書きを再読み込みの後まで残す方法 (F4) | **端末に控える** (localStorage、PDS には置かない = Q4 の「内容は導出」を守る)。検出を op-log 全体からの導出に変えるのは分岐点の定義を変えるので Phase 6 ではやらない。fork だけは op-log から求め直す |
| **Q3** | Folder を別の Folder へ移せるようにするか | **入れない**。仕様は File の移動だけを明記している。入れると同時移動で輪ができ、その解き方の規則が要る。要るとなったら別 issue |
| **Q4** | 名前の重複を「表示だけ変える」か「改名を書く」か | **改名を書く**。仕様は「片方の名前を変える」。規則が決定的なので、2 台が同時に書いても同じ値になる |
| **Q5** | ログインしていないときのフォルダ | **端末の写しだけで動き、ログインしたら送る** (別の actor でログインしたら? → 写しは actor ごとに分け、未ログインの写しはログインした actor へ引き継ぐ) |
| **Q6** | 折り畳みの状態の置き場 | **端末ごと (localStorage)**。開閉は見た目の都合で、端末間で揃える意味が薄い |
| **Q7** | 背後のタブの通知 (Phase 3 の積み残し) | **Phase 6 では扱わない**。S6-1b で控えが File ごとになるので、その File を開いたときに出る。右サイドバーの通知 pane などは FPR 後 |

## 5. 未決 (U)

- **U1**: 既読 record の数。通知を閉じるたびに 1 件増える。File の削除で片付けるが、長く使う File では溜まる。
  merge 済みの fork や、op-log に居ない batch を指す鍵の record を掃除するかは、量を見てから
- **U2**: lexicon の `$type` と検証。今は judgment だけ Zod で検証している。新しい 3 つも mapper で検証する予定

## 6. 実施記録

(未着手)
