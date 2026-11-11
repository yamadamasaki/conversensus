# 入門の図: シナリオと撮り方の提案

- 日付: 2026-11-04
- 対象: `docs/introductory_guide_to_conversensus/ja/` の `<figure>` (全 23 か所)
- 状態: 決定 (2026-11-04: 読書会 / 5 章の衝突は 1 人で / Playwright で撮り、MCP は agent の相談で)。実装の進捗は §4

## 1. シナリオ

### 1.1 方針

- **入門全体を 1 つの話で通す。**章ごとに別の例を使うと、読者は図のたびに中身を読み直すことになる。
  同じ File が章を追って育っていけば、「成長するグラフ」の章がそのまま話の続きになる
- **2 人で始まる。**「グラフで対話する」と merge の衝突には 2 つ目のアカウントが要る。
  最初から 2 人の話にしておけば、後から人を足す不自然さが無い
- **中身は誰でも分かる題材にする。**専門の例 (anarchitecture・CoatingMind・KnowledgeGrapher) は例題の側で扱う

### 1.2 案: 「読書会で 1 冊の本を読む」

alice と bob が読書会で 1 冊の本を読み、議論をグラフにしていく。`thinking_with_graphs` の
「本を読んだり, 人と話をしたりしているとき, 片っ端からそれをグラフで書き直したくなる」と直接つながる。

| 章 | 場面 | 主な図 |
| --- | --- | --- |
| 1 conversensus って何 | 本の 1 つの主張 (markdown node) と、表紙の画像 (image node) を edge 「出典」で結ぶ。node に label 「主張」、property 「頁: 42」 | 単純なグラフ |
| 2 始める | 未ログインで開いた初期画面 | 初期画面 |
| 3 グラフの置き場所 | Folder 「読書会」の中に File 「〇〇を読む」。Sheet は 「第 1 章」「第 2 章」と index | 左サイドバー |
| 4 グラフで考える | 「第 1 章」に要点を落書きする。markdown / 画像 / group (「著者の前提」でまとめる) | グラフの画面、node の作成 4 枚 |
| 5 成長するグラフ | bob が「第 1 章」に branch 「別の読み」を切り、要点を組み替えて commit、merge する。その間に alice が trunk の同じ node を書き換えていて、内容の衝突が出る | trunk、branch 作成、差分、close/delete、commit、merge、衝突、timeline |
| 6 グラフで対話する | alice が File を作り、bob に参加を依頼する (5 章より前の出来事として、章の順と時間の順をずらす) | 参加依頼、参加、参加者一覧、2 人の履歴、衝突の通知、離脱 |
| 7 グラフのカタ | index に「第 2 章は第 1 章への反論」と書き足す。論点の Sheet に Toulmin model を当てる | index (既定 / 書き足し)、独自の metagraph、Toulmin |

**引っかかる点**: 6 章 (参加) が 5 章 (merge の衝突) の前提になっている。案は 2 つある。

- (a) 章の順を変えない。5 章の衝突の図は 2 人で撮るが、本文では「共同作業の詳細は次章」とだけ書く
- (b) 5 章の衝突を **1 人で 2 つの branch** から起こす (trunk を直接書き換えてから branch を merge)。
  2 人が要るのは 6 章だけになる

(b) の方が章が独立して読める。私は (b) を推す。

### 1.3 別案: 「チームで道具の導入を決める」

「新しいツールを入れるか」を Toulmin model で論じる。7 章の Toulmin が自然に入るのが利点。
ただし、意思決定の例は CoatingMind の要求開発と重なる。

## 2. 撮り方

### 2.1 推す方法: Playwright の撮影スクリプト

図を **コードで撮る**。`tests/` の Playwright の土台 (専用ポート、プロファイルごとの persistent context、
`pageProblems`) がそのまま使える。

- 1 章 1 スクリプト (`docs/introductory_guide_to_conversensus/shots/*.ts` など)。テストとは別に走らせる
- **英語版がただで手に入る。**fixture は locale を渡せる (i18n の E2E で使っている) ので、
  同じスクリプトを `ja` と `en` で 2 回走らせれば、両方の図がそろう。step4 の最後の段 (英語版) が軽くなる
- **UI が変わったら撮り直せる。**手で撮った図は、版が上がるたびに古くなっていく
- 場面のデータは 2 通りで作る。
  - 図に写らない下ごしらえ (File・Sheet・node を並べる): `.conversensus` を import する。
    user-test-environment §2.2 と同じ再現可能な手段
  - 図に写る操作 (ダイアログ、メニュー、差分): 画面を本当に操作する
- 2 人の場面 (6 章) は開発 PDS の `alice.test` / `bob.test` を、別の origin (5173 / 5174) で開く
  (user-test-environment §5.1)。ここだけはローカルの PDS が要る

注意: 撮影はテストではないので、`bun run test` には入れない。ただし `pageProblems` は併用し、
エラーの出ている画面を図にしないようにする。

### 2.2 MCP を作ることについて

**撮影のために MCP を作るのは勧めない。ただし、MCP そのものは作る価値がある。**分けて考えたい。

撮影の道具としては重い:

- 撮影に要るのは「画面を操作して撮る」ことで、それは Playwright (または既存の Playwright MCP や
  Claude in Chrome) が既にできる。conversensus 専用の MCP を挟んでも、得るものが少ない
- 画面の操作を MCP の tool にすると、その tool の形が **UI の形に縛られる**。UI を変えるたびに
  MCP も変わり、事実上の公開 API が UI の写しになる

一方、MCP を作る本当の理由は、次の相談 (agent を actor として参加させる) の方にある:

