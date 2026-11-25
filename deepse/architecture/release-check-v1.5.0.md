# v1.5.0 を出した後の確認

> リリース手順 ([release-procedure.md](./release-procedure.md)) の「リリース確認」の手順書。
> 一般の確認 (ヘッダ・`client-metadata.json`・PDS の `_health`・`version.json`・`crossOriginIsolated`・OAuth) は
> [user-test-environment.md](../requirements/user-test-environment.md) §11.2 に従い、ここでは **v1.5.0 で変わった所**だけを確かめる。

本番は `https://app.conversensus.site/`。service worker が前の版を持っているので、**開いたら一度再読み込みしてから**見る
(右下に「新しい版があります」が出ていれば押す)。2 人で見る項目は、本番のアカウントを 2 つ (以下 A・B) 使う。
B は別のブラウザ (またはプライベートウィンドウ) で開く。

## 1. いちばん先に: 送信が詰まっていないこと (#409)

v1.5.0 から、label の位置 (`edge.setLabelOffset`) を相手に送る。v1.4.0 までは送らずに手元へ溜めていたので、
**更新した端末は、起動時に溜まっていた label の位置をまとめて送り直す**。値は送る前に整数へ丸める
(`remoteReadyOp`)。丸めが効いていないと PDS が batch を断り、**その端末の以後の送信がすべて止まる**。

v1.4.0 で label をドラッグしたことのある File を持つ端末 (できれば普段使っている端末) で確かめる。

| # | 手順 | 期待 |
| --- | --- | --- |
| C1 | その端末で v1.5.0 を開き、File を 1 つ開いて少し待つ。開発者ツールのコンソールとネットワークを見る | `putRecord` / `applyWrites` が 400 で失敗していない。`[sync]` の警告が続かない |
| C2 | その File で node を 1 つ足す (B が参加している File なら B の画面を見る) | 左下が「アカウントに保存済み」になる。B の画面にも出る |
| C3 | (任意) `PDS_URL=https://pds.conversensus.site REPO=<A のハンドル> bun run scripts/inspect-remote-batches.ts` | 4 項目とも通る (「presentation 非搭載」は、label の位置が layout になったので引っかからない) |

C1・C2 が満たされなければ、リリース手順の「戻すとき」に従って前の版を出し直し、原因を調べる。

## 2. 線種と label の位置が共有される (#409)

| # | 手順 | 期待 |
| --- | --- | --- |
| C4 | A と B が参加する File で、A が edge を右クリックして線種を Step にし、label をドラッグして動かす | B の画面でも線種が Step になり、label が動く。A が再読み込みしても残る |

## 3. template の動的適用 (template-update 段 2)

A だけで確かめる。File を 1 つ作る。

| # | 手順 | 期待 |
| --- | --- | --- |
| C5 | 「template 付きで Sheet を追加 ▾」→「+ template graph」で template graph を作る。label「根拠」「主張」の node を置き、「根拠」から「主張」へ edge を引いて label を「支える」にする | template graph の地が薄い紫になる (#404) |
| C6 | 既にある Sheet の「…」→「template を当てる」で当て、「根拠」「主張」を作って繋ぐ | 繋ぐと「支える」が付く |
| C7 | template graph に label「反論」の node を足す | 右下の「template の版」に新しい版の知らせが出る。Sheet の「…」にも「…を最新の版にする」が出る |
| C8 | 知らせの「最新の版にする」を押し、空いた所をダブルクリックする | 知らせが消え、種類のメニューに「反論」が出る |
| C9 | template graph で「支える」の edge を消し、知らせから最新の版にする | 当てた Sheet の「支える」が消えずに残り、警告色の破線になる |
| C10 | 当てた Sheet の「…」→「…を外す」 | メニューから template の種類が消え、作った node は残る |

## 4. 操作の手直し

| # | 手順 | 期待 |
| --- | --- | --- |
| C11 | 一部を拡大して見たまま別のタブへ移り、戻る (#405) | 見ていた位置と拡大のまま戻る |
| C12 | 大きな node の端を掴み、カーソルだけを小さな group の上に置いて離す (#407) | group に入る |
| C13 | index で graph node を 1 回クリックする (#402) | 「名前を変える」が出て、押すと名前を書き換えられる。ダブルクリックは Sheet を開く |
| C14 | 同じ接続点に繋がる edge のうち下の 1 本を、線の途中で選んでから端を掴んで付け替える (#410) | 選んだ edge が付け替わる |

## 5. 文書

| # | 手順 | 期待 |
| --- | --- | --- |
| C15 | `https://docs.conversensus.site/` の入門「グラフのカタ」を日本語・英語で開く | template graph の節 (種類の書き方・template を育てる・外す) と図が出る |

## 結果

| # | 結果 | 備考 |
| --- | --- | --- |
| C1〜C3 | | |
| C4 | | |
| C5〜C10 | | |
| C11〜C14 | | |
| C15 | | |
