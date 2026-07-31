# batchRkey.test.ts — テスト仕様

## 何をテストするか

PDS の batch レコードの **rkey スキーム** (`v1~<fileId>~<clock12>~<batchId>`) を組む・分解する
純関数群 (step1 Phase 7 p7-1, 設計 [`step1-phase7-range-fetch.md`](../../../../deepse/plans/step1-phase7-range-fetch.md) §3.1)。

- `batchRkey(fileId, clock, batchId)` — 組み立て
- `batchRkeyPrefix(fileId)` — そのファイルの rkey が共有する prefix (走査の**停止条件**)
- `batchRkeyFileCursor(fileId)` — そのファイルの手前を指す**合成 cursor**
- `parseBatchRkey(rkey)` — 分解 (新形式でなければ `null`)
- `batchIdFromRkey(rkey)` — `batch.id` の復元 (旧 rkey を許容)

## なぜテストするか

**この文字列の性質がそのまま範囲取得の正しさになる**。ATProto の `listRecords` には
`rkeyStart`/`rkeyEnd` が無く (現行 lexicon から削除済)、使えるのは `cursor` (= rkey そのもの) と
`reverse` だけである。したがって「どのレコードが取れるか」は **rkey の辞書順**だけで決まり、
以下の 4 つはコードで守るしかない不変条件になる:

1. **決定論性** — 同じ batch から必ず同じ rkey が出る。`putRecord` が PDS レベルでべき等な
   前提であり、outbox の再送と移行の再 push (p7-4) がこれに依存する。時刻を混ぜた rkey
   (TID など) にすると再送ごとに別レコードが増える。
2. **ファイル内が辞書順 = clock 順** — ゼロ詰めの目的。桁あふれさせると順序が狂うので
   `clock` が 12 桁に収まらなければ throw する (静かに壊さない)。
3. **同一ファイルの rkey が連続する** — 他ファイルのレコードが間に挟まらないことが
   prefix 走査の前提。fileId が UUID 固定長なので prefix 衝突が起きない。
4. **旧 rkey (小文字 hex UUID) より必ず大きい** — `v1~` 前置の目的。旧レコードは PDS に
   放置する決定なので、新経路の走査がそれらを 1 件も踏まないよう rkey 空間を分離する。

分解側は **寛容にしすぎない**ことを固定する。桁数の違う clock や符号付きの値を「読めた」
ことにすると、壊れたレコードが黙って正典へ入る。`v1~` で始まるのに形式を満たさないものだけ
`null` にし、呼び出し側が**数えて警告する** (設計 §3.6 / W3d5-7 の「無言の 400」の反省)。

## どのようにテストするか

PDS 非依存の純関数なのでモック不要。固定の UUID (先頭 8 桁だけ変える) を使い、
**辞書順そのものを assert する** — 実装の内部ではなく「並べたときどうなるか」を固定する。

- 連続性: A と B の rkey を交互に並べた配列を `sort()` し、A の 2 件が先に固まることを見る。
- `v1~` 分離: 旧 rkey で最大になりうる値 (`ffffffff-…-ffffffffffff`) と比較する。
- cursor: そのファイルの最小 rkey より小さく、1 つ小さい fileId の最大 rkey より大きいこと
  (= 昇順 seek がちょうどそのファイルの先頭に着地する条件) を両側から挟んで固定する。
- `batchIdFromRkey` の旧形式許容は **p7-1 時点の暫定** (読取が repo 全件 list のままなので
  新旧が混在する)。p7-5 で全件 list を撤去したら外せる — そのときこのテストも落とす。

実 PDS が `~` を含む 89 文字の rkey を受理することと、cursor の意味論 (`reverse: true` で
`rkey > cursor`) は p7-0 の実機 spike で確認済 (設計 §5.1)。ここでは**文字列の性質**だけを見る。
