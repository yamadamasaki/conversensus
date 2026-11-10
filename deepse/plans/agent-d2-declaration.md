# agent の宣言 (設計 D2、実装計画)

> 設計: [agent-actor.md](../architecture/step4/agent-actor.md) D2 (A3・A7)。次は #354 (D2a、書いた人の avatar)。
> branch: `step/agent-d2`。

## 1. 目標と完了基準

DID が **agent であり、誰のものか**を、agent 自身の宣言と operator の裏付けから示す。表示にだけ使い、conversensus の
振舞いは変えない (設計 §1.1)。

**完了基準**:

1. agent は自分の repo に宣言 (`app.conversensus.v2.agentProfile`: operator の DID・model・説明) を書ける
   (CLI `cli.ts profile`)
2. operator (人間) は App の参加者一覧で、自分を operator と名乗る agent を「自分の agent と認める」
   (`app.conversensus.v2.operatedAgent`、rkey = agent の DID) ことができ、取り消せる
3. 参加者一覧で、agent の行に印が出る。宣言と裏付けが**互いを指していれば**「裏付けあり」、宣言だけなら
   「名乗りのみ」。operator と model も出す
4. 判定の規則 (宣言・裏付けの組み合わせ → 状態) は純粋な関数で、全称命題は性質で確かめる
5. 開発用の PDS で、agent が宣言し、人間が認め、参加者一覧に「裏付けあり」が出ることを手で確かめる

**非目標**: node・edge の avatar (#354)、宛先の選択・知らせなど他の画面での印 (#354 と一緒に揃える)、
agent の振舞いを宣言で変えること。

## 2. 決めたこと (利用者 2026-11-10、推奨案)

- 裏付けは **App の参加者一覧で認める** (取り消しも)。agent の宣言は CLI で書く
- 表示は **参加者一覧に印**。他の画面は #354 と一緒に揃える

## 3. 形

| record | 置く repo | rkey | 中身 |
| --- | --- | --- | --- |
| `app.conversensus.v2.agentProfile` | agent | `self` (1 つだけ) | `operator: Did`、`model?: string`、`description?: string` |
| `app.conversensus.v2.operatedAgent` | operator | agent の DID | `agent: Did` |

- 状態 (`agentStatusOf`): 宣言が無い → `none`、宣言があり operator の repo に宣言を指す裏付けがある → `verified`、
  宣言だけ → `claimed`。裏付けだけ (agent が名乗っていない) は `none` (人間を勝手に agent と呼ばない)
- 読むのは表示のときだけ。DID ごとに覚えておき (`handleLabels` と同じ構え)、認めた・取り消したときは忘れて読み直す

## 4. スライス

| | 内容 | 確かめ方 |
| --- | --- | --- |
| A1 | record の型と判定 (`agentStatusOf`)、collection (書く・読む・消す) | 単体 + 性質 |
| A2 | CLI `cli.ts profile --operator <handle> [--model] [--description]` と `whoami` に宣言を出す | 単体 (偽の PDS) |
| A3 | App: 参加者の宣言を読む (覚えておく)。参加者一覧に印・operator・model。自分が operator と名乗られていれば「自分の agent と認める」/ 認めていれば「認めるのをやめる」 | 単体・App 結合 (偽の PDS で agent が宣言 → alice が認める → 裏付けあり) |
| A4 | 開発用の PDS で手で確かめる。`user-test-environment.md` に手順 | 利用者 |

### 4.1 進捗

| | 状態 | メモ |
| --- | --- | --- |
| A1 | 済 | shared の `events/agentDeclaration.ts` (`AgentProfileSchema`・`OperatedAgentSchema`・`agentDeclarationOf`)。client の NSID 2 つと `agentRecords` (書く・読む・消す。読めなければ undefined)。性質は「裏付けあり ⇔ 互いを指す」 |
| A2 | 済 | `Headless.declareAgent` (operator はハンドル名か DID) と `agentDeclaration`。client の `readAgentDeclaration` (宣言の operator の repo からだけ裏付けを読む) と、覚えておく入れ物 `createAgentDeclarationCache`。CLI `profile [<operator>] [--model] [--description]`、`whoami` にも宣言を出す |
| A3 | 済 | `useAgentDeclarations` (参加者一覧が開いている間だけ読む。認めた・やめたときは忘れて読み直す)。参加者一覧 (`InvitationDialog`) の参加者の欄に印 (名乗りのみ / 裏付けあり)・operator・model、自分を operator と名乗る agent に「自分の agent と認める」/「認めるのをやめる」。**一覧を閉じたら覚えた宣言をすべて忘れる** (覚えたままだと、開いた後に agent が書いた宣言が再読み込みまで出なかった。全試験を 1 つのプロセスで走らせたときに、前の試験が覚えた「agent ではない」が残って見つかった)。失敗したら知らせる。App 結合で agent の宣言 → 名乗りのみ → 認める → 裏付けあり → やめる を一周 |
| A4 | | |
