import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import type { Sheet, SheetId } from '../schemas';
import { templateFromSheet, templateIdOf } from './fromSheet';
import { kindPropertyOf } from './kind';
import {
  displayKindLabel,
  KIND_LABEL_PROPERTY_PREFIX,
  kindDescriptionIn,
  kindDescriptionPropertyOf,
  kindLabelIn,
  kindLabelPropertyOf,
  kindPropertyLabels,
  translationProperties,
  translationsIn,
} from './kindLocale';
import { type Template, TemplateSchema } from './types';

/** 言語の小さなプール。見る人の言語に訳が無い場合に当たるため */
const LOCALES = ['ja', 'en', 'fr'] as const;
/** 名前の小さなプール。書き換えた label が、たまたま別の言語の訳と同じになる場合に当たるため */
const NAMES = ['主張', 'Claim', 'Thèse', '反論', 'メモ'] as const;

const arbTranslations = fc.dictionary(
  fc.constantFrom(...LOCALES),
  fc.constantFrom(...NAMES),
);

/** node の種類 1 つと edge の種類 1 つを持つ template。訳は引く */
const templateOf = (
  id: string,
  nodeLabels: Record<string, string>,
  edgeLabels: Record<string, string> = {},
): Template =>
  TemplateSchema.parse({
    id,
    name: 'T',
    nodeKinds: [{ id: 'claim', label: '主張', labels: nodeLabels }],
    edgeKinds: [
      {
        id: 'supports',
        label: '支える',
        labels: edgeLabels,
        from: ['claim'],
        to: ['claim'],
      },
    ],
  });
const T = 'template.a';
const kindOf = (templateId: string, kind: string) => ({
  [kindPropertyOf(templateId as Template['id'])]: kind,
});

describe('displayKindLabel (#356): 性質', () => {
  test('label が種類の名前かその訳なら見る人の言語の訳 (無ければ template graph の名前)、それ以外は label のまま', () => {
    fc.assert(
      fc.property(
        arbTranslations,
        fc.constantFrom(...NAMES),
        fc.constantFrom(...LOCALES),
        (labels, label, locale) => {
          const template = templateOf(T, labels);
          const names = ['主張', ...Object.values(labels)];
          const expected = names.includes(label)
            ? (labels[locale] ?? '主張')
            : label;
          expect(
            displayKindLabel(
              [template],
              'node',
              kindOf(T, 'claim'),
              label,
              locale,
            ),
          ).toBe(expected);
        },
      ),
    );
  });

  test('訳は property にして読み戻すと同じになる (空の訳は持たない)', () => {
    fc.assert(
      fc.property(arbTranslations, (labels) => {
        const read = translationsIn(
          translationProperties(labels, KIND_LABEL_PROPERTY_PREFIX),
          KIND_LABEL_PROPERTY_PREFIX,
        );
        expect(read ?? {}).toEqual(labels);
      }),
    );
  });
});

