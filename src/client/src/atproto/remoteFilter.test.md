# remoteFilter テスト仕様

## 何を

`filterBatchesForRemote` (step1 W3d5-2) をテストする。ローカル正典 (daemon op-log) 向けの
batch 列から、ATProto (remote) へ push する batch 列を導く純関数。2 段のフィルタ
(genesis actor 除外 → presentation 除外) と、空になった batch の skip を検証する。

## なぜ

remote leg のフィルタは設計 §3.2 / §3.5 の 2 つの不変条件を担う要のコードで、破れると
実害が出る:

- **genesis 衝突 (critic C1)**: 受信 (import) 経路が無い現状で `GENESIS_ACTOR` の batch を
  remote に載せると、各端末が独立生成する genesis と clock が衝突し remote が汚染される。
  genesis batch が「syncable op を持っていても丸ごと除外される」ことを固定する。
- **presentation 漏洩 (D7)**: presentation はローカル限定。remote batch に presentation op
  が載らないことを固定する。全 op が presentation の batch は送らない (空 batch を作らない)。

またローカル正典を一切変えない純関数であることが前提なので、**入力 batch を破壊的に
変更しない**ことと、ops が減らない batch は**複製せず同一参照で返す** (不要な allocation を
避ける) ことも固定する。mixed batch を絞ったときは `id`/`clock`/`timestamp`/`actor`/`sheetId`
を保存し、ローカル batch と `id`・`clock` で対応づけられるようにする。

## どのように

- **空入力**: 空を返す。
- **content only** (全 op syncable): 同一参照で通す (複製しない)。
- **mixed** (content + presentation): presentation を除いた複製を返し、他フィールド
  (id/clock/timestamp/actor/sheetId) を保存する。
- **presentation only**: skip (出力に含めない)。
- **genesis actor**: syncable op を持っていても丸ごと除外する (C1)。
- **複数 batch**: genesis 除外・presentation skip・content 通過を入力順序を保存して行う。
- **非破壊**: 入力 batch の ops を書き換えない。