- agent が参加するなら、agent は **画面ではなく op を介して** グラフを書くべきである。
  自分の PDS のアカウントで op-log に書き、ほかの参加者と同じ規則で畳み込まれる
- その tool は「File を作る」「node を足す」「branch を切る」「commit する」のような
  **op の語彙** になる。step3 で「op 語彙はコアが閉じる」と決めたので、境界がはっきりしている

両者が交わる所が 1 つある。**撮影スクリプトの下ごしらえを、op を組み立てる小さな層で書く**
(「File を作り、Sheet に node を 3 つ置く」を op の列として作り、`.conversensus` に書き出す) と、
その層は後で MCP の tool の中身にそのまま使える。撮影のために作るものが無駄にならず、
しかも MCP の設計 (agent の参加) を撮影の都合で急がずに済む。

まとめると:

1. 今: Playwright の撮影スクリプトで図を撮る。下ごしらえは op を組み立てる層で書く
2. 次 (agent の相談): その層を核に、agent を actor として参加させる MCP を設計する

## 3. 決めてほしいこと

- シナリオ: 1.2 「読書会」か 1.3 「道具の導入」か、別の題材か
- 1.2 なら、5 章の衝突を (a) 2 人で撮るか (b) 1 人で起こすか
- 撮り方: 2.1 (Playwright のスクリプト、MCP は agent の相談で) でよいか

## 4. 実装の進捗 (2026-11-04)

- 撮り方: `bun run docs:shots` (ja と en)。設定 `playwright.shots.config.ts`、スクリプト
  `docs/introductory_guide_to_conversensus/shots/*.shot.ts`、図は `../images/<言語>/`
- 場面: 『自由論』(J. S. ミル, 1859) を読む読書会 (`shots/scene.ts`)。下ごしらえは `FileBuilder`
  (`src/shared/src/scenario/`) で組み立てて import する
- 撮れたもの: 全章 (ドラフトの figure 23 か所、画像 27 枚、ja / en とも)。ドラフトに `<img>` で入れた
- 6 章は開発用の PDS (localhost:3000) に hanako.test / taro.test を撮るたびに作り直して撮る (`shots/accounts.ts`)。PDS が動いていないと撮れない

### 撮っていて見つけたもの

直したもの:

- import で node の label が落ちていた (genesis)
- import で metagraph の graph node が二重になっていた
- merger の merge 元の pane に、他の Sheet の node が「追加」として出ていた (`branchSheet`)

直していないもの (issue に起こした: #326〜#333):

- import した File の画像が PDS に送られず、参加者に見えない (#333)。参加者の画面の取得の URL も `//blob/` と二重


- 画像の node と group の node は label を描かない。1 章の図の注文 (「それぞれにラベル」) を満たせない
- template を当てた Sheet を export → import すると、template への参照 (`{sheet, at}`) と種別の
  property 名が古い template graph の Sheet を指したままになるはず (import が Sheet の id を振り直す)。未確認
- merger の merge 元・merge 先の pane に edge が描かれない (merge 後には描かれる)
- 生の markdown (`**`) が出る所: property の欄の見出し、conflict list の要素の名前
- 訳されていない文言: conflict list の見出し、merge の確認の「merge」、Toulmin の種別名 (en でも日本語)
- metagraph・template graph の Sheet の行のボタンに accessible name が無い
- 画像を落とすと既定の大きさ (160 × 80) の枠に入り、画像が切れる

細かい気付き (issue にはしていない): 共有中の参加者一覧のボタンは accessible name が人数だけになる (#331 と同じ種類)。
timeline の genesis の時刻が「1/1 09:00」と出る。参加者一覧の依頼者の欄が、見る人によって違う (taro の画面では taro の依頼者が「—」)

## 5. v1.4.0 の前に足した図 (2026-11-11)

入門の文章 (avatar・読み取り専用の property・template の後付けと種類の名前の言語・agent と依頼) に合わせて
5 枚 × 2 言語を足した。どれも `bun run docs:shots` で撮る。

| 図 | 章 | スクリプト |
| --- | --- | --- |
| `thinking_with_graphs-readonly-properties` | グラフで考える (右サイドバー) | `04-kata` (Toulmin の種類が要るので) |
| `graph_kata-template-apply-later` | グラフのカタ | `04-kata` |
| `interact_with_graphs-request-send` / `-arrived` / `-answered` | グラフで対話する | `05-interact` (hanako が送り、taro が答える) |

既にある図も撮り直した。en では Toulmin の種類名が英語になり (#356)、どの node にも書いた人の avatar が写る (#354)。
agent の印は撮っていない (図のための agent の宣言を用意する仕組みが無い)。

### 撮っていて見つけたもの

- **依頼の宛先の候補が、File を開いたときにしか読まれない** (`useFileParticipants` は fileId が変わるときだけ名簿を
  読む)。File を開いた後で参加した人は、開き直すまで宛先に出ない。撮影は送る前に再読み込みして避けている
- **import した場面の書き手 `genesis` を DID として PDS に読みに行く** (`describeRepo?repo=genesis`、
  agent の宣言の `getRecord`。どちらも 400)。画面では import した node すべてに「G」の avatar が付く
- 人のアカウントの agent の宣言を読むと 400 (RecordNotFound) になり、コンソールに「Failed to load resource」が出る。
  宣言が無いのは正常なので、問題として数えない (`05-interact` の `expectedFailures`)
- 読み取り専用で出す種別の property は、名前も値も id のまま (`template.<id>.kind` = `<uuid>`) で、人には読めない
