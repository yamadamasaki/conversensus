# agent 段 4: 応答を求める node (依頼・相談) (実装計画)

> 設計: [agent-actor.md](../architecture/step4/agent-actor.md) §3 D6〜D13、§4 段 4。issue #350。
> 前の段: [agent-stage3-mcp.md](agent-stage3-mcp.md) (PR #360)。
> branch: `step/agent-stage4-request`。

## 1. 目標と完了基準

人間と agent が、互いに**応答を求める node** を送り、答えられるようにする。conversensus は依頼を
評価しない — 送った人が「送る」と宛先に届き、宛先の actor が自分で答える (D12)。

**完了基準**:

1. core が「応答を求める node」のシステム・プロパティ 4 つ (`addressee`・`sent`・`closed`・`answers`) を
   知り、**状態 (下書き / 送った・未回答 / 回答あり / 閉じた) を導出**できる (D6・D8)
2. 作り込みの種「依頼・相談」の template があり、「シートを追加 ▾」から File に入れられる (D6)
3. 画面で、依頼 node の状態が見え、宛先を選び、送る・閉じる・開き直す・答えるができる (D7・D12)
4. 送ると、宛先 (空なら参加者全員) の人間に通知が出る (D11)
5. agent は MCP で、自分宛ての未回答の依頼を見つけ、答えを書ける (答えの edge に `answers` が付く)。
   agent も依頼を書いて送れる (§1.1)
6. App の alice が agent に送る → agent が MCP で答える → alice の画面で「回答あり」になる、を
   App 結合で確かめる。逆向き (agent が送り alice が答える) も
7. 開発用の PDS で、Claude Code の agent と人間の間で 6 を手で確かめる

**非目標**: 常駐の agent が送られたら自動で答える (段 5)、agent への合図 (firehose、段 5)、答えの数・採否 (D9)、
断る仕組み (D10)、`context` プロパティの Deep Link を agent が辿る (D13 — 段 5 で常駐の loop が使う)。

## 2. 調べて分かったこと (事実)

| # | 事実 | 帰結 |
| --- | --- | --- |
| F1 | 作り込みの種は `SEED_TEMPLATES` (`registry.ts`) の `Template` の表で、「シートを追加 ▾」が File の template graph に複製する (`templateGraphOf`)。種だけ多言語 (`seedLocale.ts`、#330 案 B) | 種を 1 つ足す。英語の訳も足す |
| F2 | 種類の既定値 (`NodeKind.defaults`) は、複製した template graph の種類の node の property になり、当てたシートで node を作るときに写る | `addressee: []`・`answerTarget: 'linkedNode'` を既定値に持たせれば、作った依頼 node が最初から「応答を求める node」になる |
| F3 | **F2 の副作用**: template graph の種類の node そのものも `addressee` を持つ | 状態・通知・MCP の一覧は **template graph の sheet を除く** (`sheetKindOf`) |
| F4 | 通知 (step3 Phase 6) は**受信のたびに op-log から検出し直す**。PDS に置くのは既読 (閉じた) だけ (`useNoticeInbox`・`noticeKeys`)。種類は競合・上書き・届いた fork の 3 つで、画面右下に出る。ベルは無い | 「依頼が届いた」を 4 つ目の種類として足す。既読の鍵は File・node・送った回数で決まる |
| F5 | 名簿 (`rosterRows`) は DID の行で、handle は別に引く (`sortRowsByLabel` の `labelOf`) | 宛先の候補は名簿の「参加している」行 |
| F6 | property の欄 (`PropertyEditor`) は system (`app.conversensus.*`) を見せず書かせない。read-only の表示は #357 で別 | 依頼の操作は property の欄ではなく、**専用の欄**で行う |
| F7 | 種別プロパティ・system の property は MCP の道具で書けない (段 3 M2) | 送る・閉じる・答えるは**専用の道具**にする (道具が system の property を書く唯一の口) |
| F8 | sheet node は metagraph にしかない (#347 は open、ユースケース待ち) | `answerTarget: newSheet` の「依頼 node から sheet node への edge」は今は作れない (Q1) |

## 3. 問い

- **Q1. `answerTarget` のうち段 4 で作るもの**
  - 案 A (推奨): **`linkedNode` だけ**。`newSheet`・`newFile` は sheet node (#347) と File への参照 node が
    要るので、それらと一緒に後で足す。値の候補にも出さない (選べるのに動かない、を避ける)
  - 案 B: 3 つとも段 4 で作る (#347 の一部を先に作る)
- **Q2. 依頼の操作を置く場所**
  - 案 A (推奨): node には**状態の印** (下書き・送った・回答あり・閉じた) だけを描き、宛先・送る・閉じる・
    開き直す・答えるは、node を選んだときの**右の欄の「依頼」の区画**に置く。property の欄と並ぶ
  - 案 B: node を選んだときに node の上にボタンの列 (`NodeToolbar`) を出す
- **Q3. 人間への通知の出し方**
  - 案 A (推奨): 既存の通知 (右下) に**「依頼が届いた」**を足す。既読は他の端末にも効く (Phase 6 と同じ)。
    通知から依頼 node へ飛べる
  - 案 B: ヘッダにベル (一覧) を新しく作る
- **Q4. 種の形**
  - 案 A (推奨): **1 つの template「依頼・相談」**に種類 2 つ (依頼・相談) と edge の種類「答え」
    (依頼・相談 → 任意) を持たせる。違いは名前と説明 (= 種類ごとの指示、D13) だけ
  - 案 B: 「依頼」と「相談」を別々の template にする
- 答え (利用者 2026-11-08): **Q1〜Q4 すべて案 A** (linkedNode だけ・右の欄の区画・右下の通知・1 つの template)

## 4. スライス (案。Q の答えで変わる)

| | 内容 | 確かめ方 |
| --- | --- | --- |
| R1 | **shared**: システム・プロパティの名前と値の読み (`addressee` は DID の配列、`sent` は整数 …)、**状態の導出** (`requestStatus`)、自分宛てか (`addressedTo`)、答えの edge の判定。template graph の sheet を除く | 単体 + 性質 (状態は 4 つのどれか 1 つ、閉じたは他より優先、送り直すと前の答えでは「回答あり」にならない、など) |
| R2 | **種**: 「依頼・相談」の template と英語の訳、並べ方 | 種の表の検め (`seed.test`) |
| R3 | **GraphEvent**: 送る (`sent` + 1)・閉じる / 開き直す (`closed`)・宛先 (`addressee`)・答える (node + edge + `answers` を **1 batch**) | 出る op の並び。答えるが batch 1 つ |
| R4 | **画面**: node の状態の印、右の欄の「依頼」の区画 (宛先を名簿から選ぶ、送る・閉じる・開き直す・答える) | コンポーネントのテスト + App 結合 |
| R5 | **通知**: 受信した op から「送った」を見つけ、自分宛てなら右下に出す。既読の鍵 | 単体 (検出) + App 結合 (alice が送り bob に出る) |
| R6 | **MCP**: `list_requests` (自分宛ての未回答)、`answer_request`、`send_request`・`close_request`・`set_addressee`。encoding に状態の注釈 | `mcp.test` + App 結合 (完了基準 6) |
| R7 | 開発用の PDS で Claude Code と人間で行き来する。`user-test-environment.md` に手順 | 完了基準 7 (人間が確かめる) |

### 4.1 進捗

| | 状態 | メモ |
| --- | --- | --- |
| R1 | 済 | `shared/src/events/request.ts`。値は形が違っても落ちない (読めない値は無いのと同じ) |
| R2 | 済 | `shared/src/template/request.ts`。**edge の種類「答え」は置かなかった** (Q4 の案から外れる): 置くと、人が依頼から普通の node へ引いた edge にも自動で「答え」が付き、`answers` の無い「答えに見える edge」ができる。答えの edge は「答える」の操作だけが作る |
| R3 | 済 | `client/src/request/requestEvents.ts`。答えるは既存の `NODES_PASTED` (node と edge を 1 batch、undo もある) で書く。答えの edge の label は書く人の言語 (画面は利用者の言語の「答え」、MCP は渡されたときだけ) |
| R4 | 済 | 右の欄の「依頼」の区画 (`RequestPanel`)、node の状態の印 (`RequestBadge`)、宛先の候補 (`useFileParticipants`、ログインしているときだけ名簿を読む)。答えると `NODES_PASTED` が選択を外すので、依頼を選んだままにする (App 結合で発見)。状態の規則は shared の `statusOf` 1 か所 |
| R5 | 済 | `sync/requestArrival.ts` (受信の分岐点で、他の人が `sent` を増やした自分宛ての依頼を見つける)、右下の `RequestNotice` (開く = 検索と同じ道で開いて寄せる、既読は PDS)。**限り**: (1) 見つけるのは同期している File (前と背後のタブ) だけ — 開いていない File への依頼は、開くまで知らない (常駐・合図は段 5)。(2) 届いた依頼の通知は再読み込みで消え、出し直さない (受信の前後で回数が変わらないため)。自分宛ての未回答の一覧が要れば後で足す |
| R6 | 済 | MCP の道具 7 つ (`list_requests`・`answer_request`・`send_request`・`close_request`・`reopen_request`・`set_addressee`・`list_participants`)。`list_requests` は自分が最後に送った依頼を除く (`senderOf`)。encoding に依頼の状態の注釈。App 結合で alice ↔ agent を両向きに一周 (**完了基準 1〜6 を満たす**) |
| R7 | — | |

## 5. 決めたこと

- 状態は保存せず導出する (D8)。「送った」「閉じた」は依頼した人の行為なので op に残る
- system の property を書く口は、依頼の操作 (画面の区画・MCP の専用の道具) だけにする。
  property の欄と汎用の道具からは今までどおり書けない
