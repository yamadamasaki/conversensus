# Conversensus 入門 ドラフトのレビュー (1 回目)

- 日付: 2026-11-03
- 対象: `docs/introductory_guide_to_conversensus/ja/` の 8 ファイル (未 commit のドラフト)
- 方法: 記述を実装 (文言の辞書 `src/client/src/i18n/ja.ts` とコード) と突き合わせた
- 並びは重要な順

## A. 実装と食い違っている記述 (直すべきもの)

### A-1. node の「ラベル」の意味 (`what_is_conversensus`, `thinking_with_graphs`)

- 実装では node の label は **種別** である (`node.setLabel` = 「node の種類を変更」)。作成時に決まり、
  「種別は作成時に決まり、変更できません」と表示される。名前に当たるのは content
- edge の label は **名前** である (`edge.setLabel` = 「edge の名前を変更」)
- ドラフトの「node や edge には任意の名前と複数の属性」と、「ここでできること」の node の
  「label を編集する」は、どちらも実装とずれている
- オントロジとの対応の核になる点なので、入門の段階でそろえておきたい

### A-2. ATProto の説明 (`lets_get_started` の aside)

- 「ある PDS でアカウントを登録すれば, そのアカウントで別の PDS にもログインできます」は不正確。
  アカウントは 1 つの PDS に属する。ログインする先はアプリで、自分の PDS のページへ移ってログインし、
  アプリに戻ってくる (`login.oauthNote`)
- 「ATProto アカウントがあれば誰でも読むことができます」は、実際には **アカウントが無くても誰でも読める**
  (`com.atproto.sync.listRepos` はログイン無しで引ける)。プライバシーの期待に関わるので、もっと目立つ所に書く

### A-3. 共同作業できる相手の条件 (`interact_with_graphs`)

- ドラフトは「公式 PDS にアカウントを持っていることが必要」としている。実装の条件は
  **「依頼する人と同じ PDS」のアカウント** である (`isDidOnThisPds`, `targetForeignPds`)。
  自前の PDS 同士でも共同作業できる
- 要確認: Bluesky のアカウントは複数の PDS ホストに分散しているはずなので、Bluesky のアカウント同士でも
  共同作業できない場合がある。実機で確かめたい

### A-4. 未ログインで使う場合 (`lets_get_started`) に書かれていないこと

- 後でログインすると、端末だけにある File を「アカウントに保存する」か「この端末に残す」か訊かれる。
  File の詳細から後で保存することもできる
- プライベートブラウズの窓では保存できない (「この窓では保存できません」)
- 消えるおそれがあるときは、警告のバナーが出る

### A-5. 検索 (`the_place_where_graph_lives`)

- ドラフトは「名前や概要欄の内容で検索」としているが、**概要は検索の対象外**
- 実装にある検索は 2 つ:
  - サイドバー: File・Sheet・Folder の名前で探す
  - ⌘⇧F: File をまたいで、名前と node の中身を探す

### A-6. branch を作る時点 (`evolving_graph`)

- ドラフトは「trunk の任意の時点で」としているが、実装の分岐点は **trunk の現在の先端** である
  (`createBranchOnOplog`)。過去の時点からは作れない。「いつでも」が正確
- branch を作るボタンがサイドバーの Sheet の行にあることも書くと親切

### A-7. 「編集不可にする」 (`thinking_with_graphs` の「ここでできること」)

- React Flow の `<Controls>` (ロックのボタン) が見つからなかった。今の UI にあるか確かめる

### A-8. その他の事実関係

- 空でない Folder は削除できない
- 最後の Sheet は削除できない
- Sheet を追加するとき、template を選べる (「template 付きで Sheet を追加」)

## B. 抜けている、または薄い内容

### B-1. グラフで対話する

- 手順は「ハンドル名を入れて参加依頼する → 参加コードを渡す → 相手が参加コードを入力して承認する」。
  ドラフトは最初の段 (ハンドル名の入力) を飛ばしている
- 対話の中身が書かれていない。たとえば:
  - 近リアルタイムの同期
  - 競合の 3 段 (内容・構造・位置) と、**保留して後から対話で決める** 扱い
  - 「上書きの報告」
  - 背後のタブに付く印
  - 参加していなかった間の編集を取り込む間は読み取り専用になること
  - 「この File を引き取る」
- conversensus らしさが一番出る部分なので、厚くする価値がある

### B-2. merge の衝突

- 「衝突を解消するための仕組みが発動します」だけでは中身が分からない。上の 3 段と merger の画面
  (merge 元 / merge 先 / merge 後 / 取り込む) を説明する

### B-3. history

- 節が図だけ。version tree、過去の時点は読み取り専用、Deep Link について書ける

### B-4. version の「metagraph」

