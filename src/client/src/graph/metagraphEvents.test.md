# splitMetagraphEvent のテスト

## 何を

`splitMetagraphEvent` — metagraph 上で `GraphEditor` が dispatch しようとした event を、シートの操作
(`intents`) と残りのふつうの操作 (`rest`) に分ける (step3 Phase 4 S4-2)。

## なぜ

graph node は sheet の一覧から導くもので、node の op では変わらない (畳み込みが無視する)。読み替えを
誤ると、**消したつもりの graph node が次に開くと戻っている** (シートは消えていない)、名前を書き換えても
シートの名前が変わらない、が静かに起きる。逆に、ふつうの node の操作まで飲み込むと編集が消える。

シートの操作を `rest` に混ぜない理由: シートの削除は undo の積み上げに入れない (中身ごと消えるので戻せない)。

## どのように

graph node 1 つ (シートを指す) と、ふつうの node 1 つ。

- **graph node の削除はシートの削除になり、ふつうの node の削除は残る** (残りの node・layout から graph node を外す)
- **graph node だけの削除は、残りが無い**。edge が一緒なら edge は残る
- **graph node の本文の書き換えはシートの名前の変更になる**。前後の空白を落とし、空の名前にはしない
- **graph node の label・プロパティの変更は捨てる**。ふつうの node の操作はそのまま
