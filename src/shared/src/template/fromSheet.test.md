# template graph → Template のテスト

## 何を

- `templateFromSheet` — 種別 `template` の sheet を `Template` に読み替える (step3 Phase 4 S4-1)
- `resolveTemplates` — シートの `templateIds` (`TemplateRef`) を、当てる template の実体に解決する
- あわせて、`edgeKindCandidates` の「任意の端」(`ANY_NODE_KIND`) の扱い

## なぜ

適用先の振る舞い (種類のメニュー・接続の可否・edge の種類の自動決定・property の候補) は、どれも
読み替えた `Template` を受けて動く。**読み替えを誤ると、当てたシートで静かに違う種類が出る** —
説明書きのつもりの edge が種類になる、「任意」と繋がるはずの種類が出ない、など。例外は出ない。

読み替えの規則は「**あらゆる** template graph で成り立つ」主張なので性質として書く。

## どのように

### 生成器

- node は 4 つ、label は `''` / `主張` / `データ` から引く。edge はその間に 0〜6 本、label の有無と
  property の有無を引く
- **小さなプール**にするのは、「label のある node とない node を繋ぐ edge」(任意の端)、「label の無い
  node 同士の edge」(説明書き)、「同じ組の edge が 2 本」、「自己ループ」に当たるため

### 性質

| 性質 | 固定すること |
| --- | --- |
| label のある node ちょうどが node の種類になる | 種類の数え漏れ・数えすぎ |
| 少なくとも一方の端に label がある edge ちょうどが edge の種類になり、label の無い端は「任意」 | 説明書きの edge を種類にしない / 任意の端の向き |
| 読み替えた結果は schema (参照整合性) を通る | edge の端が定義した種類か「任意」だけを指す |
| 適用先で、edge の候補は「端の種類が合う edge の種類」ちょうど。種別の無い端は任意に当たり、両端とも無ければ候補も制約も無い。制約 (繋げない組) は両端とも種類を持つときだけ | **任意の端は種類を自動で決めるだけで、普通の接続を塞がない** (`isTemplateEdge` は変えていない) |

### 例

- 表示名・説明 (本文)・既定値。**種別プロパティは既定値に入れない** (template graph 自身が別の template を
  当てられていても、その種別を適用先に持ち込まない)
- label の無い node 同士の edge は説明書き、label のある node との edge は「任意」の端を持つ
- template id は template graph の sheet から作り、種別プロパティの名前空間になる (`template.<SheetId>.kind`, Q2)
- `resolveTemplates`:
  - **切断面で読む**: 当てた後に template graph の label を書き換えても、当てた時点の種類が出る (仕様: 適用する
    内容は適用先の生成時に決まる)
  - 種別が template でない sheet・無い sheet は黙って落とす
  - **作り込みの id は解決しない** (Q1。Phase 4 より前に作り込みの Toulmin を当てたシートは、ただのシートに縮退する)

## 変異で確かめたこと

- 候補の判定で任意の端を無視する → 候補の性質が落ちる
- 説明書きの edge も種類にする → edge の種類の性質と説明書きの例が落ちる
- 切断面を無視して head で読む → 切断面の例が落ちる
