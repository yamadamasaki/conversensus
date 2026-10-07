# 上限の一覧

> 利用者が出会いうる上限と、受信の守りとして置いた上限をまとめる (2026-10-07, security review の L2 を機に)。
> **値の原本はコードの定数**で、ここはその写しである。値を変えたら、この表も直す。いずれマニュアルに載せる。

## 利用者が出会いうるもの

| 何の上限 | 値 | 超えたとき | 定数 (場所) |
| --- | --- | --- | --- |
| 画像 1 枚の大きさ | 5 MiB | 貼れない (知らせが出る)。PDS の設定値でもある | `MAX_BLOB_SIZE` (`shared/src/blob.ts`) |
| 表示する画像の形式 | png・jpeg・gif・webp | それ以外は表示しない (SVG も表示しない) | `DISPLAYABLE_IMAGE_TYPES` (`client/src/atproto/blob.ts`) |
| node の本文 (Markdown) の画像 | 読み込まない | 「画像: …」のリンクになり、押すと新しいタブで開く | `MARKDOWN_COMPONENTS` (`client/src/markdownComponents.tsx`) |
| まだ送っていない編集の、画面の中での保持 | 直近 500 件 | 表示は「500 件以上」。溢れた分は次の同期 (起動時・オンラインに戻ったとき・今すぐ同期) で送る | `REMOTE_QUEUE_MAX` (`client/src/atproto/remoteSyncQueue.ts`) |
| 1 人が 1 つの File に書ける編集 (batch) の数 | 10¹² − 1 | 実用上は届かない (PDS の rkey の桁) | `MAX_SEQ` (`client/src/atproto/batchRkey.ts`) |

## 受信の守り (他人の repo から読むとき)

参加者は自分の PDS に何でも書けるので、読む側で量と形を限る。上限は正常な使い方に十分な余裕をとってあり、
**超えるのは異常か悪意**である。

| 何の上限 | 値 | 超えたとき | 定数 (場所) |
| --- | --- | --- | --- |
| 1 人の 1 File 分の読み出し | 1,000 ページ (10 万件) | その人の repo を「読めない」として扱う。他の参加者の受信は続く | `MAX_PREFIX_PAGES` (`client/src/atproto/rangeFetch.ts`) |
| 名簿で読みに行く repo の総数 | 500 | 超えた分は読まない (DID の順で後ろのもの)。コンソールに出す | `MAX_ROSTER_REPOS` (`client/src/sync/readRoster.ts`) |
| 1 人の承認から辿る招待者 | 10 | それ以上の招待者は辿らない | `MAX_INVITERS_PER_ACTOR` (`client/src/sync/readRoster.ts`) |
| 受信する編集の clock | 2⁴⁸ | その編集を読み飛ばす | `MAX_REMOTE_CLOCK` (`client/src/atproto/batchMapper.ts`) |
| 受信する編集の形 | 検証に通るもの | 1 件ずつ検証し、通らないものを読み飛ばす。他の編集は受け取る | `isAcceptableRemoteBatch` (`client/src/atproto/batchMapper.ts`) |

## 読み出しの打ち切り (PDS の応答がおかしいとき)

| 何の上限 | 値 | 超えたとき | 定数 (場所) |
| --- | --- | --- | --- |
| File の列挙のリクエスト数 | 200 | 打ち切る (rkey の順序の前提が崩れたことの検知) | `MAX_FILE_ENUMERATION_REQUESTS` (`client/src/atproto/rangeFetch.ts`) |
| Folder などの全件取得 | 100 ページ (1 万件) | 打ち切って警告する | `MAX_LIST_ALL_PAGES` (`client/src/atproto/rangeFetch.ts`) |
