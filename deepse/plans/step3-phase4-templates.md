# step3 Phase 4: template graph と metagraph — 設計

> ステータス: **Q1〜Q8 確定 (2026-10-03、すべて既定案)、実装中** / 作成日: 2026-10-03
> 親: [step3 実装計画](./step3-implementation.md) の Phase 4 (S4-1 / S4-2)。仕様は
> [template graph](../architecture/step3/template-graph.md) / [metagraph](../architecture/step3/metagraph.md)、
> 基盤の決定は [step3 §3.2 D2・§3.3 D3・§3.4](../architecture/step3.md)。
>
> **op の語彙は足さない** (D3)。特殊なグラフは「種別プロパティが特別な値を持つ sheet」で、
> 必要な基盤 (`sheet.setProperty`・種別・導出 node・`TemplateRef` の切断面) は Phase 1 で入っている。
> Phase 4 は**その上の解釈と画面**である。

## 0. この Phase で入れるもの

| | 変更 | 計画の番号 |
| --- | --- | --- |
| 1 | **template graph**: 種別 `template` の sheet を template として読み、適用先で node・edge の種類を提示する | S4-1 |
| 2 | **Toulmin を template graph で定義し直す**。作り込みの `Template` (コードの表) をやめる (U3) | S4-1 |
| 3 | **metagraph**: File 作成時に "index" を作る。graph node の導出 (S1-7 済) の上に、metagraph 上の操作を `sheet.*` の op に翻訳する | S4-2 |

---

## 1. コードを読んで判明した事実

🔵 = コードで確認 / ⚪ = 推論・仕様の読み・未確認

### F1: 基盤は揃っているが、画面からは 1 つも使われていない

🔵 shared には次がある。

- `sheet.setProperty` と `SHEET_KIND_PROPERTY` (`app.conversensus.sheetKind`)、`sheetKindOf`
- `METAGRAPH_SHEET_KIND`。`projectFile` は種別が metagraph の sheet に、File の sheet の一覧から
  **導出 node** を足す (`derivedNodesOf` → `projectBatches`)。導出 node の id は SheetId から決定的
- `TemplateRef = TemplateId | { sheet, at: VersionVector }` (`sheet.create.templateIds`)

🔵 しかし client には `sheet.setProperty` を出す event が無い (`SHEET_CREATED` / `REMOVED` / `RENAMED` /
`DESCRIBED` だけ)。`templatesOf` は `{ sheet, at }` を**黙って落とす** (「まだ解決しない」と注記)。
metagraph の sheet を作る口も無い。

### F2: template は「コードに書いた表」で、適用先の判定はすべて `Template` を通る

🔵 `Template = { id, name, nodeKinds, edgeKinds }`。`NodeKind = { id, label }`、
`EdgeKind = { id, label, from: NodeKindId[], to: NodeKindId[], properties }`。Toulmin は
`TOULMIN_TEMPLATE` (`jp.co.metabolics.toulmin`) で、`BUILTIN_TEMPLATES` に 1 つだけ載る。

🔵 適用先の振る舞い (種別のメニュー `nodeKindsOf`、接続の可否 `canConnectByTemplate`、edge の種類の
自動決定 `edgeKindFor`、property editor の候補 `addablePropertyNames`) は**すべて `Template[]` を受ける**。
種別は node / edge のプロパティ `<templateId>.kind` に種別 id で書かれる (`kindPropertyOf`)。

⚪ 帰結: **template graph の sheet を `Template` に変換する関数を 1 つ書けば、適用先の振る舞いは
そのまま使える。**新しく要るのは (a) 変換、(b) `TemplateRef` の切断面から template graph の姿を
求める解決、(c) 画面がその結果を `GraphEditor` に渡す経路。

### F3: 仕様の template graph は `Template` より表せることが多い

⚪ 仕様と `Template` の差は 3 つある。

- **label の無い node を端に持つ edge** は「template に無い任意の種類の node」と繋がる種類になる。
  `EdgeKind.from` / `to` は空を許さない (`min(1)`) ので、**「任意」を表す口が無い**
- **property の既定値**。template 側の node / edge の property は、適用先で同じ key の既定値になる。
  `EdgeKind.properties` は名前だけで値を持たず、`NodeKind` は property を持たない
- **適用想定外の要素** (label の無い node 同士、その間の edge) は説明書きで、種類にしない

