# encoding.test.ts — agent に読ませる完全な encoding のテスト仕様

## 何を

`encodeFile` (File の trunk の projection を行指向のテキストに落とす) を検証する。

## なぜ

agent は graph をこのテキストで読み、書く道具に node・edge の id を渡して編集する (設計 D4)。
**欠けると、agent は見えていないものを壊す** — 見えない property を上書きする、知らない node と
重ねて置く、など。人間向けの graphdown と違い、ここでは「欠けない」が要件そのものである。

## どのように

- **例**: id・本文・label・layout が行に出る / 改行を含む本文が 1 行に収まる (JSON の文字列) /
  template を渡すと種別の一覧・種別の名前・種別の説明 (種類ごとの指示、D13) を注釈に出す。見た目を持つ種類 (group・image) は一覧に見た目を添える (template-update K11。agent が group の種類で足すと group node になることを読めるように) /
  template を引けない種別プロパティ・system の property に注釈が付く / template は引けるが**種類が今の template に無い**種別プロパティは「template "…" に無い種類」と注釈する (「引けない」と言うと agent が template を読めないと誤解する、template-update D5) / **両端の組が種類の規則に合わない edge** には違反の注釈を付ける (画面の破線の印と同じ判定 `edgeViolationOf`。規則を満たす向きなら付けない) / template が配った property (`${templateId}.<名前>`、template-update K7) には template の名前と書いた名前を注釈する / 読むときに補った既定値・template が決めている値 (editable: false)・型に合わない値は**注釈で**言い、`prop` の行にはしない (補った値は File に無いので、書かれた値と区別できるように。T7) / 後から当てた template のプロパティ (#355) には、その template の名前 (引けなければ「引けない」) を注釈する / module の注釈 (依頼の状態など、
  `AnnotateNode`) は node の行の直後に `# ` を付けて出し、無ければ何も足さない (依頼の注釈そのものは依頼の
  module の `requestHeadless.test.ts` が見る、計画 node-actions-request-module.md B3) /
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
