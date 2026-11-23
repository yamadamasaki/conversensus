# effective のテスト仕様

## 何を

実効の property (template-update K8・K9・K12、計画 T7): 要素の property と template から、読むときの値を求める。

- `effectiveTemplateProperties`: 種類が配る property (`${templateId}.<名前>`) ごとの姿 (値・出どころ・型の判定)
- `effectiveProperties`: 読むときの property の全体
- `copiedDefaultsOf`: 作成時に写す既定値 (template の名前空間の外のもの)

## なぜ

既定値を作成時に写すと、template を直しても既にある要素に効かない (動的適用 K2 が成り立たない)。読むときに
補えば、値を設定していない要素には新しい既定値が効く。editable: false の値は「常に template の既定値」(K8) で、
要素が別の値を持っていても (他の参加者の op は検証を通らずに届く) 読む側でそれを採らない。

**補うのは template の作者が書いた property だけ**である。依頼の宛先 (`app.conversensus.request.addressee`) の
ような module の既定値は要素ごとの状態であり、「宛先を持つ node が依頼」という印でもあるので、写し続ける。
写すのをやめると、新しく作った依頼が依頼として見えなくなる。

## どのように

### 性質

「editable: false なら既定値、そうでなければ要素の値、無ければ既定値。型が読めれば判定を添える」は、要素の値・
既定値・型・editable の**あらゆる**組み合わせで成り立つ主張なので、性質として書く。

- 生成器: 値は「無い」・型に合うもの・合わないもの (`'高'`・`''`・`3`・`'x'`) の小さなプール。型は数・列挙・
  optional・**読めない型** (`broken(`) — 読めない型には判定を添えない (型の無い property として扱う)
- 出どころ (`fixed`・`own`・`default`) も同じ規則で固める

### 例

- 作成時に写すのは template の名前空間の外の既定値だけ (依頼の宛先は写し、作者の `owner` は写さない)
- 補うのは template の名前空間の property だけ。既定値の無い宣言も姿を持ち、必須なら `missing`
- 種類を持たない要素・知らない種類・node と edge の取り違えでは空
- 読むときの全体: 既定値を補い、editable: false の値を template の値にし (要素の `bob` ではなく `alice`)、
  値の無い宣言は含めない。template に関わらない property (`memo`) はそのまま
