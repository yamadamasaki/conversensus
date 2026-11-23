# template の仕様の補強と動的適用 (計画の草案)

> 設計: [template-update.md](../architecture/step4/template-update.md)。
> レビューと応答: [review-1](../architecture/step4/template-update-review-1.md) → [response-1](../architecture/step4/template-update-response-1.md) → [review-2](../architecture/step4/template-update-review-2.md) → [response-2](../architecture/step4/template-update-response-2.md)。
> 前提の仕様: [template-graph.md](../architecture/step3/template-graph.md)、[propertyEditor.md](../requirements/spec/propertyEditor.md)。
> 関連 issue: #406・#411・#412 (ラベル `TemplateUpdate`)。
> branch: `step/template-update` (予定)。
> 状態: **計画確定** (2026-11-23)。§5 の問い Q1〜Q6 は、利用者がすべて案 A を選んだ。

## 1. 目的

利用者の言葉 (template-update.md):

> あくまで, 必要なグラフを描きながら, そのグラフのパタンを並行して (グラフ) 言語化する発達過程を自然に実現する仕組みを入れたい (bottom-up の, 親和的な domain (あるいは problem) -specific ontology).

この計画では 2 つを行う。

1. **静的な仕様の補強**: template が何を定義するかを明確にする (見た目・型・editable・label の一意性・既定値と content の扱い)
2. **動的適用**: template を書き換えながら、適用先の sheet をその新しい版へ追随させる (pull)

## 2. 決定済みのこと (レビューの往復から)

| # | 決定 | 出所 |
| --- | --- | --- |
| K1 | template graph は branch を切らない。版は `at` (template graph の trunk の切断面)。新しい版があることを通知する | R2 |
| K2 | 再適用は **`at` を進めること**。読むときに導けるものは op を書かない。違反 (接続規則・型) は削除や置換をせず、違反として見せる | R4 |
| K3 | pull は常に sheet の property `app.conversensus.appliedTemplate.<id>` に書く。読むときは property が `sheet.create` の `templateIds` より勝つ | R5 |
| K4 | 後から当てた template は外せる (property を消す)。**作成時に当てた template は外せない** (印は作らない)。ユーザ向けガイドに明記する | R5・response-2 |
| K5 | template graph が削除されたら、適用先は止めた版のまま動く。「この template は削除された」と通知する | R6 |
| K6 | template 中で label が重複した種類は、両方とも無効にし、template graph の画面で警告する | R7 |
| K7 | template の property の名前は、template graph では prefix 無しで書き、適用先では `${templateId}.<名前>` とシステムが導く。表示は prefix を外し、template の名前を添える | R8 |
| K8 | template の property の editable: false は「**値は常に template の既定値**」を意味する。管理レベルは書き込みの入口 (UI・MCP の道具・module の API) で守る | R8 |
| K9 | 型と editable は、種類の node/edge の付随 property (`app.conversensus.propertySchema.<key>` に `{ type, editable }`) で宣言する。型の検証は読み取り側でも行う | R9 |
| K10 | 型の文法は、基本の型 (`string`・`number`・`boolean`・`date`・`datetime`)、配列 `T[]`、リテラルのユニオン (`'高' \| '中' \| '低'`)、optional `T?`。型のユニオン (`string \| number`) は扱わない | R3 |
| K11 | `NodeKind` に nodeType (markdown・image・group) を持たせる。node を作るときは、見た目を選んでから、その見た目の種類を選ぶ | R10、#406・#412 |
| K12 | 既定値は写さず、読むときに補う。**既に写された値はそのまま残す** | R11・response-2 |
| K13 | markdown の種類の content は写さず、適用先の content が空のとき placeholder として薄く見せる | R12、#411 |
| K14 | group による種類の範囲付けはしない。group の中に書くのは緩いガイドライン。ユーザ向けガイドに書く | R13 |
| K15 | 片端が「任意」の edge の種類は自動で付けない。候補として選ばせ、その中に「**ラベルなし**」を含める | R14・response-2 |
| K16 | 既存オントロジとの接地は、ラベルなし node (URI) と慣習の label (`external`・`import` など) の edge で表す (K15 が前提) | R14 |

## 3. 今の形 (事実)

計画のために実装を確かめた結果である。

