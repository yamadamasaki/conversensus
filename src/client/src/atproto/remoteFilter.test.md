# remoteFilter テスト仕様

## 何を

`filterBatchesForRemote` (step1 W3d5-2, Phase 4e-0 で C1 見直し, step2 Phase 2 S0) を
テストする。ローカル正典 (daemon op-log) 向けの batch 列から、ATProto (remote) へ push する
batch 列を導く純関数。落とすものは 2 つ — **presentation op** と、**他 actor が書いた
batch** である。空になった batch の skip も検証する。

## なぜ

remote leg のフィルタは設計 §3.2 の不変条件を担う要のコードで、破れると実害が出る:

- **presentation 漏洩 (D7)**: presentation はローカル限定。remote batch に presentation op
  が載らないことを固定する。全 op が presentation の batch は送らない (空 batch を作らない)。
- **genesis 通過 (Phase 4e-0・C1 見直し, 4e 設計 §3.1)**: Phase 4d で受信経路ができたため、
  旧 C1 (genesis 除外) の前提が消えた。genesis batch が remote へ**通る**ことを固定する
  (bootstrap の起源として未知端末へ届く)。genesis batch にも presentation 除外は同様に
  かかる。誤って除外へ回帰すると bootstrap ギャップ (4d-6 基準 6) が再発する。
- **⚠️ 他 actor の op-log の複製 (step2 Phase 2 S0)**: step1 ではローカル正典に入る batch が
  自分の DID の端末が書いたものだけだったので、この制約は要らなかった。**Phase 2 で受信が
  他 actor の batch を正典へ入れる**と、`catchUp` (= ローカル正典にあって remote に無い
  batch を積み直す) が**相手の op-log を自分の repo へ複製する経路**になる (Phase 2 設計
  事実 A)。転送量が参加者数の二乗で効き、参加を取りやめた actor の op が全員の repo に
  残り続ける。**判定は「どの repo から読んだか」ではなく「誰が書いたか」** (`Batch.actor` の
  DID 部分) — 過去に複製されたレコードが PDS に残っていても結論が変わらないようにする。
  **genesis はこの判定の対象外**である。`GENESIS_ACTOR` は DID ではなく、genesis は
  「誰かの判断」ではなく File の起源だからである。content-addressed で受信側が batch id で
  dedup するので、複数の repo にあっても増殖しない。

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
- **genesis actor 通過** (Phase 4e-0): syncable op を持つ genesis batch は remote へ通す。
  全 op syncable なら同一参照。
- **genesis + presentation**: genesis batch にも presentation 除外がかかり、絞った複製が
  通る。全 op が presentation の genesis batch は skip。
- **複数 batch**: genesis 通過・presentation skip・content 通過を入力順序を保存して行う。
- **非破壊**: 入力 batch の ops を書き換えない。

### 著者による除外 (step2 Phase 2 S0)

- **他 actor の batch**: 送らない。`<did>` 形式でも `<did>#<deviceId>` 形式でも落ちる。
- **自分の別端末**: 送る。判定に使うのは `<did>#<deviceId>` の **DID 部分だけ**である
  (端末が違っても同じ repo に書く)。
- **genesis**: 著者判定の対象外。`myDid` に何を渡しても通ることで、「起源は誰の repo からでも
  通る」を固定する。
- **混在した列**: 自分の分と genesis だけが入力順序を保存して残る。
