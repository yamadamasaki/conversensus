# conversensus roadmap

## step 0 (origin)

- 標準的な web アプリケーションとして動作する
  - サーバ／クライアント・アーキテクチャで動作する
  - サーバ上のデータベースをストレージとして利用する
- ファイルベースのストレージを利用する
- 単一ユーザで利用する (認証なし)
- 基本的なグラフ構造 (Node, Edge) を編集できる
- 基本的なグラフ構造 (Node, Edge) を表示できる
- Group はない
- File は複数作れる
- Sheet は各 File に一つのみ
- Property は Edge の label のみ
- View は graph のみ
- Template はない

これ以降は, 機能上の進行と基盤上の進行に分けて考える. 全体としては, この二つが interleave する形で進行する.

## platform progression

### platform step 1 (ATProto/PDS)

- 複数ユーザで利用する (認証あり)

### platform step 2 (ATProto/)

- platform step 1 が終了した段階で考える

## function progression

### function step 1

個人がスタンドアロンで利用する場合の, 一画面上の操作を一通り実装し, これだけでツールとして利用できるようにする.

see https://github.com/yamadamasaki/conversensus/milestone/2
