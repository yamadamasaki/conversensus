# readWrite.test.ts — headless の読み書きのテスト仕様

## 何を

`Headless` の読み書き (H3): `read`・`record`・`settled`・`sync`。

## なぜ

agent が conversensus でする仕事は「読んで、書く」である。書く経路は **UI と同じ GraphEvent**
(`EventSyncTap` が op へ落とす) にしたので (計画 §5)、UI と同じ op が、agent の actor で、agent の
repo に出ることを確かめる。

## どのように

偽の PDS の上で、alice が File を作って 1 つ書き、agent を参加させてから始める (`sharedFile`)。
数えるのは**最初の Sheet** の node だけ — File には metagraph (`index`) もあり、Sheet ごとの導出 node を持つ。

- 🔴 参加した File の、相手が書いた中身を読める (完了基準 2)
- 🔴 agent が書いたものを、alice が同期して読める (完了基準 3)
- agent の書き込みは agent の actor で op-log に載り、agent の repo に出る (由来, 設計 D1)
- 本文の書き換え (`NODE_CONTENT_CHANGED`) も往復する
- 開き直した agent が書いても、点 `(actor, seq)` が前の起動と重ならない。発番器が手元の op-log
  と覚えた判断の点から戻るため (#261 の窓 1)
- 既にある Sheet に後から当てた template (#355) の種別が、encoding の注釈に出る。template graph を作って
  種類を置いただけでは出ず、最初の Sheet に今の切断面で当てると出る。headless が template を読む所
  (`encode` と書く道具の Sheet の解決) は、作るときのものと後から当てたものを合わせて読む
  (`appliedTemplateRefs`)。読む所を `sheet.templateIds` に戻すとこのテストが落ちる

### 観察: genesis は参加者の repo にも出る

agent を開き直して同期すると、agent の repo に genesis (File の起源) の batch も出る。送信の catch-up は
「自分の repo に無い手元の batch」を送り、genesis は誰の repo に出してもよい扱いだからである
(`atproto/remoteFilter.ts`)。App の参加者でも同じで、重複は batch の id で除かれる。
テストは agent 自身の batch だけを数える。
