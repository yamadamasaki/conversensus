# step3

> ステータス: **草案 (議論中)** / 作成日: 2026-09-30
> 出所: Notion の「step 3」ページとその子ページ (2026-09-30 時点) を移したもの。
> 以後は **この git の版が原本**であり、Notion はロックする。
>
> §1〜§2 は利用者が書いた本文、§3 はそれを読んだ上での議論で決まったことである。

## 1. 位置づけ

step 3 は, step 1 (personal use), step 2 (community use) の基盤の上に,  (あえて言うならば)
the first public release (FPR) してもよいと判断できるグレードまで refinement することが
中心となる. したがって, 開発は plan base ではなく, issue base で行う.

> 注: この方針は §3.1 で「FPR 前はデータモデルの変更を含むので plans、FPR 後は issue」と
> 分け直した。

### 1.1 step 2 で得られた教訓を実現する

- [step3-entry.md](../plans/step3-entry.md)
  - 最後の critic review で指摘された問題点
  - vector clock
  - その他我々自身の観点
- ただし, これは以下に述べる UI/UX refinement を見た上で, その基盤としてどれをどう実装するかを
  一緒に取捨選択したい
  - 逆に基盤側の視点から, この UI/UX refinement の項目の実現は難しいだろう, というのも知りたい
- 実装自体は step 3 の初期にやった方がよいものが多いだろう
- **既存の op-log との互換性は考慮しなくてよい**
  - FPR を控えて, きれいにしておきたいから

## 2. UI/UX refinement

graph merge は人間にとって (も) 本質的に難しい問題である. したがって,

- まずは, それをシステムの側から最大限サポートする (Step 3)
- しかし, 最終的には人間同士の対話が決め手になる (Step 4 以降)
  - リアルタイム同期の提供
    - これを今の段階で実装する価値があるかどうかを議論したい
      - ATProto の範囲で妥当な実装が可能か?
      - conversensus が想定している計算/通信資源を考えると, その方向で解決していいのか?
  - オンライン・チャットなどの利用
    - 本当はアカウントを共用できる ATProto ベースのものが良いが, 今はまだ発展期なので,
      zoom, slack などで代用する

これを最大の問題点と考え, UI/UX refinement として他の点も含めて以下に列挙する.

- i18n
  - で, 英語 (en) も追加する
- user's guide, examples の提供
  - Step 3 完了後にやる
- デザイン言語
  - 基本的には notion, obsidian のような collaborative work や knowledge management 用途に
    広く使われているツールに倣う
  - conversensus の基本的な概念を UI/UX のレベルで明確に言語化する
  - 👉 [design language](./step3/design-language.md)
- 無限キャンバス (端に要素を置いたところまで動的に拡大する)
- timeline view
  - 👉 [timeline view](./step3/timeline-view.md)
- ボディ + 右サイドバーの複タブ化
  - これはある程度は web ブラウザのタブ/ウィンドウを複数使用することで置き換えられる
  - しかし, merge の場面ではアプリケーション内での複タブが望ましいのではないか
  - 新しいグラフを開く時には, 常に新規タブで開くことにする
    - タブは消すことができるが, 変更内容は当然保持され, 再度左サイドバーからそのグラフを
      開いた時には再現される
- 通知
  - 👉 [notification](./step3/notification.md)
- property editor
  - ボディ内での表示と, 右サイドバーでの表示を併用する
  - 👉 [property editor](./step3/property-editor.md)
- metagraph
  - 👉 [metagraph](./step3/metagraph.md)
- global (op-log) 検索
  - 👉 [global search](./step3/global-search.md)
- DtR graph による merge は廃止する. その代わりに multiple graph view を使った merge を入れる
  - 👉 [merger](./step3/merger.md)
- toulmin template は維持するが, システム埋め込みではなく, template graph による定義とする
  - 👉 [template graph](./step3/template-graph.md)
- Deep Link + URI schema
  - → 相談
- tauri → PWA
  - tauri の利用をテストしてきたが, いまいちな点も多かった. e.g.,
    - safari 対応
    - mobile device での利用
  - conversensus の思想からも, できる限り標準的な web 技術をベースにすべきだろう
  - なので, 二転三転したが, tauri によるパッケージングは止めて, PWA を配信する形に戻ろう
  - そうすると, storage は SQLite から indexedDB か OPFS への移行が必要になりそう

---

## 3. 議論で決まったこと (2026-09-30)

### 3.1 D1: FPR は「スキーマを自由に変えられる最後の機会」である

互換性を考慮しなくてよいのは FPR の前までである。したがって項目を
**データ (op-log・lexicon・保存先) が変わるか**で分ける。

| FPR 前に必須 (データが変わる) → plans | FPR 後でもよい (UI だけ) → issue |
| --- | --- |
| vector clock (分岐点 + batch)、DtR の撤去、template graph、metagraph、通知の lexicon、フォルダの state、保存先 (PWA) | i18n、無限キャンバス、アプリ内タブ、timeline view、global search、デザイン言語の適用 |

**帰結**: 互換性を捨てたので、step3-entry の B (版の混在)・問 2・問 4 と rkey の `v2~` 移行は
問いごと消える。batch への vector を分岐点と**同時に**入れられる。DtR の撤去で C・D と
問 11〜18 もほぼ消える。

### 3.2 D2: metagraph の graph node は導出する

graph node は op として積まず、**sheet の一覧から導出する**。保存するのは位置と、
graph node 以外の node/edge だけである。

