# participation.test.ts — headless の参加のテスト仕様

## 何を

`Headless` の参加まわり (H2): `createFile`・`sync`・`invite`・`accept`・`discover`・`files`。

## なぜ

agent が conversensus に加わる入口は、**人間と同じ参加の手続き**である (設計 D1: 招待・承認・
名簿は変えない)。ブラウザでは `useParticipation` と `useFileSheetOperations` が組み立てている部品を、
headless が同じ順で組み立てられていることを確かめる。部品が同じなので、名簿の判定や発見の絞り込み
(他の actor の repo を列挙しない, U6-P1) はブラウザと同じに効く。

## どのように

偽の PDS (`testing/headlessWorld.ts`) の上で、alice と agent を**端末の切り替え**で表す
(1 プロセスに headless は 1 つ。App 結合と同じやり方)。alice も headless で動かす —
agent と人間を区別しない (設計 §1.1) ので、招待する側も同じ口で書ける。

- 🔴 **招待された File に参加コードで参加すると、その File が手元に立ち上がる** (完了基準 1)。
  参加前は一覧が空、承認の後は alice の File が出る。偽の PDS の外へは通信しない
- 承認は agent の repo の判断ログに書かれる
- 別の DID 宛てのコード・壊れたコードは承認しない (書く前に止める)
- 同じ DID の別の端末で作った File は、自分の repo から見つかる。batch も全部そろう
  (発見の列挙が先頭のレコードだけを読むため差分の deps の警告が出るが、立ち上げの取得でそろう)
- 発見はべき等 (2 回目は何も立ち上げない)
- 開き直した後も、参加した File と中身はそのまま (正典は `dataDir` の SQLite)
