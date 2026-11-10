# AuthorAvatars.test.tsx — 書いた人の avatar のテスト仕様

## 何を

`AuthorAvatars` を検証する。node・edge を書いた人を、頭文字の丸 (色は DID から決まる) と agent の bot の印で描く部品である
(#354、設計 agent-actor.md D2a)。作者・表示名・宣言は context (`AuthorsProvider`) から読む。

## なぜ

- 作者が多い node で丸を全部並べると node を覆う。重ねて出し、必要なときだけ広げる
- agent が書いたものは、人が読むときに見分けたい (設計 A7)。裏付けの有無も見分ける (D2)
- 色が DID で決まらないと、同じ人が node ごとに違う色になり、見分けに使えない

## どのように

- 作者の頭文字を順に出し、読み上げ (`aria-label`) には全員の名前を並べる
- `MAX_STACKED` 人を超える分は「+n」。hover で広げてハンドル名を並べ、離れると重ねに戻す
- agent は頭文字の代わりに bot の印。裏付けありと名乗りのみを見分け (`data-avatar-agent`)、名前にも添える
- 作者がいない・表示が off (context が無い) なら何も描かない
- 色は DID で決まる (同じ人は同じ色、違う人は違う色)。頭文字はハンドル名の最初の字。DID のままなら最後の `:` の後の字
