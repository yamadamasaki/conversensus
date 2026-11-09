import { describe, expect, test } from 'bun:test';
import { CORE_SEEDS } from './registry';
import { localizeSeed } from './seedLocale';
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
