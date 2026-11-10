# requestArrival.test.ts — 依頼の到着の検出のテスト仕様

## 何を

`detectArrivedRequests` (受信した op から、自分宛てに送られた依頼を見つける、agent 段 4 R5、設計 D11) を、
batch を手で組んで検証する。

## なぜ

通知の内容は受信のたびに op-log から検出し直す (step3 Phase 6)。出し過ぎ (自分が送ったもの・前から
知っているもの) も、出し損ね (送り直し・不特定の宛先) も、依頼の通知を信用できなくする。

## どのように

- 他の人が自分宛てに送った依頼を、何回目か・送った人・本文つきで返す
- 宛先が空 (不特定) なら参加者の誰にでも届く。宛先に入っていなければ届かない
- 自分が (別の端末から) 送ったものは出さない — actor ではなく DID で見る
- 受信の前から同じ回数なら出さない。送り直すとまた出る
- 同じ受信で閉じられたものは出さない
- `sent` を書いた op が無ければ何も返さない (関係の無い受信で File を畳まない)
- 依頼ではない node の `sent` は数えない
- `senderOf`: 最後に `sent` を書いた人 (MCP の `list_requests` が、自分が送った依頼を除くのに使う)。送っていなければ undefined、他の property の op は数えない

## 依頼の module の知らせ (計画 node-actions-request-module.md B1)

このファイルは client (`src/client/src/sync/`) から依頼の module に移した。core は受信から知らせを見つける口
(`NodeModule.notices`) だけを持ち、依頼の到着を見つけるのは module である。

- (例) 依頼の module を登録した registry の `detectNotices` は、届いた依頼を知らせにする。既読の鍵は
  node と送った回数 (`<node>:<回数>`、core が module の id を前に付ける)。送り直すと鍵が変わるので、また知らせる

