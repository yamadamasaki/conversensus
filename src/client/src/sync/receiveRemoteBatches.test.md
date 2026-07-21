# receiveRemoteBatches.test.ts — 受信取り込みのテスト仕様

## 何を

`receiveRemoteBatches` (remote の batch op-log をローカル正典へ取り込む純粋な調整層,
step1 Phase 4d-5) を検証する。

## なぜ

Phase 4d の目標は「受信が**安全に**ローカル正典へ着地する」ことであり (設計
`step1-phase4d-receive.md` §2)、その安全性は設計 §3.3 の **3 つの不変条件**に集約される。
この関数がその 3 つを一手に引き受けるので、条件が破れていないことを機械的に固定する。

- **(a) 受信は fanout を通さない** (§1.11 D-5)。`FanoutSyncProvider.push` を使うと
  `remoteQueue.enqueue` が走り、受信したものを remote へ送り返す (echo ループ)。
- **(b) 書き込みは migration marker と整合する** (§1.8)。marker が無いと次の読取で
  lazy migration が `DELETE FROM batches` を走らせ、受信内容を丸ごと破棄する。
- **(c) 自端末 clock を `observe` で前進させる** (§1.6 / §3.2a)。これが無いと端末を
  またいだ `clock` 比較が「因果的に後」を表現しない。

(a) と (b) は「どの関数を呼ぶか」で決まるので依存注入の形で固定し、(c) はこの関数の
振る舞いとして直接検証する。

## どのように

依存 (`pullRemote` / `appendReceived` / `observeRemote`) を注入し、呼び出しを記録して
検証する。PDS もデーモンも要らない純粋な単体テスト。

- **自ファイル宛の取り込み**: remote から取得した batch が `appendReceived` へ、
  正しい fileId とともに渡ることを確認する。
- **他ファイル宛は捨てて数える**: remote の batch コレクションは repo 全体で 1 つなので
  他ファイル分も返る。未知の fileId を書くと孤児 batch が生まれる (§1.11 D-4) ため、
  この fileId フィルタが防御を兼ねる。捨てた件数を返すのは silent skip にしないため
  (§3.1 の counted skip と同じ思想)。
- **自ファイル宛 0 件では書き込まない**: `observeRemote` も呼ばない。受信 0 件で
  正典宣言 marker を立てると lazy migration の機会を無意味に奪うため (4d-0 と整合)。
- **`observe` は受信 clock の最大値** (不変条件 c): 複数 batch のうち最大の clock で
  1 回だけ observe すること。これ以降に発番する clock が受信分を必ず追い越す。
- **🔴 書き込み失敗時は clock を進めない**: 取り込めていないのに clock だけ進むと、
  次に発番する batch が「取り込めなかった編集より後」を騙る。`appendReceived` が
  throw したとき `observeRemote` が呼ばれないことを固定する。順序が意味を持つ理由そのもの。
- **べき等 (受入基準 2)**: server 側 `appendBatch` の batch_id べき等性を模し、2 回呼んでも
  `appended` が 0 になるだけで op-log が増えないことを確認する。あわせて `received` は
  毎回全件であること (4d-4 で cursor を廃止したため) も固定する。
- **genesis batch は素通し**: genesis は remote へ push されない (`remoteFilter`, C1) ので
  通常は届かない。万一届いても受信側で特別扱いはせず、べき等な追記に委ねる —
  判別ロジックを増やすと「何を受け入れるか」の条件が 2 箇所に分かれるため。
