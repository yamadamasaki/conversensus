# node の操作と、依頼の module 化 (計画の草案)

> 設計: [agent-actor.md](../architecture/step4/agent-actor.md) D6・D7・D8・D11・D12。
> 前の段: [agent-stage4-request.md](agent-stage4-request.md) (PR #361)、[agent-stage5-resident.md](agent-stage5-resident.md) (PR #362)。
> branch: `step/node-actions` (計画の草案は `docs/node-actions-plan` で書き、そのまま引き継いだ)。
> 状態: **段 A・段 B 完了** (2026-11-10)。§5 の問い 4 つは利用者が答えた (すべて推奨案)。段 C (repo の外から読み込むプラグイン) は後に回す。

## 1. 目的

利用者の言葉 (2026-11-09):

> 今は property pane に「送る」ボタンなどを入れていますが, これは UI としてはちょっとごちゃついていると思います.
> ボタンなどは node 側に持っていき, そこから必要ならば dialog で引数に相当するもの (値としては property に入っていてよい) を設定して, 実行, という流れにしたい.
> これは, 「依頼」はこの先 module 化して core からは切り離したい (最終的にはプラグイン化したい) ということとも関係しています.

この計画の目的は 2 つあり、同じ作業で両方を進める。

1. **画面**: node への操作 (送る・閉じる・答える …) を node のそばに出す。引数の要る操作は
   dialog で引数を決めてから実行する。property の欄は種類に依らない汎用の編集の場所に戻す
2. **境目**: 「node に操作がある」ことを core の汎用の拡張点にする。依頼はその拡張点の最初の利用者として
   module に切り出す。依頼の知識が core から無くなれば、最終的にプラグインにする道が開く

2 は 1 の作り直しで自然に出てくる。操作を node に出す仕組みを依頼専用に作ると、境目がもう一度ずれる。

## 2. 今の形 (事実)

| # | 事実 | 帰結 |
| --- | --- | --- |
| F1 | 依頼の操作は右の欄の区画 `RequestPanel.tsx` にある。区画には、状態・宛先 (足す・外す)・送る・送り直す・閉じる・開き直す・答え (textarea) が並ぶ。property の表はこの区画の下に出る | 選んでから右の欄へ目を移さないと押せない。依頼の node を選ぶたびに、property の欄の上半分を依頼が占める |
| F2 | 操作の判断は `request/requestTarget.ts` (状態の計算・`RequestAction` を GraphEvent にする) と `request/requestEvents.ts` にある。`GraphEditor` の `applyRequestAction` が dispatch する (undo・redo できる) | 判断は既に画面から分かれている。**移すのは「どこに出すか」と「誰が登録するか」**だけでよい |
| F3 | node の上の状態の印は `graph/RequestBadge.tsx`。`EditableNode` が `isRequestNode` を見て描く | core の node 部品が依頼を名指しで知っている。印の口を汎用にする |
| F4 | 依頼の知識は client の画面だけではなく、5 か所に散っている (下の表) | 一度に全部を切り離すのは大きい。段に分ける (§4) |
| F5 | 依頼の 4 つのシステム・プロパティは core の名前空間 `app.conversensus.` を使う (`addressee`・`sent`・`closed`・`answers`)。D6 は「core が知るのは応答を求める node だけ」と決めている | module に移すなら、**D6 の決定を改める**ことになる (core は応答を求める node も知らなくなる)。名前空間も問いになる (Q3) |
| F6 | 本番の v1.3.0 には依頼が入っていない (依頼は v1.3.0 の後の段 4)。依頼のデータがあるのは開発用の PDS だけ | 名前を変えるなら、今が最も安い。リリースの後は、op-log に残った古い名前を読み続けることになる |
| F7 | React Flow 12.12 に `NodeToolbar` がある (選んだ node の上下に浮かぶ部品)。edge には右クリックのメニュー (`EdgeContextMenu`) が既にある。dialog の部品 (`InputDialog`・`ConfirmDialog` …) もある | node のそばに出す部品は作り込みのもので足りる |
| F8 | MCP には依頼専用の道具 5 つ (`list_requests`・`send_request`・`answer_request`・`close_request`・`reopen_request`) がある。常駐の agent (`resident/`) は `requestsForMe` を使う | 画面の操作を宣言にしておくと、MCP の道具も宣言から作れる (Q2)。agent と人間が同じ操作を使う (設計 §1.1) |

依頼の知識が今ある所:

| 層 | 所 | 中身 |
| --- | --- | --- |
| shared | `events/request.ts` | システム・プロパティ 4 つ、状態の導出 (D8)、`requestsInFile`・`isAddressedTo` |
| shared | `template/request.ts`・`registry.ts`・`seedLocale.ts` | 依頼・相談の template の種 |
| client | `request/`・`RequestPanel.tsx`・`graph/RequestBadge.tsx`・`EditableNode.tsx`・`GraphEditor.tsx`・`editorControls.ts`・`RightSidebar.tsx` | 操作・区画・印 |
| client | `sync/requestArrival.ts`・`RequestNotice.tsx`・`hooks/useNoticeInbox.ts`・`notices/noticeKeys.ts` | 届いた依頼の通知 (D11) |
| client | `i18n/ja.ts`・`en.ts` の `request` | 文言 |
| headless | `headless.ts` (`requestsForMe`)・`mcp.ts`・`encoding.ts` | MCP の道具、`read_file` の注釈 |
| headless | `resident/` | 常駐の agent (見つけて起動する) |

## 3. 方針 (案)

### 3.1 画面: 操作は node のそばに、引数は dialog で

- node を **1 つ**選ぶと、その node に使える操作が node のそば (`NodeToolbar`) に並ぶ。
  右クリックのメニューにも同じ操作を出す (Q1)
- **できない操作は出さない** (段 4 R4 の規則をそのまま持っていく)。見るだけの所 (branch の閲覧・
  merger の passive pane・`readOnly`) では何も出さない
- 引数の要る操作は、押すと dialog が開く。dialog で引数を決め、「実行」で op を記録する。
  **引数の値は property に入る** (宛先なら `addressee`、答えの置き場所なら `answerTarget`)。
  次に dialog を開くと、前の値が入っている
- 実行は今までどおり dispatch を通す (undo・redo できる)。property の書き込みと操作の op は
  1 回の undo で戻るように、**1 つの GraphEvent にまとめる** (N2 で決めた。event の店は event 1 つを
  undo 1 回として積み、複数の event をまとめて戻す仕組みを持たない)
- **答え**は property ではない。答えは新しい node なので、答えの dialog の入力は本文である
- 状態 (下書き・送った・回答あり・閉じた) は、今の印 (`RequestBadge`) のまま node の上に出す。
  property の欄からは依頼の区画を外す。システム・プロパティの生の値は #357 (read-only の property を
  見せるトグル) で確かめる

