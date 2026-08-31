# bootstrapParticipation.test.ts — 名簿の起点を置く移行のテスト仕様

## 何を

`bootstrapParticipation` (既存 File に `participation.genesis` を書く) と
`isSolelyOwnedBy` (その File が本当に自分のものか) を検証する。

## なぜ

**step1 で作った File には名簿の起点が無い。**「file を作った actor が自動的に参加する」を
成立させたいが、`file.create` op が無く genesis batch の actor は `GENESIS_ACTOR` という
固定文字列なので、**作成者の DID がグラフの op-log のどこにも載っていない** (事実 7)。

起点が無いと、招待の pre 条件 `a ∈ participatingActors` が初期値を持てない。**最初の招待が
落ちて誰も参加できない** — step2 の完了基準 1 がそもそも成立しない。この移行はそこを繋ぐ
一点であり、失敗すると Phase 1 以降が丸ごと動かない。

同時に、**書きすぎてもいけない。**名簿の起点は「誰が作ったか」の主張なので、他人の File に
自分の genesis を書くと、その File の名簿を乗っ取ることになる。

## どのように

### isSolelyOwnedBy — 起点は主張なので、確かめてから書く

step1 の File は単一 actor で作られているので取り違えは起きない。**が、それに寄りかからず
実際に op-log を見る。**Phase 2 で他 actor の File がローカルに現れるようになった後に
この移行が走っても、他人の File を自分のものだと宣言しないためである。

- **自分の op だけなら自分の File である** (別端末 `#dev-2` を含む — 名簿は DID 単位)
- **ログイン前に作った File も自分のものである。**`local#<deviceId>` は自分の端末で自分が
  作ったものに他ならない
- **`genesis` actor の batch は判定を妨げない。**snapshot 由来の構造 op なので、
  誰のものかを語らない
- **他人の op が 1 件でもあれば自分の File ではない**
- **op-log が空なら自分の File として扱う。**ローカルのデーモンにあって中身が無いなら、
  この端末で作られたばかりのものである

### 書く条件

- **判断ログの無い自分の File に genesis を書く**
- **書いた genesis を畳むと、その actor が最初の参加者になる。**移行の目的そのものなので、
  `foldParticipation` まで通して確かめる。ここが繋がっていないと最初の招待が落ちる
- **既に判断ログがある File は触らない**
- **他人の op を含む File には書かない**
- **削除済みの File には書かない。**起点を置いても誰も招待しない

### clock 0 で書く

**あらゆるグラフ op より前**である。後の clock を与えると、**その actor 自身の過去の op が
参加期間の外に落ちる** — Phase 2 の「参加していた期間の op-log だけを同期する」で消えてしまう。

0 を使えるのは `LamportClock.tick()` が 1 から始まり、グラフの genesis も
`GENESIS_CLOCK_START = 1` だからである。0 は誰にも割り当てられない。

### べき等性

- **marker が立っていれば何もしない**
- **2 度走らせても同じ id になる。**genesis の id は fileId と actor から決定論的に導かれ、
  rkey もそこから決まるので、同じレコードに収束する。**marker は「毎回 File 数だけ
  読みに行かない」ためのものであって、正しさの前提ではない** — marker の保存に失敗しても
  (localStorage が使えない環境など) 壊れない、という形にしてある

## テストしていないもの

`hasParticipationBootstrapped` / `markParticipationBootstrapped` の localStorage 読み書きは
`migrateRemoteRkey` の marker と同じ形なので、そちらのテストが規約を固定している。
ここでは marker を関数として注入し、**移行の判断だけ**を見る。
