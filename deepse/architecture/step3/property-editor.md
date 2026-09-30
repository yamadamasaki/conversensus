# property editor

> [step3](../step3.md) の子文書。出所: Notion「design language」内の「property editor」(2026-09-30)。

- property の一覧
- custom property は自由に (`.` を含まない名前で) 追加, 変更できる
- system property は見ようと思えば表示できる
- extension property は見ようと思えば表示でき, extension が許したものならば変更できる
  - extension によって型が指定されているはずなので, 型チェックを行い, 適合しない場合は
    通知し, 拒否する
- ヘッダでプロパティ表示を on にしていれば, 選択している node/edge に対する
  property editor がボディ内に表示される
  - この二つは重なるが, 両方を併用することにする
    - merger では右サイドバーに三つの property editor を載せる余裕がないため
    - property はグラフの基本的な要素であるのでボディに表示すべきであると同時に,
      使われる機会は限られるので右サイドバーに追いやりたいため
