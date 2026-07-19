# fanoutSyncProvider テスト仕様

## 何を

`FanoutSyncProvider` (step1 W3d5-4) をテストする。tap の単一 provider モデルを保ったまま、
ローカル正典 (ブロッキング) と remote 再送キュー (非ブロッキング) へ配る合成 `SyncProvider`。
push の二系統への配り方、remote leg のフィルタが効いていること、pull/subscribe の local 委譲を
検証する。

## なぜ

この合成 provider は設計 §3.1 の**最優先の不変条件「ローカル正典の前進を remote 同期が
ブロックしない」**が実際に成り立つ唯一の場所。次が破れると remote 統合が編集フローを壊す:

- **local ブロッキング (§3.1)**: `local.push` の await を落とすと、ローカル正典に載っていない
  batch を送信済み扱いにしてしまう。逆に local 失敗時に remote へ積むと、ローカルに存在しない
  batch が remote に先行して載る。→ 「local 成功が唯一の成功条件」「local 失敗なら remote へ
  積まない」を固定する。
- **remote 非ブロッキング (§3.1)**: remote 完了を await すると、PDS が落ちている間じゅう編集が
  止まる。→ remote オフラインでも `push` が resolve し、未送信はキューに残る (破棄しない) こと
  を固定する。
- **フィルタの実配線 (C1/D7)**: フィルタ純関数 (W3d5-2) とキュー (W3d5-3) は個別にテスト済みだが、
  合成 provider を通したときに genesis / presentation が remote へ漏れないことは別途固定が要る。
  同時に**ローカルには元 batch がそのまま (presentation 込みで) 載る**ことも確認する
  (W3e の snapshot 退役に必要な保全)。
- **pull/subscribe の local 委譲 (§3.1)**: Lamport 復元の clock seed に remote の clock が
  混ざると、端末間で clock 空間が壊れる。→ `pull` が local だけを呼び remote を呼ばないことを
  固定する。batch op-log 経由の remote 受信は非目標 (Phase 4d)。
- **flush の直列化**: `Outbox.flush` は多重起動を弾く (in-flight は即 `ok=false`) ため、push 連打で
  flush が空振りすると未送信が残り続ける。→ 連続 push で全件が remote に届くことを固定する。

## どのように

local / remote それぞれに `FakeProvider` (push/pull/subscribe を記録、`online` で push 成否を切替)
を割り当て、remote 側は実物の `RemoteSyncQueue` で包んで単体に閉じる (PDS 非依存)。remote flush は
非ブロッキングなので、検証前に `whenRemoteSettled()` で進行中の flush の落ち着きを待つ。

- **push — local ブロッキング**: 元 batch (presentation 込み) がそのまま local へ渡る /
  local が throw したら push も throw し、remote キューは空・remote への push も無い。
- **push — remote 非ブロッキング**: remote オフラインでも push は resolve し pending=1 (保持) /
  remote が生きていれば flush されて pending=0 / 連続 3 回 push で 3 件すべてが remote に届く。
- **remote leg のフィルタ**: genesis batch は local に載るが remote には載らない (C1) /
  mixed batch は presentation を除いた ops で remote へ / 全 presentation batch は remote へ
  一切 push しない (空 batch も送らない)。
- **pull / subscribe の local 委譲**: `pull` が local の batches と cursor をそのまま返し、
  since が local にだけ渡り remote の pull は呼ばれない / `subscribe` のコールバックが local に
  登録され、解除ハンドルが local の解除を呼ぶ。
