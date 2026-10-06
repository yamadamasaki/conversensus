# blob.test.ts — 表示する画像の型のテスト仕様

## 何を

`displayableImageType` (画像の Blob URL を作るときの型) を検証する (security review M3)。

## なぜ

画像の MIME は、画像を貼った人が書いた property が決める。そのまま Blob の型にすると、他の参加者が
`text/html` や `image/svg+xml` (script を持てる) の「画像」を置いたとき、同じ origin の `blob:` URL ができる。
`<img>` の中では script は動かないが、「画像を新しいタブで開く」で app の origin の文書として開かれうる。
表示する型をラスタ形式に絞り、それ以外は中身を解釈させない型 (`application/octet-stream`) にする。

## どのように

- png・jpeg・gif・webp はそのまま (大文字の型も小文字にそろえる)
- html・SVG・XHTML・空の型は `application/octet-stream`

SVG の画像はこれで表示されなくなる (今までも貼り付けの経路はラスタ形式を前提にしている)。