| # | 事実 | 帰結 |
| --- | --- | --- |
| F1 | 適用先は template を `resolveTemplates` で**表示のたびに** `at` の切断面から読み直す (`template/fromSheet.ts`)。種別は id (`template.<sheetId>.kind`) で持つ | K2 の大半は `at` を進めるだけで効く |
| F2 | 作成時に写しているのは label と既定値 (`kind.defaults`)。写す所は 4 か所: client の `addNode`・`createEdge` (`GraphEditor.tsx`)、headless の `add_node`・`add_edge` (`headless/src/tools.ts`) | K12 はこの 4 か所を止め、読む側に補う関数を入れる |
| F3 | **`sheet.setProperty` は File の側の op** (`OP_CATEGORY` で `'file'`)。branch は sheet のメタ (templateIds・properties) を trunk から写す (`projectAddress`) | `at` は trunk と branch で 1 つしかない。**R6 で心配した「branch ごとに `at` がずれて merge で合わせる」は起きない** (§5 Q1) |
| F4 | 優先規則は今、作成時のもの (`sheet.create`) が勝つ (`appliedTemplateRefs`) | K3 で逆にする |
| F5 | 種類の名前の表示 (`displayKindLabel`) は、保存された label が**種類の今の名前かその訳に等しいとき**だけ、template の名前に置き換える | template 側で名前を変えると、保存された古い label がそのまま出る。動的適用で直す (D4) |
| F6 | 接続の種類は、候補がちょうど 1 つなら自動で付く。client (`onConnect`) と headless (`add_edge`、`tools.ts` 275 行目) の両方 | K15 は両方に入れる |
| F7 | `NodeKind` に nodeType が無い。`addNode` は見た目 (`nodeType`) と種類 (`kind`) を別々に受けるが、種類から見た目を決めていない | #406 の原因 |
| F8 | 依頼 module の template は既定値に `answerTarget` (`.` を含まない名前) を持ち、module は `node.properties.answerTarget` を直に読む (`requestModule.ts`) | K7 の prefix と K12 の「写さない」の両方に当たる (§5 Q3) |
| F9 | `PropertyType` の語彙はある (`events/properties.ts`) が、型を宣言して保存する場所も、検証も無い | K9・K10 で作る |
| F10 | 種類の作成時、content は空 (`addNode` の `content: ''`)。#411 の「template の content が写される」の経路はまだ特定していない | T7 で再現から始める |
| F11 | 通知は、受信のたびに op-log から検出し直す。PDS に置くのは「閉じた」ことだけ (`notices/types.ts`)。`NoticeKey` はどの端末でも同じ値でなければならない | template の新しい版・削除の通知もこの形で作る |

## 4. 段とスライス

### 段 1: 静的な仕様の補強