### F4: 種別プロパティの名前空間は `TemplateId` から導く

🔵 `kindPropertyOf(templateId) = <templateId>.kind`。`TemplateSchema` は id に `.` を要求する
(逆順ドメイン = 拡張のプロパティの名前空間, `spec/propertyEditor.md`)。

⚪ 帰結: template graph は利用者が作るので**提供者のドメインが無い**。名前空間をどこから作るかを
決める必要がある (Q2)。同じ template graph を当てた sheet 同士で同じ名前になり、別の template graph
とは分かれる必要がある → template graph の SheetId から導くのが自然

### F5: 適用の内容は「適用先を作った時点」で決まる

⚪ 仕様:「template graph も更新可能だが, 適用する内容は適用先グラフの生成時に決まってしまう」。
`TemplateRef` の `{ sheet, at }` はまさにこのためにある (D7)。`at` は作成時の手元の知識
(`CausalClock` の vector) で、`projectAddress({ fileId, sheetId: ref.sheet, branchId: null, cut: at })` で
その時点の template graph が求まる (Phase 3 S3-1 の性質で固定済み)。

### F6: metagraph の projection は済んでいるが、仕様と 1 点食い違う

🔵 `derivedNodesOf` は **metagraph 自身を導出 node にしない** (「metagraph はグラフの一覧を見せる view で
あって、一覧の中のグラフではない」)。仕様は「**metagraph 自身も特殊な sheet として metagraph に登場する**」
(Q4)。

🔵 導出 node の content は sheet の名前で、導出 node への `node.setContent` は畳み込みが無視する。
**画面で導出 node の文字を書き換えても、何も起きない** (翻訳が無いため)。

### F7: File の genesis は `LocalStore.createFile` が書く

🔵 `createFile` は sheet を 1 つ ("Sheet 1") 持つ `GraphFile` を作り、`initializeOplog` で op-log にする。
"index" はここで足せる。**既にある File には index が無い** (Q5)。

### F8: 種類の候補が複数のときに選ばせる UI が無い

🔵 `edgeKindFor` は候補がちょうど 1 のときだけ種類を返す (step2 D5:「候補が複数のときに選ばせる UI は
step2 では作らない」)。Toulmin では起きなかったが、利用者が template graph を書けば普通に起きる

---

## 2. 設計

### 2.1 template graph → `Template` (純関数)

```ts
templateFromSheet(sheet: Sheet, templateId: TemplateId): Template
```

- **node の種類** = label のある node。種別 id = その node の NodeId (Q3)、表示名 = label
- **edge の種類** = 少なくとも一方の端に label がある edge。種別 id = EdgeId、表示名 = edge の label、
  `from` / `to` = 端の node の種別 id。**label の無い端は「任意」** (`ANY_NODE_KIND`、F3)
- **適用想定外** = label の無い node 同士の edge と、label の無い node。種類にしない
- **既定値** = 種類になった node / edge の property (`sheet` 側の値)。`NodeKind` / `EdgeKind` に
  `defaults: Record<PropertyName, unknown>` を足し、適用先で要素を作るときに書く
- 種類の名前の重複 (同じ label の node が 2 つ) は**先に作った方** (出現順) を残す (`unionByKindId` と同じ方針)

`Template` 型は「任意の端」と「既定値」を表せるよう広げる。**判定の関数 (`edgeKindCandidates` など) は
`Template` を受けたまま**にし、任意の端の扱いをそこに足す (性質テストで固める)。

### 2.2 `TemplateRef` の解決

```ts
resolveTemplates(refs: TemplateRef[] | undefined, trunk: Batch[], fileId: FileId): Template[]
```

- `{ sheet, at }` → `projectAddress({ fileId, sheetId: sheet, branchId: null, cut: at }, { trunk })` →
  種別が `template` なら `templateFromSheet`。無い・種別が違う → 黙って落とす (いまの `templatesOf` と同じ縮退)
- 作り込みの id (文字列) → Q1 の決定による
- 画面: `GraphEditor` は `templates` を props で受ける (いまは中で `templatesOf(sheet.templateIds)` を引く)。
  App は開いている File の trunk の batch から解決する (`usePaneSheet` と同じく正典の知らせで読み直す)

### 2.3 適用先を作る

