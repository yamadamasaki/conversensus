# toUnified.test.ts — GraphEvent エンコーダのテスト仕様

## 何を

`toUnified.ts` の `graphEventToOps` / `graphEventToBatch` を検証する。

## なぜ

現行 client 語彙 `GraphEvent` (19 種) が統一語彙の **部分集合**であることを保証する。特にバッチモデル (deep-interview で確定) の要である「複合イベントの基本 op への分解」が正しいことを固定する。これが崩れると undo/redo と同期の両立が破綻する。

## どのように

- **複合イベントの分解**:
  - `NODES_GROUPED` → group ノードの node.add + layout + 子ごとの setParent/setLayout に分解され、子を先に追加した状態で畳み込むと親子関係が復元されることを確認する。
  - `NODE_REPARENTED` → setParent (structure) + setLayout (layout) の 2 op に分かれることを確認する (親変更と位置変更は別カテゴリ)。
- **19 型の網羅**: 全 19 イベント型の最小インスタンスを用意し、(a) 型集合が 19 であること、(b) 各イベントが 1 つ以上の op に分解されることを確認する。新しいイベント型を追加してエンコーダ対応を忘れると気づける「番人」。
- **メタの写像**: `graphEventToBatch` が event.id → BatchId、userId → actor、指定 clock を Batch に写すことを確認する。
- **file 構造イベント (W3c1)**: シート/ファイル構造イベント (`SHEET_CREATED`/`SHEET_REMOVED`/`SHEET_RENAMED`/`SHEET_DESCRIBED`/`FILE_RENAMED`/`FILE_DESCRIBED`) が対応する file op (`sheet.create`/`sheet.remove`/`sheet.setName`/`sheet.setDescription`/`file.setName`/`file.setDescription`) に変換されることを確認する。description 未指定 (クリア) は description フィールドを持たない op になること、および構造イベントの batch は `sheetId` を持たない (file 構造 batch は sheet scope 無し, §3.1) ことを固定する。
- **ファイル削除 (ANA-127)**: `FILE_DELETED` → `file.remove` を固定する。この op が **target を持たない**ことを明示的に確認するのが要点である — batch は既に fileId 単位に束ねられているので、op 側にも対象を持たせると「どのファイルの削除か」の正典が二重になる。他の file 構造イベントと同じく batch は `sheetId` を持たない。
- **content の sheet-aware 化 (W3c2)**: `graphEventToBatch(event, clock, sheetId?)` の第 3 引数に `sheetId` を渡すと content batch に `sheetId` が載ること、省略すると batch が `sheetId` を持たないことを固定する。content 経路 (GraphEditor) は発生元シートを渡し、structure 経路は渡さないという非対称を write 時点で保証する。

- **layout 値の整数化 (W3d5-7)**: `node.setLayout` の `x`/`y`/`width`/`height` が整数へ丸められることを固定する。**ATProto のデータモデル (DAG-CBOR) には float 型が無く**、小数を含む op を載せた batch は PDS の `putRecord` が 400 (`Expected one of null, boolean, integer, … got 661.99…`) で弾く。React Flow はドラッグ結果をサブピクセルの小数で返すため、丸めが無いと **layout op を含む batch が remote へ一切載らない** — W3d5-7 の実機検証で実際にこれが起きた。丸めは op 生成時 (= ローカル正典に載る値) に掛ける: remote 側だけで丸めると local と remote で値が食い違い `recordToBatch` の往復が非可逆になるため。`width`/`height` は `number | string` の union なので、CSS 値 (`'100%'`) はそのまま通ることも合わせて固定する。

- **プロパティは from → to の差分に割る (#208)**: `NODE_PROPERTIES_CHANGED` / `EDGE_PROPERTIES_CHANGED` は from/to に**置き換え後の全体**を載せる契約のままだが、統一 op は**プロパティ 1 つ**を単位にする (`node.setProperty`)。全体を置換する op だと、別のプロパティを触っただけの二人が競合になり、負けた側のプロパティが消えるためである (`spec/merging.md`「op の粒度」)。

  - 変わったプロパティごとに op が 1 つ出て、**触っていないプロパティは op にならない**ことを確認する。これが「触っていないプロパティが消えない」ことの担保である。
  - 消えたプロパティは **`value` フィールドを持たない** op になることを、キーの有無で確認する。ATProto に載せる以上、削除は `undefined` ではなく「フィールドが無い」で表すしかない。
  - 何も変わっていなければ op を出さない。空 op の batch は remote へ送る前に落とされる (`atproto/remoteFilter.ts`)。

## 既知の制約 (テスト対象外)

- `NODE_STYLE_CHANGED` は width/height 変更の実体を持つため layout に正規化している。

## graphEventToBatch の actor (Phase 4d-2)

シグネチャが `graphEventToBatch(event, { clock, actor, sheetId? })` になった。
以前は `event.userId` を actor にしていたが、actor は同期層 (`EventSyncTap`) が与える
識別子に変わったため、呼び出し側から明示的に渡す (理由は `eventSyncTap.test.md` の
actor 節と `step1-phase4d-receive.md` §3.1)。

- 渡した actor がそのまま batch に載ること (以前の「userId を actor にする」を置き換え)。

### SHEET_CREATED の templateIds (Phase 5 P3)

`GraphEvent` 側にも紐づけを載せる。**`GraphEvent` は永続化されない** (undo/redo 用) ので
移行の問題は無く、ここで見るのは **op へ落ちるときに落ちないこと** だけである。

- **`templateIds` 付きは op に載る**: 画面の選択が op-log に届く唯一の経路である。
- **無ければ op にも載せない**: `undefined` を明示的に書かない (`...(x !== undefined && {})`)。
  載せてしまうと、既存の op-log にある `sheet.create` と JSON の形が変わり、
  マージの値比較 (`JSON.stringify`) で無関係な差が出る。

### node の種別 (Phase 5 P4)

- **`NODE_ADDED` は種別を `node.add` に載せる**: 作成が 1 batch のままであること。
  別 op に割ると undo が 2 段になる (`project.test.md` を見よ)。
- **種別が無ければ `node.add` にも載せない**: 既存の op-log と同じ形を保つ。
- **`NODE_LABEL_CHANGED` → `node.setLabel`**: 後から変える経路。
- **外すのは空文字を載せることである**: op が消えるのではない。op-log は追記なので、
  「外した」を表せるのは値だけである。
