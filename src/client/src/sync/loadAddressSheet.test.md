# loadAddressSheet のテスト

## 何を

`loadAddressSheet` — アドレスが指すシートを手元の正典から求める (step3 Phase 3 S3-5)。見るだけの
pane (multiple モード) の中身はこれで決まる。

## なぜ

見るだけの pane は File・branch の画面の仕組みの外にあり、**アドレスだけから**中身を決める。
branch のアドレスは id しか持たないので、branch のメタ (分岐点・branch 専用の op-log の File) を
trunk の畳み込みで解決する手順が要る。ここを誤ると、branch の pane が trunk の姿を出す (静かに違う)。

また、返す `fileIds` が読み直しの契機を決める (`usePaneSheet`)。branch のアドレスで branch 専用の
op-log の File を返し忘れると、branch に書いても pane が読み直さない。

切断面での正しさ (`projectAddress` の中身) は shared の `address.test.ts` が性質で固定しているので、
ここでは**解決の手順**と**読んだ File**を例で見る。

## どのように

trunk に sheet と node A、branch (メタは trunk の op-log に記録) に node B を置く。

- trunk のアドレスは trunk の op-log だけから求まり、`fileIds` は trunk だけ
- branch のアドレスは A と B の両方を持ち、`fileIds` は trunk と branch 専用の op-log
- 無いシート・無い branch は `missing`