- metagraph 上の操作は既存の op へ翻訳する (graph node の追加 = `sheet.create`、
  削除 = `sheet.remove`、ラベル変更 = `sheet.setName`)
- 名前の正は sheet 側の 1 つだけになり、「全 metagraph に op を積む」並行性の問題
  (ANA-118 の削除の伝播と同型) が構造上起きない
- **設計が要る所**: 導出 node には `node.add` が無いが、`node.setLayout` と edge の端点は
  受ける必要がある。導出 node の id を SheetId から決定的に作り、畳み込みに
  「add の無い導出 node への op を受ける」規則を足す

### 3.3 D3: op の語彙はコアが閉じて持つ

> **拡張が足してよいのは、名前空間付きのプロパティと導出 (projection) だけである。
> op の種類は足さない。**

特殊なグラフ (metagraph、template graph、将来は拡張が持ち込むもの) は、
**種別プロパティが特別な値を持つ sheet** として表す。

**理由**: op は他人の repo に永久に残る通信形式である。

- 拡張が op の種類を足すと、その拡張を持たない相手はその op を畳めず、
  **同じログから違う projection が出る** (SEC が崩れる)。
  step3-entry §2.1 の「畳み込みの規則の変更は静かに違う答えを出す」と同じ問題である
- 未知のプロパティなら、持たない相手も**保存して運び、無視できる**。
  `templatesOf` が知らない id を黙って落とすのと同じく、「ただの sheet」へ連続的に劣化する
- 拡張の導出は、持たない相手には見えない。ただしその差は **view にしか出ず、ログは同じ**
  なので許容する

### 3.4 基盤の op 変更 (D1〜D3 から)

| | 変更 | 種類 |
| --- | --- | --- |
| 1 | vector (分岐点 `Commit.baseVector` + batch) | 畳み込みの規則 |
| 2 | DtR の撤去 (`dtr.*` と名前による判別) | 語彙の削除 |
| 3 | `sheet.setProperty` (または `sheet.create.properties`) と sheet の種別プロパティ | 語彙の追加 (汎用 1 つ) |
| 4 | `sheet.create.templateIds` を `TemplateRef = 作り込み id \| { sheet, 切断面 }` へ | スキーマの変更 |
| 5 | 導出 node への op を受ける畳み込み (D2) | 畳み込みの規則 |

1 と 5 は**間違えても静かに違う答えを出す側**なので、性質テストで固める。

### 3.4a D4: op-log は追記のみ。削除も op である (2026-10-02)

> **op-log の batch は一度書いたら書き換えも削除もしない。File・branch・node などの削除は
> tombstone の op (`file.remove` / `branch.remove` / `node.remove` …) として追記し、
> 畳み込みで見えなくする。**

**理由**:

- **物理的に消すと復活する。**行ごと消すと tombstone まで消え、次の discovery が
  「ローカルに無い = 未知」と判定して PDS から作り直す (ANA-127 がこれだった)
- **相手の repo にある記録は消せない。**分散した op-log で「消す」が意味を持つのは、
  全員の手元で畳み込みから見えなくすることだけである
- **経緯は残すこと自体に価値がある。**merge や判断の跡を後から辿れる

**肥大化は「保持」の問題として別に扱う (GC, 将来)**:

- GC は仕様の外にある**ローカル正典の最適化**であり、畳み込みの結果を変えてはならない
- 安全に捨てられるのは **remove-wins で消えたものの中身**である。二度と復活しないので、
  **tombstone を残せば**本体の batch を捨てても projection は変わらない
- branch の本体は `branch.remove` の時点で捨てられる (merge した batch は trunk に写されて
  着地しており、commit のメタも trunk の op-log にある)。File の削除はその File の branch
  すべてにこれを当てる特別な場合である
- PDS 側は自分の record しか消せないので、GC はローカルに閉じる
- 実施は肥大化を測ってから。名前は `purge` 系とし、「tombstone を残す」を契約に書く

### 3.5 未決 (O)

- **O1**: 「グラフ view のアドレス」`(file, sheet, branch, 切断面, mode, highlight)` を 1 つ定義し、
  アプリ内タブ・Deep Link・timeline の inspector・global search の結果・merger の
  merge 元/先をすべてその上に載せるか。切断面を正しく指すには vector が要る
- **O2**: merger を implicit merge から起動するとき、merge 元/先は何を指すか (T7 の fork 同士か)。
  implicit 側で競合表示を対称にするには batch への vector が要る
- **O3**: merger 作業中に merge 先が進んだときの扱い (実質 rebase)。競合の同定と
  チェック状態の引き継ぎ
- **O4**: 通知とフォルダの state を PDS に置くと公開される。意図どおりか。
  システム通知の多くは op-log から導出でき、PDS に要るのは既読状態だけかもしれない
- **O5**: PWA の保存先。IndexedDB より SQLite-WASM + OPFS が既存スキーマを活かせる。
  Safari の ITP によるストレージ消去 (未インストール時) と、複数ブラウザタブからの
  同時書き込みを確かめる (いずれも未検証)。ローカルサーバ層がまるごとブラウザへ移る点に注意
- **O6**: リアルタイム同期。Jetstream (collection・DID で絞った firehose) で近リアルタイム化は
  ATProto の範囲でできる。presence やキー入力単位の同期は ATProto のモデル外なので step4 以降が妥当
