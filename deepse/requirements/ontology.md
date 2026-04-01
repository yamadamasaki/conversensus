# requirement ontology

![Ontology](conversensus-ontology.png)

___Caution: deprecated___

- Node と Edge の集まりが有向グラフを表す
  - Node は content と properties を持つ
    - content はテキストや画像などのリソースを表す (optional)
      - properties の中の content という key を持つリソースと思ってもよい
    - properties は content を補足する情報を表す (optional)
      - 文字列を key とし, 任意のリソースを value とする
      - properties の schema を持たせるべきか? → とりあえず持たせない
  - Edge は label と source と target と properties を持つ
    - label は文字列である (optional)
    - source と target は Node を指す (mandatory)
    - properties は source と target の関係の詳細を表す (optional)
      - その一つに label という key の property があると考えてもよい
      - properties の schema を持たせるべきか? → とりあえず持たせない
- Node と Edge を集めて Group にすることができる
  - Group は name と description を持つ (optional)
    - Group を Node の一種としてもよいが, 現時点では Node と Group は別のものとする
      - 現時点では Group は論理的なものよりは意味的なものとする
      - Group は Node ではないので, Edge を持たない
- Template はその Sheet の有向グラフが満たすべき制約を持つ
  - Node の制約
    - 濃度
    - その Node に接続する Edge に関する制約
  - Node の properties が持つべき制約 (schema)
  - Edge の制約
    - 濃度
    - その Edge が接続する Node に関する制約
  - Edge の properties が持つべき制約 (schema)
- Sheet には複数の有向グラフが存在する
  - Sheet は name と description と view を持つ
    - name は Sheet の名前を表す
    - description は Sheet の説明を表す
    - view はその Sheet で有向グラフをどのように表現するかを表す
      - Sheet に含まれる Node たちの style を持つ
      - Sheet に含まれる Edge たちの style を持つ
- File は複数の Sheet をまとめたものである
  - File は name と description を持つ
    - name は File の名前を表す
    - description は File の説明を表す
  - File の物理的な実装としていわゆるファイルを利用するとは限らない
