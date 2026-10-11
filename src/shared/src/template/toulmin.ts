import type { KindPlacement } from './seed';
import { type Template, TemplateSchema } from './types';

/**
 * toulmin model の template の**表** (step3 Phase 4 S4-1c で役目が変わった)。
 *
 * step2 ではこれを作り込みの template として直接引いていた。step3 では **template graph の種**
 * (`SEED_TEMPLATES`) で、「Toulmin model を追加」がこれを File の template graph に複製する
 * (`templateGraphOf`)。当てたシートが参照するのは複製された template graph の方である。
 *
 * `TemplateSchema.parse` を通しているのは形式だけの理由ではない — `from` / `to` の
 * 綴り違いを **import 時に** 落とすためである。ここは手で書く表なので、参照の間違いが
 * 一番起こりやすい。
 *
 * 視覚属性 (色・形) は spec の例に載っているが **step3** である
 * (「プロパティと視覚属性の間の対応付け」)。ここには持ち込まない。
 */
export const TOULMIN_TEMPLATE: Template = TemplateSchema.parse({
  // **逆順ドメイン。**id がプロパティの名前空間を兼ねる (`jp.co.metabolics.toulmin.kind`)。
  // template は拡張なので、提供者のドメインを前置する (`spec/propertyEditor.md`「名前」)
  id: 'jp.co.metabolics.toulmin',
  name: 'Toulmin model',
  nodeKinds: [
    { id: 'claim', label: '主張', description: '論証が示そうとしている結論' },
    { id: 'data', label: 'データ', description: '主張の根拠となる事実' },
    {
      id: 'warrant',
      label: '論拠',
      description: 'データが主張を支える理由づけ',
    },
    {
      id: 'rebuttal',
      label: '反論',
      description: '主張や論拠が成り立たない場合',
    },
    { id: 'backing', label: '裏付け', description: '論拠そのものを支える根拠' },
  ],
  edgeKinds: [
    { id: 'supports', label: '支える', from: ['data'], to: ['claim'] },
    { id: 'validates', label: '正当化する', from: ['warrant'], to: ['claim'] },
    {
      id: 'strengthens',
      label: '強化する',
      from: ['backing'],
      to: ['warrant'],
    },
    { id: 'undermines', label: '切り崩す', from: ['rebuttal'], to: ['claim'] },
    {
      id: 'challenges',
      label: '疑問を呈する',
      from: ['rebuttal'],
      to: ['warrant'],
    },
  ],
});

/**
 * Toulmin model の並べ方 (#256)。node の左上の座標で、node の既定の大きさは 160 × 80。
 *
 * ```
 * データ ──支える──▶ 主張
 *            ↗正当化する ↖切り崩す
 *        論拠 ◀─疑問を呈する─ 反論
 *         ↑強化する
 *        裏付け
 * ```
 *
 * Toulmin の図の慣例 (データ → 主張を横に、論拠をその下に) に沿い、**edge の label どうしが
 * 120px 以上離れ、どの edge も node を横切らない**ように置く。種類を 3 列の格子に並べると、
 * 上の段で「正当化する」がデータの node を横切り、label が重なった
 */
export const TOULMIN_PLACEMENT: KindPlacement = {
  data: { x: 0, y: 0 },
  claim: { x: 480, y: 0 },
  warrant: { x: 240, y: 200 },
  rebuttal: { x: 720, y: 200 },
  backing: { x: 240, y: 400 },
};
