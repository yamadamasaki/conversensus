# encoding.test.ts — agent に読ませる完全な encoding のテスト仕様

## 何を

`encodeFile` (File の trunk の projection を行指向のテキストに落とす) を検証する。

## なぜ

agent は graph をこのテキストで読み、書く道具に node・edge の id を渡して編集する (設計 D4)。
**欠けると、agent は見えていないものを壊す** — 見えない property を上書きする、知らない node と
重ねて置く、など。人間向けの graphdown と違い、ここでは「欠けない」が要件そのものである。

## どのように

- **例**: id・本文・label・layout が行に出る / 改行を含む本文が 1 行に収まる (JSON の文字列) /
  template を渡すと種別の一覧・種別の名前・種別の説明 (種類ごとの指示、D13) を注釈に出す /
  template を引けない種別プロパティ・system の property に注釈が付く / 応答を求める node には状態・
  回数・宛先を注釈する (状態は導出なので注釈。前の送信への答えしか無ければ未回答、agent 段 4) /
  例が読み戻せる
- **性質**: どんな File も、**注釈 (`#` の行) を除いた行から欠けなく復元できる**。「欠けない」は
  全称命題なので性質で書く
  - 読み戻しは**テストの中だけ**に書く。本体に逆向きは作らない (D4: 書くのは op)
  - 比べる前に揃えるもの: layout の並び (encoding は node の順に出す)、空の property と空の
    `templateIds` (どちらも「無い」と同じ意味で、書く行が無い)
  - 生成器: 文字列には改行・`"`・`\`・`#`・`->` を混ぜる (行の形を壊しうる文字)。property の名前は
    custom・system・extension・種別プロパティの 4 つの小さなプールから引き、値は任意の JSON。
    layout は node・edge の一部と、**対応する要素の無い layout** にも付ける (落としやすい所)。
    parent・edge の端は同じ sheet の node から引く
  - 確かめ: 対応の無い layout を出さないように壊すと、この性質が落ちる