| スライス | 内容 | 主な場所 |
| --- | --- | --- |
| **T1** 見た目を種類に (K11) | `NodeKindSchema` に `nodeType` を足す (無ければ markdown)。`templateFromSheet` が template graph の node の `nodeType` を読み、`templateGraphOf` (種) が書く。作成のメニューは、見た目を選んでからその見た目の種類を並べる (#412)。group の種類から group node ができる (#406)。image の種類の content は使わない | `template/types.ts`・`fromSheet.ts`・`seed.ts`・`NodeTypeMenu.tsx`・`GraphEditor.tsx`・headless `add_node` |
| **T2** label の重複 (K6) | 重複した label の node を種類にしない (`templateFromSheet`)。重複を求める関数を置き、template graph の画面で警告する | `fromSheet.ts`・template graph の画面 |
| **T3** 片端が任意の edge の種類 (K15) | 候補に「任意」の端を持つ種類が含まれるときは自動で付けず、メニューに「ラベルなし」を出す。headless の `add_edge` も、種類を渡されない限り任意の端の種類を付けない | `graph/templateEdge.ts`・`EdgeKindMenu.tsx`・`GraphEditor.tsx`・headless `tools.ts`・i18n 辞書 |
| **T4** 型の文法と検証 (K10) | 型の文字列のパーサと、型で値を検証する関数。値からの推論はしない | `shared/src/template/propertyType.ts` (新) |
| **T5** 型と editable の宣言 (K9) | 種類の node/edge の `app.conversensus.propertySchema.<key>` を読み、`NodeKind`/`EdgeKind` に `schema` として載せる (既定値・訳と同じく、適用先へは写さない)。template graph の画面の property の欄で、型と editable を書ける | `fromSheet.ts`・`types.ts`・`PropertyEditor.tsx`・`property/propertyRows.ts` |
| **T6** property の名前の prefix (K7) | template graph に prefix 無しで書かれた名前 (`.` を含まない) は、適用先で `${templateId}.<名前>` にする。`.` を含む名前 (system・拡張) はそのまま。表示は prefix を外し、template の名前を添える | `fromSheet.ts`・`propertyRows.ts`・headless `encoding.ts` |
| **T7** 読むときに補う (K8・K12・K13) | 要素の property と template から「実効の property」を求める関数を 1 つ置く。値が無ければ既定値を補う。editable: false なら既定値を採る。型に合わない値には印を付ける。作成時に既定値を写すのをやめる (F2 の 4 か所)。property の欄・headless の `read_file`・依頼 module はこの関数を通して読む。markdown の種類は、content が空のとき template の content を薄く出す | `shared/src/template/effective.ts` (新)・`GraphEditor.tsx`・`tools.ts`・`encoding.ts`・`PropertyEditor.tsx`・`EditableNode.tsx`・`modules/request` |
| **T8** 書き込みの入口で守る (K8) | editable: false の template の property は、UI では編集させず、MCP の道具は断る (`assertWritable` と同じ形) | `PropertyEditor.tsx`・headless `tools.ts` |

順序: T1 → T2 → T3 は独立している。T4 → T5 → T6 → T7 → T8 は順に依存する。

### 段 2: 動的適用

| スライス | 内容 | 主な場所 |
| --- | --- | --- |
| **D1** 優先規則 (K3) | property の `at` が `sheet.create` のものより勝つ | `template/applied.ts` |
| **D2** pull (K1・K3) | sheet の「…」に、当たっている template ごとに「最新の版にする」を出す。新しい版が無いときは出さない。押すと `sheet.setProperty` で `at` を template graph の trunk の先端にする | `Sidebar.tsx` (sheet の「…」)・`useFileSheetOperations.ts` |
| **D3** 通知 (K1・K5) | 「template に新しい版がある」「template が削除された」を通知に出す。`NoticeKey` は (sheet, template graph, 先端の切断面) から決める。閉じたものは、その先端が変わるまで再び出さない | `notices/`・通知の検出 |
| **D4** 名前の変更の反映 (K2) | 種類を持つ要素は、保存された label ではなく template の今の名前を表示する (F5 の条件を外す)。label の手での書き換えが今も可能かどうかを先に確かめる | `template/kindLocale.ts` |
| **D5** 違反を見せる (K2) | pull の後、種類の接続規則を満たさない edge と、型に合わない property を印で示す。削除はしない | `GraphEditor.tsx`・edge の描画・`PropertyEditor.tsx` |
| **D6** 外す (K4) | 後から当てた template を外す入口 (sheet の「…」)。作成時の template には出さない | `Sidebar.tsx`・`applied.ts` |

### 段 3: 文書

| スライス | 内容 |
| --- | --- |
| **G1** ユーザ向けガイド | 作成時の template は外せないこと (K4)、group の書き方はガイドライン (K14)、型と editable の書き方 (K9・K10)、pull と通知 (K1)、接地の慣習 (K16) |
| **G2** 仕様の更新 | `template-graph.md` と `propertyEditor.md` に K6〜K15 を反映する |

## 5. 問い

> **決着** (利用者 2026-11-23): Q1〜Q6 はすべて**案 A** で進める。

### Q1. 同時に pull したときの `at` (R6 の join の扱い)

F3 により、branch ごとに `at` がずれることは起きない。合意した「merge のときに join で解く」は不要になる。

残るのは、2 人がほぼ同時に pull して、それぞれ違う先端を書いた場合だけである。`sheet.setProperty` はキーごとに後勝ちなので、古い方の `at` が勝つことがありうる。

- **案 A (推す)**: 後勝ちのままにする。古い方が勝っても、新しい版の通知がまた出るので、もう一度 pull すれば済む。畳み込みの規則を変えない
- 案 B: このキーだけ join で畳み込む。畳み込みにキーごとの特別な規則が入る

### Q2. 既存の template graph に prefix 無しで書かれた既定値 (K7 と K12 の重なり)

今までに作った sheet の node には、既定値が prefix 無しの名前 (`期限`) で写されている (K12 により残す)。T6・T7 の後は、同じ property が `template.<id>.期限` として補われるので、**property の欄に `期限` が 2 つ並ぶ**。

- **案 A (推す)**: そのまま受け入れる。今のデータは開発中の File が中心で少ない。古い方は custom の property として残り、消したければ利用者が消せる
- 案 B: 写された古い値を、prefix 付きの名前の値として読み替える。読み替えの規則が 1 つ増える

### Q3. 依頼 module の `answerTarget` (F8)

依頼 module の既定値 `answerTarget` は `.` を含まないので、T6 で `template.<id>.answerTarget` になる。module はこれを直に読んでいるので、壊れる。

- **案 A (推す)**: module の名前空間に移す (`addressee` と同じ前置き `REQUEST_PROPERTY_PREFIX` を付ける)。旧名は `canonicalPropertyName` と同じ方法で読み替える。あわせて module は T7 の関数で読む (既定値が写されなくなるため)
- 案 B: 種 (code で書いた template) の既定値は prefix の対象外にする。規則に例外が入る

### Q4. 型と editable を template graph の画面でどう書かせるか (T5)

`app.conversensus.propertySchema.<key>` は system の名前なので、今の property の欄からは書けない。

- **案 A (推す)**: template graph の画面でだけ、property の行に「型」の入力欄と「editable」のチェックを出す。書くと、その行の名前に対する `propertySchema` を書く
- 案 B: template graph の種類の node を選んだときに、別の dialog で property の宣言を編集する

### Q5. headless (agent) に pull をさせるか

- **案 A (推す)**: させない。template の版を進めるのは sheet 全体に効く判断なので、人間が行う。`read_file` には、新しい版があることだけを注釈で出す
- 案 B: pull の道具を足す

### Q6. 違反の見せ方 (D5)

- **案 A (推す)**: 接続規則に反する edge は線を赤い破線にし、hover で理由を出す。型に合わない property は、property の欄のその行に印を付ける。node 自体には印を付けない
- 案 B: node にも印を付ける (どこに問題があるか一目で分かるが、画面が騒がしくなる)

## 6. 完了基準 (案)

1. group・image の種類を template graph に書くと、適用先でその見た目の node ができる。作成のメニューは、見た目を選んでから種類を選ぶ形になっている (#406・#412)
2. template 中で label が重複した種類は、適用先のメニューに出ず、template graph の画面に警告が出る
3. 片端が任意の edge の種類だけが候補のとき、繋いでも自動で label が付かない。メニューに「ラベルなし」が出る (client・headless の両方)
4. template graph で property に型と editable を書ける。適用先で、型に合わない値に印が付き、editable: false の値は既定値のまま変えられない (UI・MCP の両方)
5. 既定値は写されず、property の欄・`read_file` には補った値が出る。既に写された値は残っている
6. markdown の種類の node の content が空のとき、template の content が薄く出る (#411)
7. template graph を書き換えると、適用先の sheet に新しい版の通知が出る。pull すると、種類の追加・削除・名前の変更・接続規則・既定値が反映される。違反は削除されずに印で示される
8. template graph を削除しても、適用先は止めた版のまま動き、削除の通知が出る
9. 後から当てた template を外せる。作成時に当てた template には外す入口が出ない
10. 型の文法と検証、実効の property、優先規則は、単体テスト (全称命題は性質) と `.test.md` を持つ
11. ユーザ向けガイドと仕様 (G1・G2) が更新されている
12. lint・typecheck・test (`bun run test`・E2E) が通る

## 7. 気になること

- **実効の property を誰が使うか**: merger の差分・競合・検索は、生の property (op-log の値) を見たままでよいと考えている。補った既定値はデータではないからである。ただし検索 (#249) で既定値に当たらないのは、利用者から見て不自然かもしれない。T7 で確かめる
- **D4 で label を template から引く**と、op-log だけを読む側 (通知・agent への encoding) は古い label を見る。encoding には種別の注釈が既にあるので、そこに今の名前を出せば足りると考えている
- **T1 で `NodeKind` に nodeType を足す**と、`templateFromSheet` と `templateGraphOf` の往復の性質テストの生成器にも nodeType を足す必要がある
- template-update.md の課題のうち、template 以外のもの (#401〜#405・#407〜#410) はこの計画の外とし、issue ごとに進める

## 8. 進捗

| スライス | 状態 | 備考 |
| --- | --- | --- |
| T1 見た目を種類に | 済 (2026-11-23) | `NodeKind.nodeType`。template graph の node の見た目を読み、種がそれを書く (往復の性質に見た目を足した)。作成メニューは各見た目のすぐ下にその見た目の種類を字下げで並べる (見出し「node の種別」は廃止)。headless の `add_node` も種類の見た目で作り、`read_file` の種別の一覧に見た目を添える。**実機の確認は未** |
| T2 label の重複 | 済 (2026-11-23) | `duplicateKindLabels` (前後の空白を除いて比べる)。重複した node は両方とも種類にせず、そこに繋がる edge も種類にしない (「任意」の端と読むと意図しない種類ができるため)。template graph の画面の上部に警告 (`DuplicateKindsWarning`)。**実機の確認は未** |
| T3 片端が任意の edge の種類 | 済 (2026-11-23) | `autoEdgeKind`・`hasAnyEnd` (shared)。client の接続と headless の `add_edge` が同じ規則を使う。片端が任意の種類が候補にあれば、1 つでもメニューを出す。メニューの最後の項目は「ラベルなしで繋ぐ」に改めた。headless は kind を渡さなければラベルなしで繋ぐ。**実機の確認は未** |
| T4 型の文法と検証 | 済 (2026-11-23) | `shared/src/template/propertyType.ts`。`parsePropertyType` (誤りは位置と理由で返す)・`formatPropertyType`・`checkPropertyValue` (`ok`/`missing`/`mismatch`)。リテラルは単引用符か二重引用符でエスケープ無し。列挙の配列は括弧必須。数字の文字列は number に合わない。画面の変更は無し |
| T5 型と editable の宣言 | 済 (2026-11-23) | `propertySchema.ts` (shared): `app.conversensus.propertySchema.<名前>` に `{ type?, editable }`。`NodeKind`・`EdgeKind` に `schema`。読めない型の文字列も捨てずに持つ。edge の追加候補に宣言だけの property も入る。画面: template graph の要素の property の欄で、行ごとに型の入力欄と「適用先で編集できる」。値と宣言を 1 つの op で書く口 (`setProperties`) を足した。**型に合わせた既定値の入力 (number を数で保存する等) は T7。実機の確認は未** |
| T6 property の名前の prefix | 済 (2026-11-23) | `propertyName.ts` (shared): prefix の無い名前は `${templateId}.<名前>`、`.` を含む名前はそのまま。**`kind` は使えない** (種別 property `${templateId}.kind` と同じ名前になるので配らない — 計画に無かった制約)。種の複製は逆に戻す。表示: property の欄は prefix を外した名前 + template の名前、`read_file` の注釈も同じ。Q3: 依頼の `answerTarget` を `app.conversensus.request.answerTarget` に移し、旧名も読む (`answerTargetOf`)。**edge の追加候補 (datalist) は prefix 付きの名前のまま** — T7 で既定値を補えば候補から足す場面は減る。実機の確認は未 |
| T7 読むときに補う | 済 (2026-11-23) | `effective.ts`: 既定値は読むときに補い、editable: false は template の値、型の判定を添える。**計画からの変更: 写すのをやめたのは template の名前空間の既定値だけ** — 依頼の宛先のような module の既定値は「依頼である」印なので写し続ける (`copiedDefaultsOf`)。property の欄: 補った値を薄く出す・number は数で保存 (`valueFromInput`)・列挙は select・型の印・固定は編集不可。`read_file` は注釈で言う。#411: markdown の種類の本文が空なら template の本文を薄く出す。**依頼 module を実効の property で読む件は、写し続けるので不要になった。実機の確認は未** |
| T8 書き込みの入口で守る | 済 (2026-11-24) | `isFixedTemplateProperty` (shared)。UI は `applyPropertyChanges` (property を書く唯一の口) で固定の property への変更を落とす (欄は T7 で既に編集不可)。MCP の `set_node_property`・`set_edge_property`・`add_node`・`add_edge` は断る。**段 1 (T1〜T8) 完了** |
