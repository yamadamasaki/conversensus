# firehose.test.ts — PDS の firehose のフレームを解くテスト仕様

## 何を

`decodeFirehoseFrame` (PDS の `subscribeRepos` の 1 フレームから、commit の DID と書いた record の
collection・rkey を取り出す) と `firehoseUrlOf` (PDS の URL から firehose の URL を作る) を検証する (#252)。

## なぜ

流れは受信の**合図**としてだけ使う (利用者判断 2026-10-11)。要るのは「誰が・どの File に書いたか」で、
record の中身 (`blocks` の CAR) は解かない。フレームは DAG-CBOR の値が 2 つ続いた形で、CID は tag 42 で来る。
tag を受け流せないと、どの commit も解けずに合図が 1 つも出ない。

**解けないフレームで投げてはならない。**WebSocket の受け口で投げると、以後のフレームも処理されない。
合図が 1 つ抜けても、間隔を延ばしたポーリングが拾うので、null を返せば足りる。

## どのように

- 例: PDS が送る形 (`seq`・`rev`・`blocks`・tag 42 の CID を含む) の commit から、DID と path を取り出す
- 例: `#identity`・`#account`・エラーのフレーム (`op: -1`) は null
- 例: collection の無い path は飛ばす
- 性質: **あらゆるバイト列で**投げず、解けなければ null を返す。生成器は 64 バイトまでの任意のバイト列
  (CBOR として途中で切れたもの・型の違うものを広く引く)
- 例: https の PDS は wss、http (開発) は ws になる

テストのフレームは `cborg` の encode で組む。**本物の PDS が送るフレームでも解けることは、開発用の PDS
(:3000) に record を書いて firehose を読み、作成と削除の 2 つが正しい DID・collection・rkey で解けることを
確かめた** (2026-10-11、PDS 0.4.5009)。
