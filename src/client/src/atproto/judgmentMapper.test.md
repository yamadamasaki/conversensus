# judgmentMapper.test.ts — 判断ログのマッピングのテスト仕様

## 何を

`JudgmentBatch` と PDS の `JudgmentRecord` の相互変換 (`judgmentToRecord` /
`isJudgmentRecordValue` / `recordToJudgmentBatch` / `recordToRemoteJudgment`) を検証する。

## なぜ

`batchMapper.ts` と同形なのに別のテストを立てるのは、**op を Zod で検証する点が違う**からで
ある。ここが判断ログ固有の境界になっている。

グラフ側の op は、projection が知らない種別を持っていても LWW / add-wins の外に落ちるだけで
済む。だが判断ログの畳み込みは **op の種別で pre 条件を分岐する** (`participation.ts` の
switch)。語彙に無い op が混ざると switch が黙って素通りし、**捨てられもせず効きもしない**
という第 3 の状態が生まれる。`rejected` に載らないので UI にも出ない。

これは「静かに捨てる経路を新たに作らない」(W3d5-7 で「PDS が float を拒否して全 push が 400、
しかしコンソールは無言」という事故があった) に反する。したがって**境界で弾き、呼び出し側が
数えて警告する**。

## どのように

### judgmentToRecord

- **id を載せない**。`batches` と同じく rkey が持つ
- **fileId を載せる**。collection は repo 全体で 1 つなので、レコード自身が scope を
  持たないと受信側が適用先を復元できない
- **sheetId を載せない**。判断は File 単位であってシート単位ではない。`BatchRecord` との
  唯一の形の違いなので固定する

### 往復

- **レコードへ落として戻すと元の batch になる**。clock / timestamp / ops を非可逆なしで
  保持していることの確認である
- **適用先はボディの fileId から復元する**。rkey にも fileId が入るが、そちらは取得経路の
  索引であって復元元にしない (二重の真実を作らない)

### 形の検証 (`isJudgmentRecordValue`)

壊れたレコード・他種レコードを弾く。`clock` は `Number.isFinite` まで見る — NaN が通ると
順序付けが壊れる。

**op の中身までは見ない。**形の検査と語彙の検査を分けてあるのは、前者が「このレコードは
判断ログのものか」、後者が「この判断は解釈できるか」という別の問いだからである。

### op の検証 — batchMapper との違い

- **語彙に無い op があれば batch ごと落とす**
- **一部だけ通さない**。判断は複数 op の原子性を前提にしている (「招待して同時に別の誰かを
  取り消す」)。割ると書いた側の意図と違う名簿になる
- **`target` を欠く `invite` も落ちる**。discriminated union の必須フィールドまで検証している
  ことの確認である
- **op が 0 件の batch も落とす**。語彙上ありえない (`min(1)`)

`null` を**数えて警告するのは呼び出し側の責務**である。ここは判定だけを返す。
