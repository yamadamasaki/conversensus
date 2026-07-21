# useEventSyncTap テスト仕様

## 何を

`useEventSyncTap` の **remote 配線 (step1 W3d5-5)** をテストする。ATProto ログインの有無で
tap の provider 構成が切り替わること (local 単体 / `FanoutSyncProvider`)、編集が両系統へ流れる
こと、presentation が remote へ漏れないこと、起動時 catch-up が走ることを検証する。

## なぜ

このフックは W3d5-1〜4 で作った部品 (sheetId 往復・フィルタ・キュー・fanout) が**実際に配線
される唯一の場所**で、ここが間違うと部品が全部正しくても remote 同期は動かない/壊れる:

- **未ログイン時の退行なし (§3.4 確定事項)**: `remoteQueue=null` で W3d と完全に同じ local-only
  動作でなければ、ログインしていないユーザに remote 統合の影響が漏れる。「remote キューが無ければ
  fanout を作らない」を固定する。
- **編集が remote に載る (§2 の目標)**: ログイン中は 1 回の編集がローカル正典と remote の両方へ
  同じ batch id で届くこと。これが本スライスの存在理由そのもの。
- **presentation 漏洩 (D7)**: フィルタは `RemoteSyncQueue` 内にあるが、tap 経由の実配線で本当に
  効くかは別問題。**`NODE_STYLE_CHANGED` は実体が width/height なので `node.setLayout` に
  正規化され同期対象**であり (toUnified の D7 整理)、presentation の検証には `edge.setStyle`
  を使う必要がある — この取り違えは「フィルタが効いていない」と誤読しやすいので、テストで
  意図を明示しておく。
- **起動時 catch-up (§3.6)**: best-effort push がオフライン中に落とした分は、ファイルを開いた
  ときに回収されなければ永久に remote に載らない。remote に既にある分を二重投入しないこと、
  catch-up 経由でも genesis を送らないこと (C1) を固定する。
- **再接続時 catch-up (§7・W3d5-7 確定)**: 再接続検知は `online` イベントで行う。アプリを開いた
  まま回線が切れて復帰した場合、次回起動まで待たずに回収できることがこの方式の存在理由なので、
  「イベントで実際に catch-up が走る」を固定する。あわせて**リスナ解除**も検証する — 解除漏れは
  provider が変わるたびにリスナが積み上がり、1 回の `online` で全件 pull (D2) が多重発火する。
- **ファイル未オープン**: `fileId=null` で provider を作らない (別ファイルへ push しない・
  無駄な catch-up を起こさない)。

## どのように

`@testing-library/react` の `renderHook` でフックを張り、`createLocalProvider` オプションで
ローカル正典 provider を `RecordingProvider` (push を記録、pull で既存ログを返す) に差し替える
= 実ネットワーク・実 PDS 非依存。remote 側は実物の `RemoteSyncQueue` に別の `RecordingProvider`
を包んで注入する (フィルタとキューの実挙動を通す)。tap も fanout も flush が非同期なので、
記録後に `act` + マクロタスク 1 拍で落ち着かせてから検証する。

- **remoteQueue なし**: 編集 1 回 → local に 1 batch、remote は登場しない。
- **remoteQueue あり**: 編集 1 回 → local と remote の両方に 1 batch、かつ **batch id が一致**
  (同じ batch が両系統へ渡っている)。
- **presentation**: `EDGE_STYLE_CHANGED` → local には載る (W3e 保全)、remote には 0 件。
- **起動時 catch-up**: local の既存ログ ['1','2'] / remote に '1' → mount だけで '2' が remote へ
  push される。local に genesis actor の batch があっても remote へは送らない (C1)。
  remoteQueue が無ければ catch-up 自体が起きない。
- **再接続時 catch-up**: mount 時は remote に取りこぼし無し → push 0 件。その後ローカル正典に
  batch が増えた状態で `window.dispatchEvent(new Event('online'))` → その batch が remote へ
  push される。`unmount()` 後に同じイベントを投げた場合は push 0 件 (リスナが外れている)。
- **fileId=null**: record を呼んでも local/remote とも push 0 件。

## 受信の配線 (Phase 4d-5)

送信 catch-up と**同じ契機** (起動時 + `online`) に受信を相乗りさせる (設計 §3.4)。
両者は「remote と突き合わせて差分を埋める」同じ性質の操作なので発火経路を分けない。

**フックは受信失敗を `.catch` で握る**ため、書き込み口を注入して観測できるようにしないと
「何も起きていない」と「静かに失敗した」を区別できない。W3d5-7 で「PDS が float を拒否して
全 push が 400、しかしコンソールは無言」という事故があったので、ここは必ず観測可能にする。

> **`mock.module('../api', ...)` は使わない。** bun のモジュールモックはグローバルに効くため、
> 他のテストファイルから `../api` の別の export が見えなくなる (実際に `createFile` not found で
> 別ファイルが落ちた)。既存の `createLocalProvider` と同じ**注入の型**に揃え、
> `appendReceived` オプションで差し替える。

- **mount 時に取り込む**: remote の batch が正典宣言つきの書き込み口へ、正しい fileId と
  ともに届くこと。受信が実際に発火した証拠になる。
- **受信は fanout を通さない (§3.3a)**: 受信した batch が remote へ push され直して
  いないこと。echo ループが起きていないことの直接の証拠。
- **`online` でも受信する (§3.4)**: 再接続イベントで受信が再度走ること。
- **受信失敗が送信を止めない**: 受信が throw しても、ローカルにあって remote に無い batch は
  送信 catch-up で送られること。両者を独立に catch している設計の確認。
- **未ログイン時は受信も起きない**: `remoteQueue` が無ければ local-only の挙動を保つこと。