- 「シートを追加」で、File の中の template graph を**チェックボックスで複数選べる**ダイアログ (仕様)。
  選んだものごとに `{ sheet: templateSheetId, at: いまの知識の vector }` を `templateIds` に載せる
- template graph そのものを作る口: 「シートを追加 ▾」に「template graph」(種別 `template` の sheet を作る)
- template graph と metagraph には **branch を切らせない** (仕様)。サイドバーの「+ branch」を出さない

### 2.4 Toulmin (U3 → Q1)

**既定案: File に複製する。**「シートを追加 ▾」に「Toulmin model を追加」を置き、作り込みのグラフ定義
(node と edge の表) から種別 `template` の sheet を File に作る。以後はふつうの template graph として扱う。
`TOULMIN_TEMPLATE` と `BUILTIN_TEMPLATES` は撤去し、作り込みの id の `TemplateRef` は解決しない (縮退)。

- 理由: 道が 1 本になる (すべての template が File の中の template graph)。利用者が Toulmin の定義を
  見て直せる。仕様の「template graph は適用先と同じ file に置く」と合う
- 失うもの: 既に Toulmin を当てた sheet (開発用データ) の種別が引けなくなる。互換は取らない (architecture §1.1)

### 2.5 metagraph

- **File 作成時に "index"** (種別 metagraph) を "Sheet 1" と一緒に作る (`LocalStore.createFile`)
- **metagraph 上の操作を翻訳する** (純関数 `translateMetagraphEvent`)。`GraphEditor` が dispatch した
  event のうち、**導出 node に向いたもの**を `sheet.*` の event に置き換える
  - graph node の追加 (種類のメニューの「グラフ」) → `SHEET_CREATED`
  - 導出 node の削除 → `SHEET_REMOVED` (確認を挟む: シートの中身ごと消える)
  - 導出 node の content の変更 → `SHEET_RENAMED` (逆はもう成り立っている: 名前の正は sheet 側)
  - 導出 node の移動・導出 node を端にする edge → そのまま (S1-7 の畳み込みが受ける)
- **置き場所の無い導出 node は機械的に並べる** (仕様:「配置はシステムに任せる」)。layout を持たない導出 node は、
  sheet の並びの順に格子に置く (view の側。op は積まない)
- graph node のダブルクリック → その sheet を開く (Q6)
- 複数の metagraph を許す (仕様)。「シートを追加 ▾」に「metagraph」

---

## 3. スライス (案)

| | 内容 | 検証 |
| --- | --- | --- |
| **S4-0** | 画面からシートのプロパティを書く event (`SHEET_PROPERTY_CHANGED` → `sheet.setProperty`)。種別を持つ sheet を作る口 | 単体 |
| **S4-1a** | `Template` を広げる (任意の端・既定値) と `templateFromSheet`・`resolveTemplates` (純関数) | 単体 + 性質 |
| **S4-1b** | 画面: template graph を作る・「シートを追加」で選んで当てる・`GraphEditor` に解決した template を渡す・既定値を書く・候補が複数の edge の種類を選ばせる | App 結合 |
| **S4-1c** | Toulmin を template graph の定義に (Q1)。`TOULMIN_TEMPLATE` / `BUILTIN_TEMPLATES` の撤去 | 単体 + App 結合 |
| **S4-2a** | "index" を File 作成時に作る。metagraph の翻訳 (`translateMetagraphEvent`)・導出 node の機械的な配置 | 単体 + 性質 |
| **S4-2b** | 画面: metagraph で graph node を足す・消す・名前を変える・開く。branch を切らせない | App 結合 + 実機 |

---

## 4. 着手前に訊くこと (Q)

