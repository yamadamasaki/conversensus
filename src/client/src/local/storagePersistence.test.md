# storagePersistence.test.ts — 保存領域が守られているかのテスト仕様

## 何を

`requestPersistence` (ブラウザに保存領域を消さないよう求め、その答えを覚える) を検証する (#263)。

## なぜ

Safari は、しばらく使わない Web サイトの保存領域を消すことがある (ITP)。消えると取り戻せない
この端末だけの File (#253) を守るため、**守られていない端末でだけ**注意を出す
(`StorageAtRiskBanner`)。その判定がここの答えである。**守られている証拠が無い限り、守られていないと
扱う** — 口が無い・投げたときに `persisted` と答えると、消えうる端末で黙ることになる。

## どのように

- 訊く前は `unknown` (起動の途中で注意を出さない)
- `persist()` が認めれば `persisted`、断れば `notPersisted`
- `persisted()` が既に true なら `persist()` を呼ばない (訊き直さない)
- 口が無い・投げたときは `notPersisted`
- テストの間で状態を持ち越さないよう、毎回 `resetPersistenceStateForTest` で戻す
