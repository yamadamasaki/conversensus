# issue の候補 — v1.0.0 の後 (2026-10-05)

> v1.0.0 (FPR) の後は issue で進める。**A・B・C は GitHub Issues に起こし (ラベル `Step3Refinement`)、D はこの文書に置き、E の提案どおり既存の issue を整理した** (利用者 2026-10-05)。
> 出所: [step3 計画 §6 (FPR の後)](../plans/step3-implementation.md)、各 Phase の未決 (U)、
> [FPR の確認](../plans/step3-fpr-check.md) と [FPR 前の作業](../plans/pre-fpr-local-actor.md) で見つかったもの、
> [UI/UX review](./ui-ux-review-v1.0.0.md)。
>
> ラベルの案: 種類は既存の `Feature` / `Improvement` / `bug` / `refactoring` / `documentation`、まとめは新しく
> `Step3Refinement` (step1 の `Step1Refinement` に倣う)。「既存」の列は、既に開いている issue と重なるもの。

## A. 機能 (step3 計画の「FPR の後」)

| # | 題 | 種類 | 既存 | 一言 |
| --- | --- | --- | --- | --- |
| A1 | timeline view (version tree・operation inspector・change inspector) | Feature | #73 | 右サイドバーの pane。グラフ view のアドレス (Phase 3) の上に乗る |
| A2 | global search (File・Sheet・Folder を串刺しに) | Feature | | 今はシートの中だけ |
| A3 | 左サイドバーの File・Sheet・Folder 名の検索 | Feature | | design language の左サイドバー |
| A4 | map 表示の on/off | Improvement | #182 | design language のヘッダ |
| A5 | 無限キャンバス | Feature | | design language のボディ |
| A6 | i18n (en を足す) | Improvement | #50 | 言葉の表 (C9) が下ごしらえになる |
| A7 | Deep Link の URI スキーム | Feature | | アドレス (Phase 3) を外から開く |
| A8 | Jetstream による近リアルタイム化 | Feature | | 今は 30 秒のポーリング |
| A9 | デザイン言語の細部の適用 | Improvement | | → C 群に分けた |

## B. 直す・詰める (見つかったもの)

| # | 題 | 種類 | 出所 | 一言 |
| --- | --- | --- | --- | --- |
| B1 | 未ログインの File は、送らないと答えても名前と最初のシートがログインで送られる | bug | FPR 前 L-1 | genesis を送る経路が答えを見ていない |
| B2 | `scripts/inspect-remote-batches.ts` が op-log v2 から動かない | bug | FPR の確認 | 手順書 §5・§6 が使っている |
| B3 | conflict list に、node と一緒に消えた edge が出ない | Improvement | FPR の確認 §2.2 | 取り込めば戻るので、表示に足すかは使ってから |
| B4 | Toulmin の template graph の edge の label が重なる | Improvement | FPR の確認 §3 | |
| B5 | File を開いたとき・右サイドバーの開閉・metagraph に node を足したときに、表示がグラフからずれる | Improvement | review / FPR の確認 §4 | |
| B6 | graph node (metagraph) を F2 で編集すると「ラベル」の口が出る | bug | FPR の確認 §4 | |
| B7 | 既読の record が溜まる / File を削除しても既読が消えない | Improvement | Phase 6 U1 | 設計 §2.1 の片付けが未実装 |
| B8 | 背後のタブの File の通知 | Improvement | Phase 3 の積み残し | 今はその File を開いたときに出る |
| B9 | 発番器の窓 2 つ (開いてから最初の受信まで / File を開かずに判断を書く) | bug | Phase 5 S5-3 | 同じ点の重複は直したが窓が残る |
| B10 | service worker の更新の出し方 (新しい版が来たとき、開いているタブをどうするか) | Improvement | Phase 2 U2 | 今は再読み込みで新しい版 |
| B11 | Safari の `persist()` と ITP による保存領域の消去 | Improvement | Phase 2 U1 | 実機で長く置いて見る |
| B12 | 既に壊れて保存された画像の参照の救済 | bug | FPR の確認 §2.1 | 受け直す口 (保存領域を消さずに) |
| B13 | テストの `mock.module` の漏れ (順序依存) | refactoring | 計画 U6 | `--randomize` で落ちる |

