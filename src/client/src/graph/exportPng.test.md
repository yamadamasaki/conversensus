# exportPng.test.ts — PNG 書き出し

step3 Phase 0 S0-2 で `GraphEditor` から切り出した。

## 何を

書き出すファイル名 (`pngFileName`)。

## なぜ / どのように

画像を作る部分 (`exportPng`) は `html-to-image` と React Flow の関数を呼ぶだけの薄い配線なので
単体では見ない (CLAUDE.md の「自明なコード」)。happy-dom では描画できず、見ても意味が無い。
自前の判断があるのはファイル名だけなので、そこを例で固定する。

| テスト | 固定すること |
| --- | --- |
| `<File 名> - <Sheet 名>.png` | 形 |
| 使えない文字は `_` | 主要 OS でファイル名に使えない文字の置き換え |
