# agent-actor.md のレビュー (第ニ回目)

- D1: 決定済み
- D2:
  - A7: 一応, LM agent であることは分かるようにしましょう
  - その方法としては D2 で提案されたものを使ってみましょう
- D2a: この提案どおりでよし
  - A8: issue を起こしてください
- D3: この方向で行く
  - A2': step 5 で考える
- D4: 決定済み
- D5: 決定済み
- D6:
  - node の種類を label の文字列で決めるのはいいですが,
  - 今は template の node/edge の種類は property には持っていないんでしたっけ?
  - toulmin model の時と同じように, 多国語の問題が発生すると思います
  - template には i18n というようなラベルの特別な node を作って, その property か contents で言語コードごとにキーワードの対照表を作りましょうか? ユーザが template の property を編集すれば, 表示を変えられるように
  - これはついでなので別 issue にしてもらった方がいいかもしれませんが, property を表示する pane で, システムや拡張機能の read-only の property の値を表示するトグルを付けたい (default は off) と思っています. 透明性のためです
- D7: この提案通りでよし
  - B7: answerTarget は, template の property に置きましょう
  - ところで, answerTarget は誰が設定する想定ですか? 依頼本文に書いても良い?
    - (依頼本文は, ML agent に対しては prompt のようなものだと想像していますが)
  - B8: 可能ならば, 既存の sheet に対して, template を追加適用できるようにしたい気もします
    - すでに適用されている template は選択肢に対象外
    - これも issue に起こしておいてください
- D8 - D11: 決定済み

## 追加の質問

- Q1: 依頼 node には「閉じる」ボタンがあるようなイメージでよい?
- Q2: どの時点で依頼 node が「実行」「評価」される?
  - 依頼 node に 'do it' ボタンがある?
    - この場合, 繰り返し dot it できる?
  - sheet 単位で eval ボタンがある? あるいは load 時に評価されるとか
    - その場合, eval の順序などを決めなくてはならない
    - これは将来, 必要となるかもしれないけど, 今は考えなくていいかも
  - 依頼 node の実装は, 実行可能なグラフの先行事例になると思っている
- Q3: LM agent actor には, 実行時に以下のようなものを与えられると思ってよい?
  - 依頼 node ごとの context として
    - default でその file の全グラフ
    - 指定したら, 他の file や一般的に URL
  - file 単位で system prompt に相当するような共通の指示
    - template に書いておくか
