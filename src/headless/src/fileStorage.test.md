# fileStorage.test.ts — file に保存する Storage のテスト仕様

## 何を

`FileStorage` (`localStorage` の代わりに、中身を JSON の file 1 つに置く `Storage`) を検証する。

## なぜ

headless の client は bun のプロセスで動き、bun には `localStorage` が無い。client は端末の id・
ログインのセッション・参加の初期化の印を `localStorage` に置くので、代わりが要る。
**起動をまたいで中身が残らないと、起動のたびに新しい端末の id になり**、actor (`did#deviceId`) が
増え続ける (計画 `agent-stage2-headless.md` 完了基準 6)。

## どのように

- **例**: 空から始まる / 作り直した後も読める / clear が file にも効く / 値は文字列になる /
  一時 file を残さない / 形の違う file は黙って空にせず例外にする (端末の id を黙って捨てると actor が増える)
- **性質**: どんな書き込みの列 (set・remove・clear) でも、**作り直した後の中身**は、同じ列を `Map` に
  行った結果と一致する。「file に書いて読み直すと元に戻る」という往復の全称命題なので性質で書く
  - 生成器: キーは 4 つの小さなプールから引く。広いと同じキーを二度引かず、上書き・削除の後に
    読み直す場合が試されない。値は任意の文字列 (JSON に落として戻ることを見るため、制御文字も含める)
