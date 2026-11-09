# liveSocket.test.ts — headless の流れの口 (agent 段 5 S2)

## 何を

`headlessLiveChannel` が、画面の無い bun のプロセスで firehose に繋ぎ、合図を出すこと。

## なぜ

- ブラウザ版 (`browserLiveChannel`) は `document.hidden`・`navigator.onLine` を読む。headless には無い
- 合図の読み解き (`decodeFirehoseFrame`) と繋ぎ直しの規則 (`LiveChannel`) は client で試してある。
  ここで見るのは **bun の `WebSocket` に載せたときの継ぎ目** — フレームが `ArrayBuffer` で届くか
  (`binaryType`) は、偽の socket の試験では分からない

## どのように

`Bun.serve` で firehose の代わりを立てる。繋がると、batch の record を書いた commit を 1 フレーム送る。

- 🔴 繋がると、繋がった合図 (`null`) と、書かれた File の合図を出す。止めると切れる
- 相手が切ると (PDS の再起動に当たる)、繋ぎ直す (繋ぎ直しの間隔は縮める)