## C. UI/UX ([review](./ui-ux-review-v1.0.0.md) から)

| # | 題 | 種類 | 一言 |
| --- | --- | --- | --- |
| C1 | **design language に見た目の体系を足す** (色の役割・文字の段・余白・アイコン・状態・ダイアログ・言葉・グラフの描き方) | documentation | review §3。**C2 以下の前提**。色の役割とグラフの描き方を最優先 |
| C2 | 色を役割の変数にまとめる (design token) | refactoring | 直書きの色 46 種類 |
| C3 | ボタン・アイコンを 1 つの集にそろえ、ラベルか tooltip を必ず持たせる | Improvement | 記号だけの操作。iOS では hover が無い |
| C4 | ヘッダの「グループ化 / 解除」を選択に応じて無効にする | Improvement | 常に青い |
| C5 | metagraph の印を `⌘` から変える | Improvement | Command キーに読める |
| C6 | 設定のポップアップの「保存」→「OK」、破壊的な「削除」を離す | Improvement | design language にあって未実装 |
| C7 | node の接続点を hover / 選択のときだけ出す、選んでも中身を動かさない | Improvement | |
| C8 | コントラストが AA に届かない文字・アイコンを直す | Improvement | ⚙ 1.67 など |
| C9 | 言葉の表 (glossary) と「クラウド」の言い換え | documentation | design language が既に指摘 |
| C10 | ダイアログの型をそろえる | refactoring | 4 種類が少しずつ違う |
| C11 | ヘッダに開いているグラフの名前と状態 (trunk / branch / 未コミット) | Improvement | |
| C12 | タブの溢れ方とアクティブなタブの見分け | Improvement | |
| C13 | 小さい画面 (iPhone / iPad) での並べ方 | Improvement | |
| C14 | 空の状態の案内 | Improvement | |

> **#173 (本体画面の既定のフォントをもっと小さく) との関係**: #173 はキャンバスの node の文字の話、review の
> 「文字が小さい」はサイドバー・ヘッダの話で、向きが逆に見えるが場所が違う。C1 の文字の段で一緒に決める。

## D. 仕様・設計で決めること (issue にせず、ここを置き場にする — 利用者 2026-10-05)

機能に取りかかるときに、関わるものをその設計の文書で決める。

| # | 題 | 出所 |
| --- | --- | --- |
| D1 | deps の大きさと、使われなくなった actor の退役 | Phase 1 U1・U2、計画 U1 |
| D2 | 歯抜けの先に届いた batch の扱い | Phase 1 U3 |
| D3 | 選択の正 (view の state か React Flow か) | Phase 3 U1 |
| D4 | 背後のタブの数の上限 | Phase 3 U2 |
| D5 | 過去の切断面の view の入口 | Phase 3 U3 (→ A1) |
| D6 | template graph の property の型 | Phase 4 U1 |
| D7 | template graph の自分自身への適用 | Phase 4 U2 |
| D8 | 適用先を新しい切断面へ上げる操作 | Phase 4 U3 |
| D9 | merger の 3 pane の詰め方 | Phase 5 U1 |
| D10 | 競合の「差異」の見せ方 | Phase 5 U3 |

## E. 既に開いている issue の扱い (提案)

| issue | 題 | 提案 |
| --- | --- | --- |
| #72 | アカウントを File に招待する | **閉じる** (step2 で実装済) |
| #60 | コンフリクト解決メカニズム (LWW / 明示的投票) | **閉じる** (競合の 3 段構え・merger で実装。投票は #99 の側) |
| #82 | 3-way merge による非破壊マージ戦略 | **閉じる** (分岐点の vector と merger で実装) |
| #96 | Node と Edge に properties を定義できる | **閉じる** (step2 Phase 4 の property editor) |
| #73 | バージョン・グラフを可視化する | A1 に使う |
| #182 | map の移動・on/off | A4 に使う |
| #50 | i18n | A6 に使う |
| #173 | 既定のフォントを小さく | C1 と一緒に |
| #181・#120・#99・#98・#100・#101・#103・#28 | | 触らない (残す) |
