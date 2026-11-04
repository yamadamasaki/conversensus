# ドキュメントと例題

[Step 3](./step3.md) までに構築した基盤をドキュメント化し, その基盤自身を使って幾つかの例題を記述し, ユーザに提供する. また, その過程で必要となった機能を拡張機能として実装する.

## ドキュメント

以下のようなドキュメントを作成する.

## ユーザ向けドキュメント

### Conversensus 入門 (Introductory Guide to Conversensus)

読者は, 普通の conversensus ユーザ, あるいは潜在的ユーザ. 使い始めるには, これを読めばよい. ただし, 網羅的ではないし, 詳細までは書かない.

ただし, ontology of conversensus への参照を章ごとに付けることにする.

___最初は, [graphdown](./graphdown.md) の dog food にしようと思っていたけど, あまり向いていないと思ったので止める___

#### 目次案

1. グラフとは何か
1. 始める
1. グラフの置き場所
1. グラフで考える
1. 成長するグラフ
1. グラフで対話する
1. グラフのカタ
1. グラフを実行する (未)

#### 依頼事項

- 原稿の推敲
- ここで使う例題のシナリオの作成
  - 章ごとでもいいし, 全体を通して一つでも良い
- そのシナリオに従った conversensus でのグラフ記述
- 必要なタイミングでのスナップショット
  - 必要なタイミングは, 原稿のコード・ブロックの `<figure>...</figure>` としてマーキングしている. これをベースに適宜加減してほしい

そのために MCP のようなものがあった方がよければ, 作ろう.

### Conversensus オントロジ (Ontology of Conversensus)

読者は, conversensus について深く知りたいユーザ. conversensus のオントロジ (node, edge, graph, file, sheet, folder, branch, commit, merge, actor, invitation, participation, ...) をコアにして, それとアーキテクチャ, ユーザ・インタフェイスの間の対応付けを記述する. このドキュメントが, オントロジ/アーキテクチャ/UI の橋渡し役となる. 一般的に言う users manual に近い.

原本は ~~markdown~~ conversensus で書く.

説明のための図として conversensus の graph を活用する. この graph は, ある意味で conversensus のグラフで記述された仕様となる.

ここで [graphdown](graphdown.md) が使えるか, 使えるとしてその仕様はどうなるかを検討する.

#### 依頼事項

- コードへのリンク
- (graph を含む) このドキュメントの保守/更新

## 開発者向けドキュメント

### アーキテクチャ記述 (Architecture Description)

普通の意味での, アーキテクチャ記述 (markdown). この作成は, coding agent に任せたい. 必要ならば, できるだけ図表を駆使して human agent にも理解しやすいように書いてほしい. conversensus の保守, 開発に必要な情報を簡潔にまとめる.

### アーキテクチャ対話 (Architecture Conversation)

私がアーキテクチャ記述に基づいて, coding agent に必要なところや難しいところを深掘りしてインタビュし, その結果を conversensus の graph として残す. graph FAQ?

optional.

## 例題

- プレゼンテーション
  - anarchitecture presentation
    - FigJam で描いた 2025/11/1 の講演のスライドを改訂して, conversensus の graph とする
    - プレゼンテーション用の拡張機能があってもいいかもしれない (あまり本質ではない)
- 要求開発
  - CoatingMind
    - 2026/2-3 に開発した A 社の工場床面塗装の評価 PoC 用のドキュメントを conversensus の要求記述グラフとして書き直す
    - Upper Ontology との統合など, 実装が必要かもしれない
- 教育/コンサルテーション
  - KnowledgeGrapher
    - 2024-2025 に開発した, 教育/コンサルテーション向けのグラフ・ベースのディスカッション・ツール
    - これを conversensus の graph を用いたアプリケーションとして提示する