describe('displayKindLabel (#356): 例', () => {
  const template = templateOf(T, { en: 'Claim' }, { en: 'supports' });

  test('種類を持たない要素・知らない種類の要素は label のまま', () => {
    expect(displayKindLabel([template], 'node', {}, '主張', 'en')).toBe('主張');
    expect(
      displayKindLabel([template], 'node', kindOf(T, 'nope'), '主張', 'en'),
    ).toBe('主張');
  });

  test('edge は edge の種類で引く (同じ id の node の種類と取り違えない)', () => {
    expect(
      displayKindLabel(
        [template],
        'edge',
        kindOf(T, 'supports'),
        '支える',
        'en',
      ),
    ).toBe('supports');
    expect(
      displayKindLabel([template], 'edge', kindOf(T, 'claim'), '主張', 'en'),
    ).toBe('主張');
  });

  test('別の言語の名前で焼き込まれた label も訳す (#330 案 B で英語の参加者が作った種)', () => {
    expect(
      displayKindLabel([template], 'node', kindOf(T, 'claim'), 'Claim', 'ja'),
    ).toBe('主張');
  });

  test('2 つの template の種類を持つときは、先に当たった template で決める', () => {
    const other = templateOf('template.b', { en: 'Assertion' });
    const both = { ...kindOf(T, 'claim'), ...kindOf('template.b', 'claim') };
    expect(
      displayKindLabel([template, other], 'node', both, '主張', 'en'),
    ).toBe('Claim');
    expect(
      displayKindLabel([other, template], 'node', both, '主張', 'en'),
    ).toBe('Assertion');
  });

  test('kindLabelIn・kindDescriptionIn は、訳が無い言語では template graph の名前・説明', () => {
    const [kind] = TemplateSchema.parse({
      id: T,
      name: 'T',
      nodeKinds: [
        {
          id: 'claim',
          label: '主張',
          description: '結論',
          labels: { en: 'Claim' },
          descriptions: { en: 'The conclusion' },
        },
      ],
      edgeKinds: [],
    }).nodeKinds;
    if (!kind) throw new Error('種類が無い');
    expect([kindLabelIn(kind, 'en'), kindDescriptionIn(kind, 'en')]).toEqual([
      'Claim',
      'The conclusion',
    ]);
    expect([kindLabelIn(kind, 'fr'), kindDescriptionIn(kind, 'fr')]).toEqual([
      '主張',
      '結論',
    ]);
  });

  test('読めない訳は落とす: 空の言語・空白だけ・文字列でない値', () => {
    expect(
      translationsIn(
        {
          'label:': 'x',
          'label:en': '  ',
          'label:fr': 3,
          'label:ja': '主張',
          other: 'y',
        },
        KIND_LABEL_PROPERTY_PREFIX,
      ),
    ).toEqual({ ja: '主張' });
    expect(translationsIn({}, KIND_LABEL_PROPERTY_PREFIX)).toBeUndefined();
  });
});

describe('templateFromSheet と訳 (#356)', () => {
  test('訳の property は種類の名前・説明になり、当てた先の既定値には入らない', () => {
    const sheet: Sheet = {
      id: '00000000-0000-4000-8000-0000000000a1' as SheetId,
      name: 'T',
      nodes: [
        {
          id: '00000000-0000-4000-8000-000000000001' as Sheet['nodes'][number]['id'],
          content: '結論',
          label: '主張',
          properties: {
            [kindLabelPropertyOf('en')]: 'Claim',
            [kindDescriptionPropertyOf('en')]: 'The conclusion',
            weight: 1,
          },
        },
      ],
      edges: [],
    };
    const [kind] = templateFromSheet(sheet, templateIdOf(sheet.id)).nodeKinds;
    expect(kind).toMatchObject({
      labels: { en: 'Claim' },
      descriptions: { en: 'The conclusion' },
      defaults: { weight: 1 },
    });
  });
});

describe('kindPropertyLabels (#384): 種別の property を人が読める名前に', () => {
  test('名前は template の名前、値は種類の名前を見る人の言語で', () => {
    const template = templateOf(T, { en: 'Claim' }, { en: 'Supports' });
    expect(
      kindPropertyLabels([template], 'node', kindOf(T, 'claim'), 'en'),
    ).toEqual({
      [kindPropertyOf(T as Template['id'])]: { template: 'T', kind: 'Claim' },
    });
    // 訳が無い言語では template graph の名前
    expect(
      kindPropertyLabels([template], 'node', kindOf(T, 'claim'), 'fr'),
    ).toEqual({
      [kindPropertyOf(T as Template['id'])]: { template: 'T', kind: '主張' },
    });
  });

  test('edge は edge の種類で引く', () => {
    const template = templateOf(T, {}, { ja: '支える' });
    expect(
      kindPropertyLabels([template], 'edge', kindOf(T, 'supports'), 'ja'),
    ).toEqual({
      [kindPropertyOf(T as Template['id'])]: { template: 'T', kind: '支える' },
    });
    // node の種類の id を edge として引いても当たらない
    expect(
      kindPropertyLabels([template], 'edge', kindOf(T, 'claim'), 'ja'),
    ).toEqual({});
  });

  test('知らない template・知らない種類・文字列でない値は含めない (id のまま出す)', () => {
    const template = templateOf(T, {});
    expect(
      kindPropertyLabels(
        [template],
        'node',
        kindOf('template.other', 'claim'),
        'ja',
      ),
    ).toEqual({});
    expect(
      kindPropertyLabels([template], 'node', kindOf(T, 'unknown'), 'ja'),
    ).toEqual({});
    expect(
      kindPropertyLabels(
        [template],
        'node',
        { [kindPropertyOf(T as Template['id'])]: 1 },
        'ja',
      ),
    ).toEqual({});
  });
});
