# SEED_TEMPLATES のテスト

## 何を

`SEED_TEMPLATES` — template graph の**種** (step3 Phase 4 S4-1c, Q1)。「シートを追加 ▾」の
「Toulmin model を追加」が、これを File の template graph に複製する。

## なぜ

step2 の `BUILTIN_TEMPLATES` / `templatesOf` (作り込みの template を id で引く) は撤去した。template は
すべて File の中の template graph で、当てたシートはその切断面を参照する。種は**実行時に引く先ではない**ので、
ここで見るのは「何が種として並ぶか」と「種の表が正しいか」だけである。

## どのように

- 種は Toulmin model ひとつ
- 種は template の参照整合性を満たす (`from` / `to` の綴り違いは import 時に落ちる)

作り込みの id を解決しない (縮退する) ことは `fromSheet.test.ts` が、種を複製して読み替えると同じ種類に
戻ることは `seed.test.ts` が見る。