| | 問い | 既定案 → 確定 |
| --- | --- | --- |
| **Q1** | Toulmin (U3): 作り込みの template graph として残すか、File に複製するか | **File に複製する** (§2.4)。道が 1 本になり、利用者が定義を見て直せる。既に Toulmin を当てた開発用の sheet は種別が引けなくなる (互換は取らない) → **確定: 既定案のとおり (2026-10-03)** |
| **Q2** | template graph の種別プロパティの名前空間 (F4)。利用者の template graph には提供者のドメインが無い | **`template.<template graph の SheetId>`** (`.kind` を付けて `template.<id>.kind`)。`.` を含むので拡張のプロパティとして扱われ、template graph ごとに分かれる。表示は template graph の名前で出す → **確定: 既定案のとおり (2026-10-03)** |
| **Q3** | 種類の同一性: template graph の node の **NodeId** か **label** か | **NodeId**。label は表示名 (`NodeKind.label`)。いまの `Template` と同じく「op の値は label、内部の参照は id」。適用の内容は作成時の切断面で固定されるので、後で label を直しても既存の適用先は変わらない → **確定: 既定案のとおり (2026-10-03)** |
| **Q4** | metagraph 自身を metagraph の graph node に出すか (F6: 仕様は出す、Phase 1 の実装は出さない) | **仕様どおり出す**。複数の metagraph が互いを指せる (視点の関係を書ける)。自分自身も node になるが、それを消すと metagraph ごと消えることは確認を挟む → **確定: 既定案のとおり (2026-10-03)** |
| **Q5** | 既にある File に "index" が無い | **作らない** (互換は取らない)。代わりに「シートを追加 ▾」の「metagraph」で誰でも足せる → **確定: 既定案のとおり (2026-10-03)** |
| **Q6** | graph node のダブルクリックで、その sheet を開くか | **開く (新しいタブ)**。content (= sheet の中身) を見る口になる。文字の編集はダブルクリックではなく選択して名前を変える操作に寄せる → **確定: 既定案のとおり (2026-10-03)** |
| **Q7** | 「シートを追加」で template graph を選ぶ UI | **チェックボックスのダイアログ** (仕様。複数を当てられる)。template graph が 1 つも無い File では今の 1 クリックのまま → **確定: 既定案のとおり (2026-10-03)** |
| **Q8** | edge の種類の候補が複数のとき (F8) | **繋いだ直後に選ばせるメニュー** (種類ごとに template の名前で区分)。選ばずに閉じたら種類無しの edge のまま → **確定: 既定案のとおり (2026-10-03)** |

## 5. 未決 (U)

- **U1**: template graph の property の「型」(仕様: 型と値を指定する)。いまの property editor の型推定
  (`propertyRows`) で足りるか、template 側で型を宣言させるか
- **U2**: template graph から自分自身への適用 (metagraph template の課題、仕様の末尾)。Phase 4 では扱わない
- **U3**: template graph を編集した後、既存の適用先を新しい切断面へ上げる操作 (仕様は「生成時に決まる」
  とだけ言う)。Phase 4 では作らない

---

## 6. 実施記録

### S4-0: シートのプロパティを書く event (2026-10-03)

- `SHEET_CREATED` に `properties` を足し、作成と**同じ batch** に `sheet.setProperty` を続けて出す。
  `templateIds` は `TemplateRef[]` (template graph の切断面も載る) に広げた
- `SHEET_PROPERTY_CHANGED` → `sheet.setProperty` (値の省略は削除)。undo の対象外 (他の構造の event と同じ)
- App のシート追加は `addSheet({ name, templateIds, properties })` に広げた (画面の口は S4-1b / S4-2b)

単体 1865 件・App 結合 27 件が緑。

### S4-1a: template の型を広げる・template graph の読み替え・`TemplateRef` の解決 (2026-10-03)

- `Template` を広げた: edge の端の「任意」(`ANY_NODE_KIND`)、node / edge の種類の既定値 (`defaults`)、
  edge の種類の label の空 (label の無い edge は「この組は繋いでよい」だけを表す)
- `edgeKindCandidates`: 種別を持たない端は「任意」に当たる。両端とも持たなければ候補は無い。
  **`isTemplateEdge` (繋げない組の判定) は変えていない** — 任意の端の edge は種類を自動で決めるだけで、
  普通の接続を塞がない
- `TEMPLATE_SHEET_KIND` (`app.conversensus.template`)、`templateIdOf` (`template.<SheetId>`, Q2)、
  `templateFromSheet`、`resolveTemplates` (切断面で読む。作り込みの id は S4-1c まで作り込みから引く)

単体 1875 件 (読み替えの性質 4・例 3、解決 3) が緑。任意の端を無視する・説明書きの edge も種類にする・
切断面を無視する、の各変異で落ちる。

### S4-1b: 画面で template graph を作り、当てる (2026-10-03)

- 「シートを追加 ▾」に「+ template graph」(種別 template のシートを作る)。template graph と metagraph の
  シートには印 (◇ / ⌘) を付け、「+ branch」を出さない
