import { describe, expect, test } from 'bun:test';
import type { Sheet, SheetId } from '../schemas';
import { templateFromSheet, templateIdOf } from './fromSheet';
import { kindLabelIn } from './kindLocale';
import { CORE_SEEDS } from './registry';
import { templateGraphOf } from './seed';
import { localizeSeed, multilingualSeed } from './seedLocale';
import { TOULMIN_SEED, TOULMIN_TEMPLATE } from './toulmin';
import { TemplateSchema } from './types';

const idsOf = (t: typeof TOULMIN_TEMPLATE) => ({
  nodes: t.nodeKinds.map((k) => k.id),
  edges: t.edgeKinds.map((k) => ({ id: k.id, from: k.from, to: k.to })),
});

describe('localizeSeed (#330)', () => {
  test('en では Toulmin の種類名が英語になる', () => {
    const en = localizeSeed(TOULMIN_SEED, 'en');
    expect(en.nodeKinds.find((k) => k.id === 'claim')?.label).toBe('Claim');
    expect(en.edgeKinds.find((k) => k.id === 'supports')?.label).toBe(
      'supports',
    );
  });

  test('種の表の言語 (ja) と、訳の無い言語では表のまま', () => {
    expect(localizeSeed(TOULMIN_SEED, 'ja')).toBe(TOULMIN_TEMPLATE);
    expect(localizeSeed(TOULMIN_SEED, 'fr')).toBe(TOULMIN_TEMPLATE);
  });

  // 以下はすべての種について見る。種を足したときに訳し漏れ・形の崩れをここで捕まえる
  for (const seed of CORE_SEEDS) {
    describe(seed.template.name, () => {
      const en = localizeSeed(seed, 'en');

      test('訳しても id と端 (from / to) は変わらず、template の形のまま', () => {
        expect(idsOf(en)).toEqual(idsOf(seed.template));
        expect(() => TemplateSchema.parse(en)).not.toThrow();
      });

      test('en ではすべての種類名が訳されている (日本語の字が残らない)', () => {
        const labels = [
          ...en.nodeKinds.flatMap((k) => [k.label, k.description ?? '']),
          ...en.edgeKinds.map((k) => k.label),
        ];
        for (const label of labels) expect(label).not.toMatch(/[぀-ヿ一-鿿]/);
      });
    });
  }
});

describe('multilingualSeed (#356)', () => {
  test('複製する人の言語の名前にし、表の言語 (ja) と訳のすべての言語の名前・説明を持つ', () => {
    const en = multilingualSeed(TOULMIN_SEED, 'en');
    const claim = en.nodeKinds.find((k) => k.id === 'claim');
    expect(claim).toMatchObject({
      label: 'Claim',
      labels: { ja: '主張', en: 'Claim' },
      descriptions: { en: 'The conclusion being argued for' },
    });
    expect(claim?.descriptions?.ja).toBe(
      TOULMIN_TEMPLATE.nodeKinds.find((k) => k.id === 'claim')?.description,
    );
    expect(en.edgeKinds.find((k) => k.id === 'supports')?.labels).toEqual({
      ja: '支える',
      en: 'supports',
    });
  });

  test('label の無い edge の種類は、表の言語の名前を持たない', () => {
    const seed = {
      template: TemplateSchema.parse({
        id: 'template.t',
        name: 'T',
        nodeKinds: [{ id: 'a', label: 'A' }],
        edgeKinds: [{ id: 'e', label: '', from: ['a'], to: ['a'] }],
      }),
    };
    expect(multilingualSeed(seed, 'en').edgeKinds[0]?.labels).toBeUndefined();
  });

  // すべての種について、template graph に複製して読み替えると、どの言語の参加者も自分の言語の名前を引ける
  for (const seed of CORE_SEEDS) {
    test(`${seed.template.name}: 複製した template graph から、ja と en の名前を引ける`, () => {
      const sheetId = '00000000-0000-4000-8000-0000000000a1' as SheetId;
      let n = 0;
      const newId = () =>
        `00000000-0000-4000-8000-${(++n).toString().padStart(12, '0')}`;
      const sheet: Sheet = {
        id: sheetId,
        name: 'T',
        ...templateGraphOf(multilingualSeed(seed, 'en'), newId, seed.placement),
      };
      const read = templateFromSheet(sheet, templateIdOf(sheetId));
      const ja = localizeSeed(seed, 'ja');
      const en = localizeSeed(seed, 'en');
      expect(read.nodeKinds.map((k) => kindLabelIn(k, 'ja'))).toEqual(
        ja.nodeKinds.map((k) => k.label),
      );
      expect(read.nodeKinds.map((k) => kindLabelIn(k, 'en'))).toEqual(
        en.nodeKinds.map((k) => k.label),
      );
    });
  }
});
