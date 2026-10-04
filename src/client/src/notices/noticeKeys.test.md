# noticeKeys.test.ts — 通知の既読の鍵のテスト仕様

## 何を

既読の鍵 (`overwriteNoticeKeyOf` / `conflictNoticeKeyOf`) を検証する (step3 Phase 6 S6-1a, 設計 F3)。

## なぜ

既読の鍵は「どの端末で検出しても同じ値」かつ「別の出来事には別の値」でなければならない。

- **上書きの報告**: 溜めるときの鍵 `overwriteKeyOf` は batchId を含まない。そのまま既読の鍵に
  すると、**同じ対象への将来の上書きまで**既読になって二度と出ない。上書きした側とされた側の
  batchId を足す
- **競合**: fork の同一性 `conflictKeyOf` と同じ値にする。同じ競合の通知 (検出した側) と
  fork の到着 (届いた側) は同じ出来事なので、片方を閉じたらもう片方も出さない

## どのように

- **上書きの鍵の単射は性質で書く**: 「同じ鍵 ⇔ mine も theirs も同じ」。batch は 3 つのプールから
  引くので、片方だけ違う組・入れ替わった組 (mine と theirs が逆) を頻繁に引く
- 対象・単位 (category / aspect) が違えば別の鍵 (例)
- 競合の鍵が `conflictKeyOf` と一致する (例)
