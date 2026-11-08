# cli.test.ts — headless の CLI の引数のテスト仕様

## 何を

`parseArgs` (CLI の引数を `Command` と置き場所・PDS・ブラウザを開くかに読む)。

## なぜ

CLI は開発用の PDS で headless を手で確かめる道具である (計画 H5)。中身は `Headless` を呼ぶだけで、
その振舞いは `headless.test.ts`・`participation.test.ts`・`readWrite.test.ts` が見ている。
CLI に固有なのは引数の読み方だけなので、そこを見る。`run` (本物の PDS と OAuth の同意を伴う) は
手で確かめる。

## どのように

- コマンドと引数を読む (本文に空白があっても 1 つの引数)
- 選択肢 (`--data`・`--pds`・`--no-open`) はコマンドの前後どちらにあってもよい
- 既定は開発用の PDS (`http://localhost:3000`)、置き場所は `~/.conversensus/agent`、同意のページを開く
- 引数の数が違う・知らないコマンド・コマンドが無い・値の無い選択肢・UUID でない File の id は、例外で止める
