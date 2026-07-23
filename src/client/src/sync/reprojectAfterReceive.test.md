# reprojectAfterReceive.test.ts — 受信後再 projection の安全判定のテスト仕様

## 何を

`reprojectAfterReceive` (受信着地後に再 projection し `activeFile` を差し替えてよいかの
判定層, step1 Phase 4e-3) を検証する。

## なぜ

画面反映 (4e 設計 §3.3) の不変条件は「**編集中の未 flush 状態を失わない**」。編集は
`activeFile` (React state) を進め、tap 経由で op-log へ**非同期に** flush される。
受信を機に再 projection した結果で `activeFile` を上書きするとき、op-log に載っていない
編集があると**その編集が画面から消える**。この関数が引き受ける順序保証
(drain → pending 確認 → 読取 → pending 再確認 → swap) が破れると、消えるのは
ユーザーの直近の編集そのものなので、機械的に固定する。

- **critic MED3**: `settled()` は**ローカル push 失敗時も resolve する** (drain は offline で
  throw しない)。「settled を待った = op-log が最新」ではない。pending 残数の確認が必須。
- **critic MED4**: drain → 読取 → swap の間に新規 record が入ると、その編集を含まない
  projection で上書きする。読取後の pending 再確認とリトライで塞ぐ。

## どのように

依存 (`settled` / `pendingCount` / `loadProjection` / `isEditing`) を注入し、pending の
呼び出し列を制御して検証する。React にも PDS にも依存しない純粋な単体テスト。

- **正常系**: drain 後 pending が空なら `swap` と projection を返す。読取前に必ず
  `settled()` を待つこと。
- **🔴 pending 残り (MED3)**: drain 後も pending > 0 なら `defer(pending-remains)`。
  読取すら行わない (projection しても使えない)。
- **レース (MED4)**: 読取後に pending が増えていたら drain からやり直し、静まった時点の
  projection で swap する。
- **レース打ち切り**: 編集が続く間はリトライ上限 (`maxAttempts`) で `defer(race-exhausted)`。
  差し替えないほうが安全 (次の受信契機が拾う)。
- **編集中 (§3.3 React Flow 整合)**: 入口と swap 直前の両方で `isEditing` を見て
  `defer(editing)`。inline editor 入力中の上書きを防ぐ。
- **0 シート projection**: 有効な GraphFile ではない (W3d-2 と同じ基準) ので
  `defer(empty-projection)`。

defer はすべて「次の受信契機・編集確定後に再試行される」前提であり、受信のべき等性
(4d) により再試行は安全。React state への反映 (activeFile / activeSheetId の差し替え) は
`useFileSheetOperations` 側の責務で、実機経路は 4e-4 で検証する。
