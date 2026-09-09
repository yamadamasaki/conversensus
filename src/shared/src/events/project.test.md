# project.test.ts — projection のテスト仕様

## 何を

`project.ts` の `projectBatches` (統一イベント → グラフ状態の fold)、`toSheet`、`projectFile` (Batch[] → `GraphFile`, W3 読み取り経路) を検証する。

## なぜ

projection は step1 §4 の「集約は projection (導出ビュー)」を実現する要。エディタ・エクスポート・拡張エンジンがすべてこの導出結果を読むため、畳み込みの意味論 (LWW・カスケード削除・layout の部分更新) を正確に固定する必要がある。`projectFile` は複数シート + ファイルメタを op-log から導出する読み取り経路 (D4) の中核で、content/構造の分離とシート順序の reconcile が正しいことを固定する。

## どのように

- **状態構築**: node.add / edge.add から nodes / edges マップが構築されることを確認する。
- **LWW (投入順非依存)**: 同一ノードへの content 変更を、投入順を入れ替えて渡しても clock 昇順で解決され、clock 最大が勝つことを確認する。決定論的なマージの土台。
- **カスケード削除**: node.remove が接続エッジも削除する (現行 `applyEvent` の NODE_DELETED と同じ挙動) ことを確認する。
- **layout の部分更新**: 移動 (x/y) と リサイズ (width/height) を別々の setLayout で与えても合成されることを確認する。滑らかな移動・リサイズを独立イベントとして扱うため。
- **プロパティのキー単位の畳み込み (#208)**: `node.setProperty` / `edge.setProperty` が触ったプロパティだけを書き換え、他は残すことを確認する。全体を置換していた頃は、別のプロパティを触っただけで他が消えていた (`spec/merging.md`「op の粒度」)。値を省いた op がそのプロパティの削除になることも固定する — 削除の表現はこれ一つしかないので、ここが崩れると「消したのに残る」になる。
- **プロパティ名の正規化 (#137)**: `image` / `imageUrl` のような名前空間化する前のシステム・プロパティが、projection 後のグラフでは新名 (`app.conversensus.*`) になっていることを確認する。op-log は書き換えられないので旧名の op は残り続けるが、**グラフに現れるのは新名だけ**という不変条件がここで決まる。旧名の op が新名で書かれたプロパティを上書きできることも固定する — 移行期は端末ごとに綴りが混じるので、別プロパティと見なすと片方の編集が相手から見えないまま両方が残る。
- **旧形式 (`setProperties`) も読む**: 既存の op-log には置換の op が積まれている。新規には発行しないが、読めなくなると過去のグラフが再現できない。旧形式の置換の後にキー単位の op が重なる順序まで確認する。
- **presentation の分離**: presentation op (edge.setStyle 等) は presentation マップに入り、意味的な状態 (edges の properties 等) に影響しないことを確認する (D7: presentation はローカル限定)。
- **toSheet**: projection が既存の `Sheet` 形式へ変換されることを確認する (現行資産との接続点)。

### add-wins / tombstone (Phase 3 T2)

削除の意味論を変えた。「判断を保留するなら情報を消さない方に倒す」(`spec/merging.md`) —
競合の決着 (DtR) の前に対象が消えると、議論する物が無くなる。

**規則は 3 つである。**

1. **削除は消滅ではなく tombstone。**`node.remove` / `edge.remove` は要素を
   `removed` へ移すだけで、値は残る。`nodes` / `edges` (= `toSheet` が出す既定の表示) からは
   外れるので、**利用者から見た挙動は変わらない**。
2. **後から来た「在る」という主張が tombstone を解く** (add-wins の本体)。
   削除の後の `setContent` は、以前は無言の no-op だった — 消えた上に編集も失われていた。
3. **主張は祖先まで遡って効く。**子だけ戻すと親の居ない孤児になるので、
   グループの削除の後に子を編集すると**親ごと戻る** (仕様の S2')。

| 例 | 何を守るか |
| --- | --- |
| 削除した要素が `removed` に残る | 消滅ではないこと。ghost 表示と競合の通知はここから引く |
| 🔴 削除 → 編集で戻る | **add-wins の中身。**LWW のままなら編集が無言で捨てられる |
| 🔴 グループ削除 → 子を編集すると親ごと戻る | S2'。子だけ戻すと孤児になる |
| 編集 → 削除は消える | **add-wins は「削除を無効にする」ことではない。**誰も触っていない削除はそのまま通る — でなければ何も消せない |
| layout / style は tombstone を解かない | 位置を動かすことは「在るべきだ」という主張ではない。layout の競合は「通知のみで DtR を起動しない」種別でもあり、`merge.ts` の `prerequisitesOf` と同じ線引きである |
| エッジを張り直すと両端のノードも戻る | 端点の無いエッジは在れない |
| カスケードで消えた要素も `removed` に残る | 巻き添えも tombstone。**カスケードは畳み込みの最後に導出する**ので、親が戻れば子孫もまとめて戻る |
| `file.remove` は remove-wins のまま | File の削除には「再作成」に相当する op が無いので add-wins にする意味が無い (ANA-127)。**ここを一緒に倒さない** |

**限界を 1 つ残している。**「削除が後に来た」場合は tombstone のままである
(上表 4 行目)。真の add-wins (CRDT の OR-Set) は「その削除が観測していない追加は生き残る」
だが、判定には**因果**が要る。手元の clock は Lamport のスカラで、`a < b` は
「b が a を見た」を意味しない。**因果を持たない畳み込みに決められるのは全順序の中の
前後だけ**なので、ここが上限である。

実務上はこれで足りる: explicit merge は branch batches を trunk 先端の後へ再スタンプする
(`mergeBranch.ts`) ので、**branch の編集は必ず trunk の削除より後に来る** — 仕様が名指しする
S2 / S2' はこの規則で拾える。順序が逆になる implicit merge でも、要素は `removed` に
残っているので情報は失われない (T4 の通知と fork がそこから引く)。

### projectFile (W3 読み取り経路, §3.3)

- **基本射影**: `file.setName` + `sheet.create` + content batch から `GraphFile` (id・name・シート) が導出されることを確認する。
- **content のグルーピング**: content batch が `sheetId` で正しいシートへ振り分けられることを確認する。1 ユーザー操作 = 1 シート内完結の前提 (§3.1) を固定する。
- **sheet.remove**: 削除されたシートとその content が射影から消えることを確認する (remove-wins + 削除シートの content は射影時に無視, critic H2-new)。
- **順序の reconcile**: 最新 `sheet.reorder` の順に並べ、order に無い live シートを createClock 昇順で末尾に追加することを確認する (レビュー H2, 孤立シートを表示から落とさない防御)。
- **未作成シートの防御**: 存在しないシートを指す content batch は無視されることを確認する (壊れた入力でも落ちない)。
- **メタの LWW**: `sheet.setName` / `file.setDescription` が後勝ちで反映されることを確認する。

### orderBatches の順序規則 (Phase 4d-3, 設計 §3.2b)

tiebreak を **`clock → timestamp → id` から `clock → actor → id` へ変更**した。

**なぜ**: 第 2 キーの `timestamp` は端末のウォールクロックであり、端末間では信頼できない
(ずれ・巻き戻り・タイムゾーン設定ミス)。単一端末では clock が一意なので実質使われない
キーだが、**受信では常時 tiebreak の主役になる**。同一 clock の衝突は偶然ではなく構造的に
起きる — 同一 snapshot から genesis した端末は同じ連番 clock を seed し、同じ値から発番を
始める (設計 §1.1)。`actor` は端末一意の識別子 (4d-2, `did#deviceId`) なので端末間でも安定する。

**退行しないことは構造的に言える**: `LamportClock.tick()` は単調増加なので同一 actor 内で
clock は必ず一意であり、単一 actor では第 2 キーが発動しない。これをテストで機械的に固定する。

- **単一 actor での退行なし**: 同一 actor・一意 clock の batch を timestamp 逆順で与えても、
  clock 昇順で解決されることを確認する。timestamp が順序に影響しないことの直接の証拠。
- **同一 clock・異なる actor**: timestamp を逆にしても actor 昇順で順序が決まること、
  かつ投入順を入れ替えても同じ結果になること (決定論的な全順序) を確認する。
- **clock も actor も同一**: id (UUID) の辞書順で決まることを確認する。最終の tiebreak。

### foldFileStructure の現挙動の固定 (Phase 4d-3, 設計 §3.2 / §1.4)

**4d では `foldFileStructure` を変更しない。** 順序規則の変更が構造の畳み込みへどう波及するかを
固定し、4e で改善するときの回帰検出点にする。ここを 4d で触ると 4d-3 のスコープが破裂する。

`applyFileOp` は `clock` を引数に取りながら `sheet.create` の `createClock` にしか使わず、
`file.setName` / `sheet.setName` / `sheet.reorder` は**比較なしの逐次上書き**である。つまり
「LWW」ではなく「**整列後の最終適用が勝つ**」— `orderBatches` の順序を変えれば挙動が直接変わる。

- **`sheet.setName` の逐次上書き**: 同一 clock で actor の異なる 2 つの setName を与え、
  timestamp ではなく actor 昇順で後になった方が勝つことを確認する。
- **`sheet.reorder` の後勝ち**: 並行する 2 つの reorder をマージせず、順序で後になった方の
  order が丸ごと採用されることを確認する (片方の並べ替えが捨てられる。4e で見直す対象)。

### isFileDeleted (ANA-127)

ファイル削除を op-log の `file.remove` として伝播させるにあたり、**「削除済みか」の判定を
`projectFile` から独立させた**。判定したい側が projection を必要としないためである —
ローカルの一覧 (`listOplogFiles`) は projection と併用するが、受信側の discovery は
「materialize するかどうか」を決めるだけで中身を組み立てる必要が無い。

`GraphFile` に削除フラグを足さなかったのも同じ理由による。削除済みファイルは `GraphFile`
として表に出てはいけないので、フラグ付きの `GraphFile` は「表に出てよい削除済みファイル」
という矛盾した値を作ってしまう。

固定するのは以下である。

- **無ければ false / 空 op-log も false**: 「まだ何も無い」を削除と混同しない。
  空 op-log を削除扱いすると、genesis 到着前のファイルが永久に materialize されなくなる。
- **他の op と同じ batch に混ざっていても検出する**: 1 ユーザー操作 = 1 batch なので通常は
  単独だが、batch 内の位置に依存しないことを明示する。
- **remove-wins (sticky)**: `file.remove` より後の op があっても true のままであることを
  確認する。`sheet.remove` が add-wins (`sheet.create` で復活する) なのと非対称だが、
  ファイルには「再作成」に相当する op が無いので add-wins にする意味が無い。並行編集で
  削除より大きい clock の batch が後から来ても復活しないことがここで担保される。
- **順序非依存**: batch の並びを変えても結果が変わらないことを確認する。これが成り立つので
  `orderBatches` を通していない生の受信列にもそのまま使える (discovery が依存する性質)。
- **`projectFile` は削除済みでも中身を射影する**: 隠すのは呼び出し側の責務であることを
  固定する。ここで射影を止めると、削除したファイルを復元する経路まで塞いでしまう。

### node.setLabel (Phase 5 P1)

node に**種別名** (`label`) を与える op。`edge.setLabel` と同じ概念で、template
(主張 / データ / 論拠 / 反論 / 裏付け) が候補を与える。

**なぜ本文と別のフィールドなのか。** Phase 5 P0 の直前まで、`label` という語は node の
**本文**の意味で使われていた (`NODE_RELABELED` が `node.setContent` に写り、React Flow の
`data.label` にも本文が入っていた)。P0 で語を空けたので、ここで本来の意味の `label` を
入れる。したがってこのテスト群が固定したいのは「新しい機能が動くこと」ではなく、
**2 つのフィールドが互いに干渉しないこと**である。

- **種別名を `label` に書き、`content` は触らない**: 逆も同様。P0 で分けた語が
  実装でも分かれていることの確認で、ここが崩れると P0 の作業が無に帰す。
- **`label` は clock 昇順の LWW**: 投入順を入れ替えても結果が変わらないこと。content と
  同じ規則であることを、content の同名テストと対にして固定する。
- **既存ノードは `label` を持たない**: 仕様が「既存のノードのラベルは空でよい」と言うので、
  `node.add` だけのノードは `undefined` である。既定値 (「主張」など) を勝手に入れない。
- **対象が居なければ no-op**: `applyOp` の `if (node)` に守られていること。ノードを
  作ってしまうと、削除済みノードへの setter がゾンビを生む。
- **削除済みノードへの setLabel は復活させる**: `node.setContent` と同じ add-wins。
  種別付けだけ別扱いにする理由が無く、揃っていないと「本文を直せば戻るが種別を付けても
  戻らない」という説明できない差になる。
- **`toSheet` は `label` を持ち出す**: projection の内部表現で止まらず、外に出る形
  (`GraphNode`) まで届くこと。UI (P4-P6) が読むのはこちら側である。
