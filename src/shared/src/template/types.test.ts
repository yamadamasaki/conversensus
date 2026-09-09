import { describe, expect, test } from 'bun:test';
import { TemplateSchema } from './types';

const ok = {
  id: 't',
  name: 'T',
  nodeKinds: [
    { id: 'a', label: 'あ' },
    { id: 'b', label: 'い' },
  ],
  edgeKinds: [{ id: 'e', label: '繋ぐ', from: ['a'], to: ['b'] }],
};

/** 落ちた検査の場所 (path) を見る。どこが悪いか言えないと直せない */
const issuePaths = (v: unknown): string[] => {
  const r = TemplateSchema.safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
};

describe('TemplateSchema', () => {
  test('正しい template を受理し、properties は空配列で埋める', () => {
    const t = TemplateSchema.parse(ok);
    expect(t.edgeKinds[0]?.properties).toEqual([]);
  });

  test('from が未定義の node 種別を指していたら落とす', () => {
    expect(
      issuePaths({
        ...ok,
        edgeKinds: [{ id: 'e', label: '繋ぐ', from: ['typo'], to: ['b'] }],
      }),
    ).toEqual(['edgeKinds.0.from.0']);
  });

  test('to 側も同じく見る', () => {
    expect(
      issuePaths({
        ...ok,
        edgeKinds: [{ id: 'e', label: '繋ぐ', from: ['a'], to: ['typo'] }],
      }),
    ).toEqual(['edgeKinds.0.to.0']);
  });

  test('node 種別の id の重複を落とす', () => {
    expect(
      issuePaths({
        ...ok,
        nodeKinds: [
          { id: 'a', label: 'あ' },
          { id: 'a', label: '別のあ' },
          { id: 'b', label: 'い' },
        ],
      }),
    ).toEqual(['nodeKinds']);
  });

  test('edge 種別の id の重複を落とす', () => {
    expect(
      issuePaths({
        ...ok,
        edgeKinds: [
          { id: 'e', label: '繋ぐ', from: ['a'], to: ['b'] },
          { id: 'e', label: '別', from: ['a'], to: ['b'] },
        ],
      }),
    ).toEqual(['edgeKinds']);
  });

  test('label は空にできない — 空の種別名は選べないし照合もできない', () => {
    expect(
      issuePaths({
        ...ok,
        nodeKinds: [
          { id: 'a', label: '' },
          { id: 'b', label: 'い' },
        ],
      }),
    ).toContain('nodeKinds.0.label');
  });

  test('from / to は空にできない — 端点の無い接続規則は意味を持たない', () => {
    expect(
      issuePaths({
        ...ok,
        edgeKinds: [{ id: 'e', label: '繋ぐ', from: [], to: ['b'] }],
      }),
    ).toEqual(['edgeKinds.0.from']);
  });

  test('種別を持たない template は受理する (空の語彙は誤りではない)', () => {
    expect(
      TemplateSchema.safeParse({
        id: 't',
        name: 'T',
        nodeKinds: [],
        edgeKinds: [],
      }).success,
    ).toBe(true);
  });
});
