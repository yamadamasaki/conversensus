# viewLink のテスト

## 何をテストするか

`viewLink.ts` は、グラフ view のアドレスを URL の fragment にし、また読み戻す (#251 Deep Link)。

- `viewHash`: trunk は `#/v/<fileId>/<sheetId>`、branch は `#/v/<fileId>/<sheetId>/<branchId>`。
  切断面と highlight は載せない
- `parseViewHash`: 載せた項目 (file・sheet・branch) を戻し、切断面は `'head'` にする。
  後の版が足す query (`?…`) は読み飛ばす。view のリンクでなければ null
- `viewUrl`: 元の URL の path と query は残し、fragment だけを替える

## なぜテストするか

リンクは**他の人・他の端末・後の版**が読む値である。

- 往復が崩れると、渡したリンクが別の view (branch ではなく trunk など) を開き、しかも開いた側には
  間違いだと分からない
- ログインの戻り (OAuth) も fragment を使う (`#state=…&code=…`)。これを view のリンクと取り違えると
  ログインの途中で画面が動く。`#/` で始まるかどうかで見分けることを固定する
- 外から来た値なので、壊れた値 (id の形が違う・段の数が違う・壊れた `%`) を開かず、投げもしない
- 切断面と highlight を載せないのは、いまの画面がアクティブな view に最新の姿しか出せないから
  (`viewLink.ts` の冒頭)。後で query に足すとき、古い版が読み飛ばして開けることを固定する

## どのようにテストするか

- 往復は**性質**で書く: あらゆる UUID の file・sheet と、有無を問わない branch で
  `parseViewHash(viewHash(a))` が a (切断面だけ `'head'`) に戻る。入れるアドレスの切断面はわざと vector にして、
  載らないことも同時に見る。id は UUID の生成器から引く — 形の検査 (zod) を通る値の全体が対象だから
- 「投げない」も性質で書く: 任意の文字列と、頭に `#/v/` を付けた任意の文字列
- view のリンクでないものは例で並べる (空・OAuth の戻り・頭が違う・段の過不足・id の形・壊れた `%`)