- `evolving_graph` で版の木を「一種の metagraph」と呼んでいる。`graph_kata` の metagraph
  (Sheet を node とするグラフ) と言葉がぶつかる。UI の呼び名どおり「version tree」とする

### B-5. template graph

- 実装では、利用者が種別 `template` の Sheet を描くと、それがそのまま template になる
  (`src/shared/src/template/fromSheet.ts`: label のある node は種類になり、label の無い node は説明書きになる)
- 「詳細はここには書きません」で済ませず、「自分で作れる」ことは入門でも一言触れる価値がある

### B-6. index

- 実装では index 自身も graph node として index に出る。図を作るときに注意する
- 「逆も同じ」のうち、追加の向き (index の「グラフ」ボタンで Sheet が増える) は確かめた。
  graph node を消すと Sheet も消えるかどうかは確かめていない

## C. 構成と表記

- 目次が `index.md` と `what_is_conversensus.md` にあり、内容が食い違っている
  (対話 / 会話、カタ / 型、8 章の有無)。1 章の目次を消す
- 中身が空の箇所:
  - 「ここでできること」: `interact_with_graphs` と `graph_kata`
  - `evolving_graph` の merge の項
  - `thinking_with_graphs` の「(例)」2 か所
  - 計画では、この箇所が Ontology への参照の受け皿になるはず
- `evolving_graph` の「ここでできること」の誤り:
  - branch の下で「削除する」と「delete する」が重複している
  - 「commit → merge する」となっているが、merge するのは branch
- `evolving_graph` の merge の節の 2 つ目の figure (「単純なグラフ」) は、1 章からコピーしたまま残っている
- 用語を UI に合わせる:
  - UI は File・Sheet・Folder と大文字で始めている (visual language §7)
  - 「graph container / graph body」は UI では左サイドバーとグラフ
  - 招待 / 招待コードは、UI では参加依頼 / 参加コード
  - index の node を「sheet node」と書いている所がある。他の箇所に合わせて graph node にそろえる
- typo: `Propery`、`Window` (→ Windows)、`contaier`、`cotainer`、`barnch`、`mmerge`、`ATproto`、
  「そのWeb」、「(sheet node 以外の) の」
- 書式:
  - `lets_get_started` の入れ子のリストは 2 字下げなので、CommonMark では入れ子にならない。3 字以上下げる
  - `<aside>💡` は Notion から書き出した痕跡に見える。GitHub ではおそらく装飾なしで出るので、
    `> [!NOTE]` などに置き換える
- Toulmin モデルを「論証分析とも呼ばれます」としているが、別名とは言いにくい。
  「論証の分析に使われる図式」くらいが安全

## D. step4.md の「問題点」(graph node の区別) について

案 (label を "graph"、content は今のまま Sheet 名) に賛成。理由は A-1 と同じで、実装では
**label = 種別** なので、LPG の意味にそのまま合う。今の導出 node には label が無く、
content (Sheet 名) しか持っていない。

実装するときの注意:

- 導出 node の content と同じく、label も保存せず **導出** にする (`src/shared/src/events/derivedNode.ts`)
- metagraph に template を当てる場合、"graph" という種別名が利用者の template の種別とぶつからないようにする

## 利用者の返答と対応 (2026-11-04)

- **A-1 はレビューの誤り。**LPG としては node も edge も label はただの label で、意味は決まっておらず、
  変更もできる。template や拡張機能が意味を決め、場合によっては変更不可にする (toulmin の「主張」など)。
  実装もそうなっている (`EditableNode.tsx` の `kindFromTemplate`、`property.readOnly.templateKind` は
  template の種別にだけ出る)。ドラフトはこの意味で書き直し、「label = 種別」と書いていたコメント
  (`schemas.ts`、`unified.ts`、`EditableNode.tsx`) も直した
- **A-7 は在る。**グラフの左下、拡大・縮小・fit の下のボタン。ドラフトに「グラフの左下」の節を足した
- **B-6 は確かめた。**graph node を消すと Sheet 削除の確認が出て、OK で Sheet が消える
  (`App.tsx` の `metagraphTransform` → `confirmDeleteSheet` → `handleDeleteSheet`)
- **D は実装した** (commit 3959900)。graph node の label は `graph` (`GRAPH_NODE_LABEL`) で、保存せず導出する。
  変えられないので編集の口を出さない。#258 の「graph node に label の口を出さない」はこれで置き換わる
- その他の項目はレビューのとおりにドラフトを直した
- 未確認のまま: A-3 の Bluesky のアカウント同士 (PDS ホストが分かれていれば共同作業できないはず)。
  ドラフトは「同じ PDS」とだけ書いた
- 残り (利用者の文章が要るもの): `thinking_with_graphs` の「(例)」2 か所、`graph_kata` の「ここでできること」