- File に template graph があれば、「+ シートを追加」でチェックボックスのダイアログ (`TemplateApplyDialog`, Q7)。
  当てる切断面は**手元の trunk の op-log の vector** (`heldMaxima`)。直前の template graph の編集が漏れない
  よう、trunk の書き込みが落ち切るのを待ってから読む (`trunkSettled` を `useFileSheetOperations` から出した)
- `GraphEditor` は当てた template を props (`templates`) で受ける。解決は App の `useResolvedTemplates`
  (切断面の中身は後から変わらないので 1 度だけ読む)
- 作るときに種類の既定値を書く (node・edge)。種別より前に置く (既定値に種別の名前が紛れても種別が勝つ)
- edge の種類の候補が複数なら、**選ぶまで edge を作らない**で、繋いだ所にメニューを出す (`EdgeKindMenu`, Q8)。
  作ってから種類を書き足すと op が 2 つに割れ、undo も 2 回要る。閉じたら種類無しで繋ぐ
- 繋ぎ替えの判定 (`canReconnectByTemplate`) を「いまの種類が候補に入っていれば可」に直した (候補が複数の組で、
  種類が変わらない繋ぎ替えを塞いでいた)

#### 分かったこと

- 選んだ edge を状態の更新関数の中で作ると、StrictMode が更新関数を 2 度呼んで edge が 2 本できる。
  選んだ時点の値から直接作る

#### 検証

単体 1880 件・App 結合 28 件 (template graph 1 件を追加)・E2E 44 件が緑。解決した template を
渡さない・既定値を書かない・繋ぎ替えを旧規則に戻す、の各変異で落ちる。接続から種類のメニューが出ることは
happy-dom では扱えないので、メニューの約束を部品のテストで固め、接続からは実機で見る

### S4-1c: Toulmin を template graph にする (2026-10-03, Q1)

- **作り込みの解決を撤去した**: `BUILTIN_TEMPLATES` / `templatesOf` を消し、`resolveTemplates` は作り込みの id を
  解決しない (ただのシートに縮退)。当てたシートが参照するのは File の中の template graph とその切断面だけ
- Toulmin の表 (`TOULMIN_TEMPLATE`) は **template graph の種** (`SEED_TEMPLATES`) として残した。「▾ → + Toulmin
  model を追加」で `templateGraphOf` が表を template graph の中身にし、File に複製する (以後はふつうの
  template graph)。表を残したのは、単体テストの多くが「既知の template」として使っているためでもある
- `templateGraphOf` は `templateFromSheet` の逆向きで、**往復で同じ種類に戻る**ことを性質で固めた
- App のシート追加は中身 (`content`: node・edge・置き場所) ごと作れるようにした。中身は content の op として
  そのシートに積む (canvas で置いたのと同じ形)

#### 検証

単体 1880 件 (往復の性質を含む)・App 結合 29 件 (Toulmin の複製 1 件を追加)・E2E 44 件が緑。種の中身を積まない変異で落ちる。

### S4-2a: metagraph の土台 (2026-10-03)

- **起点の op-log がシートのプロパティと `templateIds` を落としていた** (`graphFileToBatches`)。File 作成時の
  index の種別が載らないうえ、取り込み (import) で template と種別が失われていた。作成の batch に載せるよう直した
- File 作成時に "Sheet 1" の後ろへ "index" (種別 metagraph) を作る (`LocalStore.createFile`)
- **metagraph 自身も graph node に出す** (Q4)。Phase 1 の除外をやめた
- 画面の側の純関数: `refreshDerivedNodes` (いまの sheet の一覧で graph node を導き直す。畳み込みと一致することを
  性質で固めた)・`placeDerivedNodes` (置き場所の無い graph node を格子に)・`splitMetagraphEvent` (graph node への
  削除・本文の変更をシートの削除・名前の変更に分ける。undo の積み上げに入れない)
- 新しいシートの既定の名前は「ふつうのシートの何枚目か」で付ける (index を数えない)

#### 分かったこと

- 既存の歴史の生成器では、「一覧から外した sheet の導出 node に繋がった生きている edge」を 100 回に 1 回しか
  引かず、edge を外さない変異が通った。前置き (全部の sheet を作り全部の組に edge を張る) を足した
