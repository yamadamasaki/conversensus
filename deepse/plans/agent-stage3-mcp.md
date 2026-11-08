# agent 段 3: 完全な encoding と MCP server (実装計画)

> 設計: [agent-actor.md](../architecture/step4/agent-actor.md) §2 D4・D5・D13、§4 段 3。issue #349。
> 前の段: [agent-stage2-headless.md](agent-stage2-headless.md) (PR #359)。
> branch: `step/agent-stage3-mcp`。

## 1. 目標と完了基準

**Claude Code から、人間が横で見ながら、agent の DID で File を読み書きできる**ようにする。
段 2 の `Headless` の上に、読むための encoding と、書くための MCP の道具を載せる。

**完了基準**:

1. graph を **property も含めて欠けなく**テキストに落とす encoding がある。node・edge の id が残り、
   書く道具で参照できる (D4)
2. MCP server (stdio) が、参加している File の一覧・読む・書く道具を出す。書く道具は
   **既存の op に 1 対 1** で対応する (D4)
3. 書く道具は UI と同じ GraphEvent の経路を通る (段 2 §5 の決めたこと)。
   **道具 1 回 = op の batch 1 つ** になっていることをテストで確かめる
4. 偽の PDS の世界で、MCP の client (SDK の in-memory transport) → server → headless →
   App の alice の画面、の一周をテストで確かめる
5. 開発用の PDS で、Claude Code に MCP server を登録し、例題を一つ作ってもらう。
   作ったものが alice の画面に出るのを人間が確かめる

**非目標**: 依頼・相談 node (段 4)、常駐と自動の応答 (段 5)、テキストから graph への逆向き (D4)、
agent の宣言 (D2)。

## 2. 調べて分かったこと (事実)

| # | 事実 | 帰結 |
| --- | --- | --- |
| F1 | op の語彙は `src/shared/src/events/unified.ts` の `OpSchema`。基本語彙 (node/edge の add・remove・setContent・setLabel・setProperty・setParent・reconnect・setLayout …) と器 (sheet・file・branch・commit) | 道具はこの語彙から選ぶ |
| F2 | GraphEvent → op は `graphEventToOps` (`client/src/events/toUnified.ts`)。`Headless.record` はこの経路 | 道具は GraphEvent を作って `record` に渡す |
| F3 | `Headless.read` は `projectFile` で trunk の `GraphFile` を返す。`Sheet` は `templateIds`・`properties`・`nodes`・`edges`・`layouts`・`edgeLayouts` を持つ | encoding の元はこれ。branch は別に畳む必要がある |
| F4 | 種別は `<templateId>.kind` プロパティに種類の **id** で入る (`kindPropertyOf`)。label は表示用 | encoding は種別を id と label の両方で出す。書く道具は id で受ける |
| F5 | system プロパティは `app.conversensus.` で始まる (`SYSTEM_PROPERTY_PREFIX`) | encoding では区別して出す (agent が誤って書き換えないように) |
| F6 | `graphdown.md` (人間が読むための markdown への mapping) は**延期**されていて実装は無い | agent 用の encoding は独立に作れる。graphdown とは混ぜない (D4) |
| F7 | `@modelcontextprotocol/sdk` 1.32.2 は zod `^3.25 \|\| ^4.0` を要る。repo は zod `^3.24.0` | 入れるときに zod 3.25 以上に上げる必要がある (別の確認が要る) |
| F8 | 段 2 の `Headless` は 1 プロセス = 1 agent で、`dataDir` の SQLite と `storage.json` を握る | MCP server と CLI を**同じ `dataDir` で同時に動かさない**。lock を置く |

## 3. 決めること (問い)

- **Q1. encoding の形**
  - 案 A (推奨): **行指向のテキスト** (YAML 風の入れ子)。Sheet ごとに、template と種別の一覧、node
    (id・種別・本文・property・親・位置)、edge (id・始点・終点・label・property) を並べる。
    id は省略しない。JSON より短く、言語モデルにも人間にも読める
  - 案 B: `GraphFile` の JSON をそのまま (正規化だけする)。欠けないことは自明だが長い
- **Q2. 段 3 で branch を扱うか** — D5 は「どこに書いてもよい」
  - 案 A (推奨): **段 3 は trunk だけ**。branch を読む・書く道具は次のスライスか段 4 の前に足す。
    例題づくり (段 3 の動機) は trunk で足りる
  - 案 B: 段 3 で branch の読み書きまで入れる
- **Q3. agent が足した node の位置**
  - 案 A (推奨): 道具の引数で**任意に** x・y を受け、無ければ既存の node と重ならない所に置く
    (簡単な規則)。位置も `node.setLayout` で 1 対 1 に書ける
  - 案 B: 位置は書かせない (人間が並べる)
- 答え (利用者 2026-11-08): **Q1 案 A (行指向のテキスト)・Q2 案 A (trunk だけ)・Q3 案 A (任意、無ければ自動)**

## 4. スライス

| | 内容 | 確かめ方 |
| --- | --- | --- |
| M0 | MCP SDK を入れる (zod を上げる)。bun の stdio で最小の server が Claude Code から見えるか spike | 道具 1 つが Claude Code に出る |
| M1 | **encoding** (`src/headless/src/encoding.ts`): `GraphFile` → テキスト。種別の id → label、system と拡張と custom の property の区別 | 例 + 性質: **encoding から元の graph の要素がすべて復元できる** (id・本文・property が欠けない) を、テスト専用の読み戻しで全称に見る |
| M2 | **書く道具** (`src/headless/src/tools.ts`): 道具の引数 → GraphEvent。node.add・node.setContent・node.setLabel (種別)・node.setProperty・node.remove・edge.add・edge.setLabel・edge.remove・node.setLayout | 道具ごとに、出る op が 1 対 1 で、batch が 1 つであること |
| M3 | **MCP server** (`src/headless/src/mcp.ts`): 道具を登録する。`files`・`read`・`sync` と M2 の書く道具。dataDir の lock | SDK の in-memory transport で client から呼ぶ。App 結合で alice の画面に出る (完了基準 4) |
| M4 | Claude Code への登録の手順、`user-test-environment.md` に追記。開発用の PDS で例題を作る | 完了基準 5 (人間が確かめる) |

### 4.1 進捗

| | 状態 | メモ |
| --- | --- | --- |
| M0 | 済 | `@modelcontextprotocol/sdk` 1.32.2。zod は既に 3.25.76 が入っていて上げる必要は無かった (F7)。bun で stdio の server を立て、SDK の client から道具の一覧と呼び出しが通ることを確かめた (spike は捨てた) |
| M1 | 済 | `encoding.ts`、`Headless.encode` (template を引いて注釈に添える)。読み戻しはテストの中だけに書き、「注釈を除いて欠けなく復元できる」を性質で見る |
| M2 | 済 | `tools.ts`。UI の規則に揃えた: 種別は作るときだけ、種別プロパティ・system は書かない、edge の種別は候補に従う。node の大きさの定数を `nodeGeometry.ts` に分けた (`graphTransform.ts` は React Flow を読むため) |
| M3 | 済 | `mcp.ts` (道具 13: whoami・list_files・accept_invitation・read_file と書く道具 9)、`dataDirLock.ts` (置き場所の lock、落ちたプロセスの lock は取り直す)。in-memory の SDK client で一周 (`mcp.test.ts`)、本物の起動の形で stdio (`mcpStdio.test.ts`: 標準出力が汚れない・閉じればプロセスが終わり lock を放す)、App の alice の画面まで (`headlessInterop.app-test.tsx`)。**完了基準 1〜4 を満たす**。metagraph の Sheet には書かせない (画面は編集を読み替えていて、道具にはそれが無い) |
| M4 | 済 | 手順を `user-test-environment.md` §5.6 に書いた。開発用の PDS で: **段 2 の OAuth の不具合を見つけて直した** (戻すときの client の戻り先がログインのときと違い、loopback の client_id がずれて token の更新が断られ、セッションが消えていた。access token が切れるまで表に出ない)。ログインし直し、強制の更新を別プロセスで 2 回通した。stdio の MCP server で whoami・list_files (新しい端末でも参加している File を見つける)・read_file が通った。Claude Code に登録して例題を作り、App の画面に出ることを**利用者が確かめた (2026-11-08、完了基準 5)** |

**段 3 の完了基準はすべて満たした。**

## 5. 決めたこと

- 書く経路は段 2 と同じく **GraphEvent** だけ
- **種別は node・edge を作るときにだけ付ける** (UI と同じ。`node.setLabel` の道具は出さない)。
  道具は UI ができないことをしない (設計 §1.1)
- 読むたびに `sync` してから encoding する (段 3 は呼ばれたら同期する。常駐は段 5)
- 認証は段 2 の loopback OAuth。ログインは CLI (`cli.ts login`) で済ませておき、MCP server は
  `resume` だけする (stdio の server はブラウザの同意を待てないため)
