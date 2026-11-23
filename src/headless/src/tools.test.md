# tools.test.ts — agent が書く道具のテスト仕様

## 何を

`tools.ts` の道具 (引数 → GraphEvent) を検証する。node の add・setContent・setProperty・move・
remove と、edge の add・setLabel・setProperty・remove、それに位置の自動決め (`autoPlace`)。

## なぜ

- 設計 D4 は「道具は**既存の op に 1 対 1**」と決めた。道具は GraphEvent を作り、`graphEventToOps`
  が op に落とす (UI と同じ経路)。**道具 1 回が意図した op の batch 1 つになる**ことをここで固定する
- agent と人間を対等に扱う (設計 §1.1) — **UI ができないことは道具もできない**。種別を後から変える、
  system の property を書く、template の規則に反して繋ぐ、を道具が通すと、agent だけが規則の外に出る

## どのように

- **道具 → op**: 道具ごとに、出る op の種類の並びを見る (`test.each`)。node を足すときは位置の
  `node.setLayout` が同じ batch に乗る (UI と同じ)。property は**変えた 1 つだけ**が op になり、
  value を省くと消す
- **種別** (UI の `GraphEditor` と同じ規則):
  - node を種別付きで足すと、label・種別プロパティ・種類の既定値が入る。知らない種別は断る
  - ただし **template の名前空間の既定値 (`${templateId}.<名前>`) は写さない** — 読むときに補う (template-update K12)。
    名前空間の外の既定値 (依頼の宛先など、module の印) は写す
  - 見た目を持つ種類 (group) で足すと、その見た目の node になる (template-update K11、#406)
  - 種別プロパティと system の property は書けない (足すときの properties でも)
  - template が値を決めている property (editable: false、template-update K8・T8) は、足すときも書き換えるときも
    断る。種類を持たない node なら同じ名前でも書ける (template の制約の外)。読む側は既に template の値を採るが、
    書かせると op-log に効かない値が溜まり、人には「書いたのに変わらない」に見える
  - edge の種別の候補 (`edgeKindCandidates`) が 1 つなら自動、複数なら選ばせる、同じ template の
    要素どうしで 0 なら繋げない。種別の無い node どうしは自由に繋げる
  - 片端が「任意」の種類 (例: 主張 → 任意の node の `external`) は、候補が 1 つでも自動では付かない。kind を
    渡さなければラベルなしで繋ぎ、渡せば付く (template-update K15、UI の「ラベルなしで繋ぐ」と同じ)
  - 種別のある edge の label は変えられない
- **検め**: 無い node・edge を指すと断る。group でない node の中には入れない
- **自動で置く**: 例 (一番下の node の下、空の group は枠の内側から) と、性質:
  **どんな兄弟の並びでも、自動の位置の箱は兄弟の箱と重ならない**。全称命題なので性質で書く
  - 生成器: 兄弟は 0〜6 個、座標は負も含む、高さには数でない値 (`'auto'`) も混ぜる — layout の
    高さは文字列でありうる (`NodeLayoutSchema`)。そのときは既定の高さと見なす。**画面で測った
    高さは headless からは見えない**ので、本文の長い node の下には重なりうる (この性質の外)
