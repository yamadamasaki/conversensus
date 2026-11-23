import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  isPropertySchemaProperty,
  type PropertySchema,
  propertySchemaIn,
  propertySchemaProperties,
  propertySchemaPropertyOf,
  propertySchemaValueOf,
} from './propertySchema';

/** 宣言の生成器。名前・型は小さなプールから引き、「何も宣言しない」形 (型なし・editable) にも当たる */
const arbSchema: fc.Arbitrary<PropertySchema> = fc.dictionary(
  fc.constantFrom('weight', '期限', 'a.b'),
  fc.record(
    {
      type: fc.constantFrom('number', ' date? ', '', 'not a type'),
      editable: fc.boolean(),
    },
    { requiredKeys: ['editable'] },
  ),
  { maxKeys: 3 },
);

/** 置く値の形にそろえたもの (`propertySchemaValueOf` が落とす宣言を除き、型の前後の空白を除く) */
function normalized(schema: PropertySchema): PropertySchema {
  const out: PropertySchema = {};
  for (const [name, entry] of Object.entries(schema)) {
    const value = propertySchemaValueOf(entry);
    if (value) out[name] = value;
  }
  return out;
}

describe('propertySchema: 性質', () => {
  test('property にして読み直すと、置く値の形にそろえた宣言に戻る', () => {
    fc.assert(
      fc.property(arbSchema, (schema) => {
        expect(propertySchemaIn(propertySchemaProperties(schema))).toEqual(
          normalized(schema),
        );
      }),
    );
  });
});

describe('propertySchema: 例', () => {
  test('宣言の property の名前', () => {
    expect(propertySchemaPropertyOf('期限')).toBe(
      'app.conversensus.propertySchema.期限',
    );
    expect(
      isPropertySchemaProperty('app.conversensus.propertySchema.期限'),
    ).toBe(true);
    expect(isPropertySchemaProperty('app.conversensus.propertySchema.')).toBe(
      false,
    );
    expect(isPropertySchemaProperty('期限')).toBe(false);
  });

  test('読めない値は黙って落とし、宣言でない property は見ない', () => {
    expect(
      propertySchemaIn({
        'app.conversensus.propertySchema.a': { editable: 'no' },
        'app.conversensus.propertySchema.b': 'number',
        'app.conversensus.propertySchema.c': { type: 'number' },
        c: { type: 'string' },
      }),
    ).toEqual({ c: { type: 'number', editable: true } });
  });

  test('何も宣言しない形 (型が無く editable) は置かない — 消してよい', () => {
    expect(propertySchemaValueOf({ editable: true })).toBeUndefined();
    expect(
      propertySchemaValueOf({ type: '  ', editable: true }),
    ).toBeUndefined();
    expect(propertySchemaValueOf({ editable: false })).toEqual({
      editable: false,
    });
  });

  test('読めない型の文字列も捨てずに持つ (template graph の画面で誤りを見せるため)', () => {
    expect(
      propertySchemaIn({
        'app.conversensus.propertySchema.x': { type: 'not a type' },
      }),
    ).toEqual({ x: { type: 'not a type', editable: true } });
  });
});
