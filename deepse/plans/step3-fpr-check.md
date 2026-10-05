# step3: FPR の完了基準の確認

> 作成日: 2026-10-04 / 親: [step3 実装計画](./step3-implementation.md) §0 (FPR の完了基準, Q1 で確定)
> 計画の Phase 0〜6 はすべて merge 済 (PR #235〜#242)。ここでは 5 つの基準を 1 つずつ確かめる。

## 0. 結果の一覧

| | 基準 | 結果 | 確かめた人・方法 |
| --- | --- | --- | --- |
| 1 | Safari を含むブラウザで PWA として開き、インストールでき、オフラインで編集できる | **満たす** (2026-10-05) | 利用者が実機で (macOS Safari・iOS Safari・Chrome、本番) — §1 |
| 2 | 2 アカウントが同じ File を編み、explicit merge の競合を merger で解いて merge できる | **未** (App 結合では通っている) | 利用者が実機で ([手順](../requirements/user-test-environment.md#102-基準-2-2-アカウントで-merger)) |
| 3 | template graph で定義した Toulmin を当てた sheet を作れる | **満たす** | Claude が Chrome で (§3) |
| 4 | metagraph で sheet の関係を描き、そこから sheet を追加・削除・改名できる | **満たす** | Claude が Chrome で (§4) |
| 5 | op-log の形式が確定している (FPR 以降の形式変更には移行を伴う) | **満たす** (§5.3 を案 A に決めて実装した) | Claude が机上で (§5) + 実装 (§5.4) |

---

## 1. 基準 1: PWA (2026-10-05, 利用者が本番で)

本番 (`app.conversensus.site`) を出し、PDS を 0.5 系に上げた後 (同じ site の OAuth のため,
user-test-environment §11.3) に確かめた。

- Safari (macOS・iOS) と Chrome でインストールでき、ログイン後は web app とブラウザの間で双方向に反映される
- Wi-Fi を切って web app を再読み込みしても表示される (service worker と OPFS)
- iOS の WebKit では、node にスクロールバーを出しても文字がぼやけない (macOS の Safari ではぼやける, ANA-104)

### 見つかったこと (FPR の基準ではないが、考える必要がある)

1. **未ログインで描いたものは、ログインしても他へ届かない。**Safari の web app と Safari が保存領域を
   共有しない (§10.1 の注意) のに加え、未ログインの batch は actor が `local#<端末>` で、送信は自分の DID の
   batch だけを送る (`remoteFilter`) ので、ログインした後も PDS に載らない。Folder (S6-2) はログイン前の写しを
   引き継ぐが、File は引き継いでいない
2. **オフラインで描いたものが他に届いていないことに、描いた人が気づきにくい。**オフラインではログインできず、
   その間の編集は PDS に載らない。描いた側の画面には出ているので、届いていないことが分からない。
   未ログインなら左下に「この端末にだけ保存」、ログイン中なら未送信の件数が出るが、目立たない。
   **ログイン済みの端末がオフラインで起動したとき、セッションを復元できずに未ログイン (`local` の actor) として
   書いていないか**は確かめていない — そうなら 1 と同じく、オンラインに戻っても届かない

## 3. 基準 3: Toulmin を当てた sheet (2026-10-04, Chrome・未ログイン)

テスト用の File「FPR確認」を作り、最後に削除した (既存の File には触れていない)。

1. 「シートを追加 ▾」→「+ Toulmin model を追加」で、種から File の template graph「Toulmin model」ができる
   (主張・データ・論拠・反論・裏付けの 5 つの node と、その間の edge)
2. 「+ シートを追加」→ 当てる template graph に「Toulmin model」を選んで「Sheet 2」を作る
3. Sheet 2 の空白をダブルクリックすると、node の種類のメニューに一般の種類 (Markdown・グループ・画像) に続けて
   **Toulmin の 5 種類**が出る。「主張」を選ぶと「主張」の印の付いた node ができる
4. 再読み込みしても残る

気づいたこと (直していない): Toulmin model の template graph で、上の段の edge の label (「支える」「正当化する」)
が node の上辺の外を回り、重なって読みにくい。描き方の問題で、FPR の基準には関わらない。

## 4. 基準 4: metagraph (2026-10-04, 同じ File で)

1. 「index ⌘」を開くと、File の 4 つのシート (Sheet 1・index・Toulmin model・Sheet 2) が graph node として並ぶ
2. **関係を描く**: Sheet 1 から index へ edge を引ける。再読み込みしても残る
3. **追加**: 空白をダブルクリック →「グラフ」で graph node「Sheet 3」ができ、サイドバーのシート一覧にも出る
4. **改名**: graph node を選んで F2 →「論点整理」に変えると、サイドバーの名前も変わる
5. **削除**: graph node を選んで Delete →「シート『論点整理』を削除しますか?」で OK → シートが消える
6. コンソールにエラーは出ない

気づいたこと (直していない):

- graph node を足すと表示が動き、既存の 4 つが画面の下端へ寄る (fit のし直しに見える)
- graph node の本文を F2 で編集すると「ラベル」の口も出る。metagraph の graph node に label を付ける意味は
  仕様に無いので、出さない方が自然かもしれない

## 5. 基準 5: op-log の形式 (2026-10-04, 机上)

### 5.1 形式を変えた変更

step3 で op-log と lexicon の形式に触れた commit は次のとおりで、どれも計画の Phase 1・3・6 の中にある。

| commit | 変更 |
| --- | --- |
| `ea528b3` S1-1 | DtR の撤去 (op の語彙から外した) |
| `1e93cca` S1-3 | 因果の点 (`seq` / `deps`) と v2 の collection・rkey |
| `20b5378` S1-4 | merge の写しを merge した人自身の batch に (`copyOf` / `mergedIn`) |
| `4bfbaae` S1-5 | 分岐点を vector で切る (コミットの `vector`) |
| `3045189` S1-8 | sheet の種別プロパティと `TemplateRef` |
| `494be4b` S3-1 | コミットの vector (アドレスの切断面) |
| `75e79b5` S6-0 | 新しい collection 3 つ (既読・Folder・置き場)。op-log ではない |

### 5.2 計画の未決のうち形式に関わるもの

| 未決 | 状態 |
| --- | --- |
| 計画 U5: 判断ログに vector を載せるか | **実質的に決着している。**判断ログの record は `seq` / `deps` を持ち (lexicon で必須)、参加期間の判定も点で行っている (`participation.ts`。step2 の「actor をまたいだ clock の比較」はもう無い)。計画の表を更新するだけでよい |
| 計画 U3: Toulmin を作り込みにするか File ごとに複製するか | **決着している** (Phase 4 Q1: 種を File に複製する)。計画の表を更新するだけでよい |
| 計画 U1 / Phase 1 U1・U2: deps の大きさ、使われなくなった actor の退役 | **形式に関わりうる。**deps は actor (端末) の数に比例して育つ。退役 (vector から項目を落とす) を後から入れると、落とした項目をどう読むかの規則が要る。ただし形式 (`deps` は actor → seq の写像) は変えずに、畳み込みの側で「無い項目は 0」と読む規則に寄せられる見込み — 量を測ってからでよい |
| Phase 4 U1: template graph の property の「型」 | 型を足すなら template graph の node の property として持てる (op の語彙は変わらない) |
| Phase 4 U3: 適用先の切断面を上げる操作 | 足すなら **新しい op の種類**になる → 下の §5.3 に当たる |

### 5.3 決めることが 1 つ残る: 知らない op の種類をどう扱うか

**事実 (2026-10-04 に確かめた)**: 受信した batch は保存の前に `BatchSchema` で検証する
(`local/storeBackend.ts` の `pushReceivedBatches`)。`OpSchema` は op の種類の判別共用体なので、
**知らない種類の op を 1 つでも含む batch は検証を通らない**。しかも検証は受信した batch の配列全体に
`parse` を掛けるので、**例外が出てその受信がまるごと止まる**。

```
BatchSchema.safeParse({ ..., ops: [{ kind: 'node.futureThing', ... }] })
  → success: false, code: invalid_union_discriminator
```

**帰結**: FPR の後で op の種類を 1 つ足す (Phase 4 U3 のような機能を足す) と、**更新していないクライアントは
その File の受信がすべて止まる**。新しい版の人が 1 回でもその op を書けば、古い版の人には以後の編集が
1 つも届かない。PWA は service worker の更新まで古い版で動き続ける (Phase 2 U2) ので、これは起きる。

基準 5 の「形式が確定している」は「**今後足し方の規則が決まっている**」まで含めないと満たせない。
FPR の前に次のどれかを決める必要がある。

| 案 | 中身 | 得るもの / 失うもの |
| --- | --- | --- |
| **A. 知らない op を持ったまま通す** | 検証を「op は `kind` を持つ object」まで緩め、知らない op は保存して畳み込みで読み飛ばす (graph の projection は既に種類で switch している) | 古い版でも同期は止まらず、更新したら効き始める。知らない op の効果は古い版では見えない (判断ログは別: 語彙に無い判断は今どおり batch ごと落とす方がよい) |
| **B. 形式の版を持たせ、古い版は新しい版を読むのを断る** | batch に版を載せ、自分より新しい版を見たら「更新してください」と出して同期を止める | 規則が単純で、取り違えが起きない。古い版の人は更新するまで共同作業できない |
| **C. 今は決めず、op を足すときに移行する** | FPR 後に op を足すたびに移行を書く | 今の作業は無い。足すたびに全員の更新を揃える必要がある |

推奨は **A** (古い op を読み飛ばすのは CRDT 的な op-log と相性がよく、PWA の更新の遅れを許せる)。
いずれも op の形そのものは変えないので、実装は小さい。**→ 確定: 案 A (2026-10-04、利用者)**

### 5.4 案 A の実装 (2026-10-04)

- `unified.ts`: `isKnownOpKind` / `ReceivedBatchSchema` (知らない op を含んだまま通す。知っている種類が壊れていれば
  弾く) / `StoredBatchSchema` (ops が空でよい) / `knownOpsOf`
- **保存は受信した形のまま、読むときに落とす** (`eventStore` の `rowToBatch`)。受信は手元に無い batch だけを
  引くので、保存の時点で捨てると更新しても二度と戻らない。batch は落とさない (因果の点を歯抜けにしない)
- `storeBackend`: 受信は `ReceivedBatchSchema`、読み出しは `StoredBatchSchema`。自分が書く batch は今までどおり厳しく
- 判断ログは対象外 (語彙に無い判断は batch ごと落とす。判断の畳み込みは種類で pre 条件を分けるので)
- 競合と上書きの検出は知らない op を数えない (種類ごとの分類で自然に外れる)。受信の側で落とす処理は変異で
  冗長と分かったので入れず、検出が知らない op を無視することをテストで固定した
- 検証: 単体 (スキーマ・`knownOpsOf` の性質・保存に残り読みで落ちる・空の batch が残る・検出が数えない)、
  App 結合 1 件 (知らない op を足した record を受信しても止まらず、その後の編集も届く)。変異: 受信を今までの検証に
  戻す・読みで落とさない、のどちらでも落ちる。単体 1990・App 結合 48・E2E 44 緑

**残る注意**: 知らない op の効果は古い版では見えない。足す op は「古い版が無視しても壊れない」形で設計する
(古い版が無視すると整合しない op — 例えば既存の op の意味を変えるもの — は足すのではなく版を上げる話になる)。

## 6. 次にやること

1. 基準 1・2 を利用者が実機で確かめる。手順は
   [user-test-environment.md §10](../requirements/user-test-environment.md#10-fpr-の完了基準を実機で確かめる-step3)