依頼の操作は次の形になる (案):

| 操作 | 出る状態 | dialog | 記録するもの |
| --- | --- | --- | --- |
| 送る | 下書き | 宛先 (参加者から複数選ぶ・空 = 誰でも)、答えの置き場所 | `addressee`・`answerTarget` を書き、`sent` を 1 増やす |
| 送り直す | 送った・回答あり | 同上 (前の値が入っている) | 同上 |
| 閉じる | 送った・回答あり | なし | `closed` |
| 開き直す | 閉じた | なし | `closed` を外す |
| 答える | 送った・回答あり | 答えの本文 | 答えの node と、`answers` の付いた edge |

宛先を変えるだけの操作は無くす。宛先は送るときに決めるもので、送らずに宛先だけを変えても
誰にも届かないからである。下書きのうちに宛先だけを決めて残す手段が要るかは §7 に書いた。

### 3.2 境目: node の操作を core の拡張点にする

core (shared・client) は「node に操作がある」ことだけを知り、どんな操作があるかは module が登録する。

```ts
/** module が登録する、node への操作 1 つ (案) */
type NodeAction = {
  id: string;                       // module の中で一意 ('request.send' など)
  label: (locale) => string;
  /** この node に今使えるか (使えなければ出さない) */
  available: (ctx: NodeActionContext) => boolean;
  /** 引数の宣言。core が dialog を描く (Q2)。無ければ押してすぐ実行 */
  params?: readonly ActionParam[];
  /** 引数の初期値 (property から読む) */
  initial?: (ctx: NodeActionContext) => ActionArgs;
  /** 実行: GraphEvent 1 つにする (今の requestEventFor に当たる。1 つ = op の batch 1 つ = undo 1 回) */
  run: (ctx: NodeActionContext, args: ActionArgs) => GraphEvent;
};

/** 引数の型は小さく保つ: 参加者 (複数)・選択肢・本文 */
type ActionParam =
  | { name: string; kind: 'actors'; label }
  | { name: string; kind: 'choice'; options; label }
  | { name: string; kind: 'text'; label; multiline?: boolean };

/** module: 操作と、node の上の印と、template の種と、文言 */
type NodeModule = {
  id: string;
  actions: readonly NodeAction[];
  badge?: (ctx) => Badge | undefined;   // 印も宣言 (文言と色の段階) にする案
  templates?: readonly TemplateSeed[];
  messages?: Record<Locale, …>;
};
```

