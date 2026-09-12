import { type Template, TemplateSchema } from './types';

/**
 * toulmin model の template。**step2 で作るのはこれ一つだけ**である (spec/template.md)。
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
