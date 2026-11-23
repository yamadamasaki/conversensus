import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import type { TemplateId } from '../schemas';
import {
  copiedDefaultsOf,
  effectiveProperties,
  effectiveTemplateProperties,
} from './effective';
import { kindPropertyOf } from './kind';
import { checkPropertyValue, parsePropertyType } from './propertyType';
import { type Template, TemplateSchema } from './types';

const T = 'template.t' as TemplateId;
const P = (name: string) => `${T}.${name}`;
const KIND = kindPropertyOf(T);

/** 1 つの node の種類 (`claim`) を持つ template */
function templateWith(
  defaults: Record<string, unknown>,
  schema: Record<string, { type?: string; editable: boolean }>,
): Template {
  return TemplateSchema.parse({
    id: T,
    name: 'T',
    nodeKinds: [{ id: 'claim', label: '主張', defaults, schema }],
    edgeKinds: [],
  });
}

/** 値・型のプール。型に合うものと合わないものに当たる */
const arbValue = fc.constantFrom<unknown>(undefined, '高', '', 3, 'x');
const arbType = fc.constantFrom(
  undefined,
  'number',
  "'高' | '低'",
  'string?',
  'broken(',
);

describe('effectiveTemplateProperties: 性質', () => {
  test('editable: false なら既定値、そうでなければ要素の値、無ければ既定値。型が読めれば判定を添える', () => {
    fc.assert(
      fc.property(
        arbValue,
        arbValue,
        arbType,
        fc.boolean(),
        (own, fallback, type, editable) => {
          const t = templateWith(
            fallback === undefined ? {} : { [P('x')]: fallback },
            { [P('x')]: { ...(type && { type }), editable } },
          );
          const properties = {
            [KIND]: 'claim',
            ...(own !== undefined && { [P('x')]: own }),
          };
          const entry = effectiveTemplateProperties([t], 'node', properties)[
            P('x')
          ];
          const expected = !editable
            ? fallback
            : own !== undefined
              ? own
              : fallback;
          expect(entry?.value).toBe(expected);
          expect(entry?.source).toBe(
            !editable ? 'fixed' : own !== undefined ? 'own' : 'default',
          );
          const parsed = type ? parsePropertyType(type) : undefined;
          expect(entry?.check).toBe(
            parsed?.ok ? checkPropertyValue(parsed.decl, expected) : undefined,
          );
        },
      ),
    );
  });
});

describe('effective: 例', () => {
  const t = templateWith(
    {
      [P('owner')]: 'alice',
      'app.conversensus.request.addressee': [],
    },
    { [P('due')]: { type: 'date', editable: true } },
  );

  test('作成時に写すのは template の名前空間の外の既定値だけ', () => {
    expect(copiedDefaultsOf(T, t.nodeKinds[0] as never)).toEqual({
      'app.conversensus.request.addressee': [],
    });
  });

  test('補うのは template の名前空間の property だけ。既定値の無い宣言も姿を持つ (必須なら欠けている)', () => {
    const entries = effectiveTemplateProperties([t], 'node', {
      [KIND]: 'claim',
    });
    expect(Object.keys(entries).sort()).toEqual([P('due'), P('owner')].sort());
    expect(entries[P('owner')]).toEqual({ value: 'alice', source: 'default' });
    expect(entries[P('due')]).toEqual({
      value: undefined,
      source: 'default',
      check: 'missing',
      type: 'date',
    });
  });

  test('種類を持たない要素・知らない種類・edge と node の取り違えは空', () => {
    expect(effectiveTemplateProperties([t], 'node', { x: 1 })).toEqual({});
    expect(
      effectiveTemplateProperties([t], 'node', { [KIND]: 'unknown' }),
    ).toEqual({});
    expect(
      effectiveTemplateProperties([t], 'edge', { [KIND]: 'claim' }),
    ).toEqual({});
  });

  test('読むときの全体: 補い、固定し、値の無い宣言は含めない。他の property はそのまま', () => {
    const fixed = templateWith(
      { [P('owner')]: 'alice' },
      { [P('owner')]: { editable: false }, [P('due')]: { editable: true } },
    );
    expect(
      effectiveProperties([fixed], 'node', {
        [KIND]: 'claim',
        [P('owner')]: 'bob',
        memo: 'm',
      }),
    ).toEqual({ [KIND]: 'claim', [P('owner')]: 'alice', memo: 'm' });
  });
});