- `NodeActionContext` は、node・Sheet (edge を含む)・自分の DID・File の参加者・`readOnly` を持つ。
  **module は React Flow も store も触らない** — 渡された値を読み、GraphEvent を返すだけにする。
  そうすれば同じ module を headless でも使える
- 登録は App の入口 (`main.tsx`) が行う。**core は module を import しない**。向きを機械的に確かめる (Q4)
- 印も宣言にする。core の `EditableNode` は「登録された印を描く」だけになり、`isRequestNode` を名指ししない

### 3.3 段に分ける

| 段 | 中身 | core に残る依頼の知識 |
| --- | --- | --- |
| **A (この計画)** | 拡張点 (操作・印・template の種・文言)、node のそばの操作と dialog、依頼を module へ (shared の導出・template の種・client の操作と印)。property の欄から区画を外す | 通知 (`requestArrival`・`RequestNotice`・`useNoticeInbox`) と headless (MCP・常駐)。**一覧にして B へ渡す** |
| B (次) | 通知の口 (受信から知らせを作る口)、MCP の道具の口、常駐の振る舞い | なし |
| C (いつか) | module を repo の外から読み込む (プラグイン)。読み込むコードの信頼・版の合わせ方 | — |

C は連合やライブラリ化 (#310) の後に考える。第三者のコードをブラウザと headless の両方で動かすので、
安全の問題が大きい。A と B は repo の中だけで閉じる。

## 4. 完了基準 (段 A、案)

1. node を 1 つ選ぶと、その node に使える操作が node のそばと右クリックのメニューに出る。
   できない操作は出さない。見るだけの所では出ない
2. 引数の要る操作は dialog で引数を決めて実行する。引数の値は property に入り、次に開くと前の値が入っている。
   実行は undo・redo できる (property の書き込みと操作の op を 1 回で戻す)
3. property の欄に依頼の区画が無い。property の欄は種類に依らない
4. 依頼は module にある。core (shared・client の module 以外) は依頼の module を import せず、
   それを試験か lint が確かめる。core に残る依頼の知識は §3.3 の表のものだけで、計画に一覧がある
5. 段 4・段 5 の App 結合 (alice が送る → agent が答える → 回答あり、逆向きも) が新しい画面で通る
6. 開発用の PDS で、人間が node のそばから送り、常駐の agent が答えるのを手で確かめる

**非目標**: 段 B・C の中身、依頼以外の module (sheet node・画像 …) を新しい拡張点に移すこと、
`answerTarget` の `newSheet`・`newFile` (選択肢には出すが、選べるのは今までどおり `linkedNode` だけ)、
操作のキーボード・ショートカット。

## 5. 問い

**決めたこと (利用者 2026-11-09、すべて推奨案)**:

- Q1: 選んだ node の上に `NodeToolbar`、同じ操作を右クリックのメニューにも出す
- Q2: module は引数を宣言し、core が dialog を描く
- Q3: システム・プロパティを module の名前空間 (`app.conversensus.request.*`) へ移す
- Q4: 新しい workspace の package `src/modules/request` (`@conversensus/request`)

### Q1. 操作をどこに出すか

| 案 | 中身 | 良い所 | 気になる所 |
| --- | --- | --- | --- |
| **a (推奨)** | 選んだ node の上に `NodeToolbar`、同じ操作を右クリックのメニューにも | 見つけやすい。iPad (右クリックが無い) でも使える。メニューは edge と揃う | node の上に部品が浮くので、隣の node や edge の取っ手と重なりうる |
| b | 右クリックのメニューだけ | 画面が静か | 見つけにくい。touch で出しにくい |
| c | `NodeToolbar` だけ | 単純 | edge の右クリックと揃わない |

### Q2. 引数の dialog を誰が描くか

| 案 | 中身 | 良い所 | 気になる所 |
| --- | --- | --- | --- |
| **a (推奨)** | module は引数を**宣言**し (参加者・選択肢・本文の 3 つの型)、core が dialog を描く | module が React を持たない → headless でも同じ module が使え、**MCP の道具を宣言から作れる** (agent と人間が同じ操作、§1.1)。見た目が揃う。プラグインのとき安全 | 宣言にない型の引数が要る module は、型を足すまで作れない |
| b | module が dialog の React 部品を持つ | 何でも描ける | module が client に縛られる。プラグインで任意の部品を動かすことになる |

### Q3. システム・プロパティの名前空間

| 案 | 中身 | 良い所 | 気になる所 |
| --- | --- | --- | --- |
| **a (推奨)** | module の名前空間に移す: `app.conversensus.request.addressee` など | core の名前空間 (`app.conversensus.`) が core のものだけになる。依頼のデータは開発用の PDS にしか無いので、今なら移すのが安い (F6) | 開発用の PDS の古い依頼は、依頼として読めなくなる (ふつうの property として残る) |
| b | 今の名前のまま | 何も変えなくてよい | module のデータが core の名前で書かれ続ける。リリースした後は変えられない |

`answerTarget` (template のふつうの property) は今のままにする。

### Q4. module の置き場所と、向きの確かめ方

| 案 | 中身 | 良い所 | 気になる所 |
| --- | --- | --- | --- |
| **a (推奨)** | 新しい workspace の package `src/modules/request` (`@conversensus/request`)。core の package は依存に持たない | **向きを package の依存で強制できる** (core から import すると解決できない)。段 C の形に近い | package を 1 つ足す (tsconfig・試験の設定) |
| b | 各 package の中の directory (`client/src/modules/request` など) + lint の import 制限 | 足すものが少ない | 向きを lint の規則で守ることになる。module が 3 か所に割れる |

## 6. スライス (段 A)

| | 内容 | 確かめ方 |
| --- | --- | --- |
| N0 | 設計 D6 の改訂を `agent-actor.md` に書く (core は応答を求める node を知らず、module が知る)。Q3 が a なら名前空間も | 文書 |
| N1 | **拡張点** (shared・client): `NodeAction`・`ActionParam`・`NodeModule` の型、登録、「この node に使える操作」の計算 (純粋関数) | 単体。性質: 使えない操作は出ない・`readOnly` では空 |
| N2 | **node のそばの操作と dialog**: `NodeToolbar` と右クリックのメニュー、宣言から dialog を描く、property の書き込みと op をまとめて dispatch | 単体 (dialog)・App 結合 (選ぶと出る・実行すると op になる・undo で戻る) |
| N3 | **依頼を module へ**: shared の導出・template の種・操作・印・文言を移して登録する。`RequestPanel` と区画、`EditableNode` の名指しを外す | 単体 (今の `requestEvents`・`requestTarget` の試験を移す)・App 結合 |
| N4 | **向きの確かめ**: core が module を import しないことを確かめる。core に残る依頼の知識を一覧にする (段 B へ) | 試験か lint |
| N5 | 段 4・段 5 の App 結合を新しい画面で通す。`user-test-environment.md` の手順を直す | App 結合 (完了基準 5) |
| N6 | 開発用の PDS で手で確かめる | 完了基準 6 (人間が確かめる) |

### 6.1 進捗

| | 状態 | メモ |
| --- | --- | --- |
| N0 | 済 | 設計 D6 (module が知る)・D7 (宛先などは「送る」の dialog で選ぶ)・D12 (ボタンは node のそばと右クリック) を改めた。名前を `app.conversensus.request.*` に移した (`REQUEST_PROPERTY_PREFIX`)。本体に同梱する module なので system の名前の下に置き、property の欄・検索・`set_property` からは見えないままにした。古い名前は読み替えない (データは開発用の PDS だけ) |
| N1 | 済 | `client/src/nodeActions/` (`nodeAction.ts` の型・`registry.ts`)。module は宣言と純粋な関数だけで、React を持たない。文言は言語ごとの `LocalizedText` を module が持つ。鍵は `<module>/<action>`。`runNodeAction` は直前に確かめ直し、引数を宣言どおりに確かめる (宣言に無い名前は断る)。module の関数が投げてもその操作・印を無いものとして扱い、画面を落とさない。置き場所は client (GraphEvent が client にあり、headless も client を読むため)。性質 3 つは、壊し方 2 つで落ちることを確かめた |
| N2 | 済 | `useNodeActions` (選択・右クリック・dialog の state と実行)、`NodeActionBar` (`NodeToolbar`、`nodrag nopan` — 付けないと押しただけで canvas が動き出す)、`NodeActionMenu`、`NodeActionDialog` (宣言から描く・前の値・理由を中に出す)、`flowContext` (ゴーストを数えない)。module は `NodeActionsProvider` で降ろす (既定は module 無し)。`GraphEditor` は `actionEnv` (自分の DID・File の参加者) を App から受ける。**`run` は GraphEvent 1 つを返す形に改めた** (event の店に複数をまとめて戻す仕組みが無い)。App 結合は試験用の module で、選ぶと出る・押すと op-log・使えなくなった操作が消える・undo 1 回・dialog の前の値・右クリック・module 無しでは出ない。縮小が小さいときに出さない件 (§7) はまだ — N5 の実機で見る |
| N3 | 済 | package `src/modules/request` (`@conversensus/request`)。`requestModule.ts` (送る・送り直す・答える・閉じる・開き直す と印) と、client から移した `requestEvents.ts`。「送る」は宛先・答えの置き場所・送った回数を 1 つの event に書く (`sendRequest` の options)。`RequestActionError` は `NodeActionError` の一つにした (dialog に理由が出る)。右の欄の区画 (`RequestPanel`)・`RequestBadge`・`requestTarget`・`GraphEditorControls.request` を外した。印は core の `NodeBadges` が描く (印を持つ module が無ければ store を読まない)。**拡張点を 2 つ改めた**: 文脈に操作する人の言語 (`locale`、答えの edge の label に要る)、印の文脈は node と出ていく edge を引く関数だけ (すべての node について呼ばれるので)。実行の後に対象の node を選び直す (答えると選択が外れていた)。module の登録は `main.tsx` だけ。依頼の App 結合 (`request.app-test`、`headlessInterop` の依頼の 2 本 → `agentRequest.app-test`) は module へ移し、node のそばの操作と dialog で書き直した。client の package は入口のために `@conversensus/request` を依存に持つ — 向きは N4 で lint が守る |
| N4 | 済 | biome の `noRestrictedImports` を shared と client に掛け (`overrides`)、`@conversensus/request`・`@conversensus/request/**`・相対の `**/modules/**` を断る。`src/client/src/main.tsx` だけを外す。headless は module を使う側 (入口と同じ) なので掛けない。わざと違反する file を client と shared に置き、package 名でも相対の道でも lint が落ちること、入口と headless は通ることを確かめた。段 A を終えても core に残る依頼の知識 (段 B へ): shared の `events/request.ts` (システム・プロパティと状態の導出)・`template/request.ts` と種の登録・`seedLocale.ts`、client の `sync/requestArrival.ts`・`RequestNotice.tsx`・`hooks/useNoticeInbox.ts`・`notices/noticeKeys.ts`・辞書の `request.notice`、headless の `requestsForMe`・`mcp.ts` の依頼の道具・`encoding.ts` の注釈・`resident/` |
| N5 | 済 | N3 と一緒に済ませた: 段 4・段 5 の App 結合 (1 人の一周・2 人の通知・agent との行き来・常駐の agent) を node のそばの操作と dialog で書き直して module へ移し、すべて通る。`user-test-environment.md` §5.7・§5.8 の手順を node のそばの操作に直した |
| N6 | 済 | 利用者が開発用の環境で確かめた (2026-11-09)。直した後の undo (答えが届いた後でも回答ありが減らない) も確かめた。**段 A の完了基準はすべて満たす**: node の上の操作は隣の node や edge の取っ手と重ならない。縮小しても操作の大きさは変わらない (`NodeToolbar` は拡大縮小の外に描く。読めて押せるので、このままにする — §7 の「縮小が小さいときに出さない」は要らない)。押しても canvas や node は動かない。**見つかったこと**: 答えを受け取った後に undo すると、手元の「送る」だけが戻り、届いた答えが前の送信への答えになって回答ありから外れた。→ 操作に `undoable` を足し、「送る」「送り直す」を undo に積まないようにした (相手に届く行為。やめるなら閉じる)。event の店に「記録するが undo に積まない」口 (`DispatchOptions`) を足した。undo は送信を飛ばしてその前の操作を戻す (node を作ったことなど)。常駐の間に File に参加する手順を `user-test-environment.md` §5.8 に書いた |

## 7. 気になること

- **`NodeToolbar` の重なり**: 実機では重ならなかった (N6)。縮小しても操作の大きさは変わらない
- **dialog を開いたまま他の人が書いた場合**: 実行の直前に `available` を確かめ直す。使えなくなっていれば
  実行せずに知らせる (常駐の dispatch の「起動の直前に確かめ直す」と同じ構え)
- **送る dialog を取り消したときの宛先**: 宛先は property なので、取り消せば書かない。下書きのうちに
  宛先だけを決めて残す手段は無くなる。困るなら「保存だけ」のボタンを dialog に足す
- **文言の持ち主**: 今 `t.request` は core の辞書にある。module が自分の文言を持つ形にする。
  i18n の型付きの辞書 (#50) の構えを module にも効かせる方法は N1 で決める

## 8. 段 B: core に残った依頼の知識を外す

> branch: `step/node-actions-b`。段 A は PR #363 で merge 済。利用者の決定 (2026-11-09): **段 B まで行い、段 C
> (repo の外から読み込むプラグイン) は後に回す**。その後は agent の宣言 (D2) と #354〜#357 に戻る。

### 8.1 目標と完了基準

段 A の N4 の行に並べた「core に残る依頼の知識」を、それぞれ core の汎用の口に置き換え、依頼の module から入れる。

1. shared・client (入口 `main.tsx` を除く) に依頼の知識が無い。`events/request.ts`・`template/request.ts` は module にあり、
   lint (N4 の規則) がそれを守る
2. **通知の口**: 受信から知らせを作るのは module (`NodeModule.notices`)。core は知らせを並べ、開く・閉じる・既読を持つ
3. **種の口**: template の種 (依頼・相談) は module が出す (`NodeModule.seeds`)。core の種 (Toulmin) と並ぶ
4. **headless の口**: MCP の道具・`read_file` の注釈・常駐の振る舞いは module が出す (`HeadlessModule`)。headless の
   library は module を import せず、入口 (`mcp.ts`・`resident/resident.ts`) だけが選ぶ。**起動の command は変えない**
5. 段 A・段 5 の試験がすべて通り、開発用の環境で依頼の一周 (人間どうし・agent・常駐) が今までどおり動く

**非目標**: 段 C、依頼以外の機能の module 化 (Toulmin の種は core に残す)。

### 8.2 方針

- 通知は今の配線 (`receiveParticipantBatches` → `fileSession` → `useEventSyncTap` → `useFileSheetOperations` →
  `useNoticeInbox` → `RequestNotice`) を、依頼の型 (`RequestArrival`) から汎用の型 (`ModuleNotice`) に替える。
  見つける関数 (module の `notices.detect`) は App が registry から渡す
- headless は host (アプリの入口と同じ立場) だが、library と入口を分ける。library (`mcpServer.ts`・常駐の汎用の部分) は
  module を知らず、入口だけが module を選ぶ。lint の規則を headless の library にも掛ける
- 常駐の振る舞いのうち依頼に固有のもの (依頼を数える `dispatch`・`claude -p` に渡す prompt・`requestsForMe`) は module へ。
  汎用のもの (同期し続ける `watch`・流れ・HTTP の MCP・`claude -p` の起動) は headless に残す

### 8.3 スライス

| | 内容 | 確かめ方 |
| --- | --- | --- |
| B1 | **通知の口** (client): `ModuleNotice`・`notices.detect`。依頼の到着の検出と文言を module へ。通知の欄を汎用にする | 単体 (検出は module へ移す)・App 結合 (依頼が届く) |
| B2 | **種の口**: `NodeModule.seeds` (種・並べ方・訳)。Sidebar・App は registry の種と core の種を並べる | 単体・App 結合 (「+ 依頼・相談 を追加」) |
| B3 | **headless の口**: `HeadlessModule` (MCP の説明・道具・node の注釈)。`createMcpServer` を `mcpServer.ts` へ分け、入口 `mcp.ts` が依頼の module を渡す。依頼の道具と注釈と `requestsForMe` を module へ | 単体 (MCP の試験を module へ) |
| B4 | **常駐**: 依頼に固有の部分 (`dispatch`・prompt) を module へ。`startResident` は汎用の「同期したら module に知らせる」にし、入口 `resident.ts` が依頼の module をつなぐ | 単体・App 結合 (常駐の agent) |
| B5 | **shared の依頼を module へ**: `events/request.ts`・`template/request.ts` (と訳) を移す。lint が core を守る | lint・typecheck・全試験 |
| B6 | 開発用の環境で、依頼の一周を手で確かめる | 利用者 |

### 8.4 進捗

| | 状態 | メモ |
| --- | --- | --- |
| B1 | 済 | `NodeModule.notices` (`NoticeSource`: 欄の名前・見出し・`detect`) と `ModuleNotice`。registry の `detectNotices` が module の順に集め、module の id を添える (既読の鍵 `noticeKeyOf` は `<module>/<鍵>`)。受信から App までの配線 (`receiveParticipantBatches` → `FileSession` → `useEventSyncTap`・`useFileSheetOperations` → `useNoticeInbox`) を `RequestArrival` から `ArrivedNotice` に替え、見つける関数は App が registry から渡す。`RequestNotice` は汎用の `ArrivedNotices` (module ごとに 1 つの欄)。依頼の到着の検出 (`requestArrival.ts`) と文言は module へ。辞書の `request.notice` は汎用の `notices` (開く・閉じる) に |
| B2 | 済 | 種は `TemplateSeed` (template・並べ方・訳) にまとめ、訳は種ごとに持つ (`seedLocale.ts` の表を外した)。core の種は `CORE_SEEDS` (Toulmin だけ)、module の種は `NodeModule.seeds` で registry の `seeds` に集まる。Sidebar は App から種を受け取る。依頼・相談の種 (`REQUEST_SEED`) は依頼の module が出す (表はまだ shared、B5 で移す)。試験の道具 `addRequestSheet` も module の `requestDriver` へ |
| B3 | 済 | `HeadlessModule` (説明・`registerTools`・`annotateNode`) と `McpKit` (server と共通の流れ: `write`・`guarded`・`where`)。`mcp.ts` を library `mcpServer.ts` (`createMcpServer(headless, modules)`) と入口 `mcp.ts` (依頼の module を選ぶ、起動の command は同じ) に分けた。`encodeFile` は node の注釈を module から受ける (`AnnotateNode`)。`Headless.requestsForMe` を外し、汎用の `batches` を足した。依頼の道具・注釈・`requestsForMe` は module の `requestHeadless.ts` へ、その試験も module へ。HTTP の MCP (`serveMcpHttp`) と試験の `connectMcp` は module を受ける。常駐は B4 までの間、module を直接使う |
| B4 | 済 | 常駐の loop を汎用の `startResident.ts` (同期し終えるたびに `ResidentWorker` に知らせる) にし、入口 `resident.ts` は `HEADLESS_MODULES` (stdio の入口 `mcp.ts` と同じ) の `resident` から worker を作る (起動の command は同じ)。`claudeRunner` は汎用の `AgentTask` (label と prompt) を起動する。依頼に固有のもの — `dispatch` (`requestDispatch.ts`、口は `JobRunner`)・`promptFor`・`jobsOf` — は module の `requestResident.ts` へ、試験も。lint の規則を headless にも掛け、入口 `mcp.ts` だけを外した (常駐の入口は `mcp.ts` の一覧を使うので module を直に import しない) |
| B5 | 済 | shared の `events/request.ts` を module の `requestNode.ts`、`template/request.ts` を `requestTemplate.ts` へ移し (試験も)、shared の index から外した。module の中の import は `requestNode` を指すように書き換えた。試験の道具 `requestAdded` も headless から module へ。core (shared・client・headless) のコードに依頼の識別子 (`app.conversensus.request`・`ADDRESSEE_PROPERTY`・`requestStatus` など) が残っていないことを grep で確かめ、lint が import の向きを守る。本番ビルドも通る |
| B6 | 済 | 利用者が開発用の環境で確かめた (2026-11-10): 依頼の種・人間どうしの送受と通知・Claude Code (stdio の MCP) からの答え・常駐の agent。**段 B の完了基準はすべて満たす** |
