# remoteBatchChecks のテスト

## 何をテストするか

PDS 上の batch レコードを読み解いて検める部分 (`scripts/inspect-remote-batches.ts` の中身, #254)。

- `classifyRecords`: レコードを、検査できる batch とそれ以外に分ける
  - v2 の rkey (`<fileId>~<actor>~<seq>`) と本文が揃ったものを batch に戻し、clock 順に並べる
  - v1 の rkey (`v1~…`) は別物として数え、検査に入れない
  - 本文の (fileId, actor, seq) が rkey と違うものは読まない
  - batch の形をしていない本文は読まない
- `checkGenesisPresent`: genesis が無ければ FAIL。genesis の無い File (参加した File) は数を添えるだけ
- `checkClockUnique`: 同じ file × sheet × actor で clock が重なれば FAIL。別の actor の重なりは PASS

## なぜテストするか

このスクリプトは利用者テストの手順 (`user-test-environment.md` §5・§6) で PDS の中身を
確かめる道具である。op-log v2 で rkey の形と API が変わったとき、**scripts/ はテストにも
型検査にも lint にも入っていなかった**ので、起動すらしないまま誰も気付かなかった (#254)。
読み解きを src に移してテストし、スクリプト本体も型検査と lint に入れた。

分け方を**受信経路 (`pullRemoteForFile`) と揃える**のが要点である。検査器が本番と違うものを
見ると、赤も緑も証拠にならない。

## どのようにテストするか

レコードは本番と同じ組み立て方で作る — rkey は `batchRkey`、本文は `batchToRecord`。
手で文字列を書くと、本番の形が変わったときにテストだけが古い形のまま通ってしまう
(それがまさに #254 で起きたことである)。
