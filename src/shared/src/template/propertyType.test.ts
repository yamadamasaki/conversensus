import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  BASE_PROPERTY_TYPES,
  checkPropertyValue,
  formatPropertyType,
  matchesPropertyType,
  type PropertyTypeDecl,
  type PropertyTypeExpr,
  parsePropertyType,
  valueFromInput,
} from './propertyType';

/**
 * リテラルのプール。空文字・空白・日本語・`|` や括弧や `[]` を含むもの・単引用符を含むもの
 * (二重引用符で書かれる) に当たる。両方の引用符を含むものは文法で書けないので引かない
 */
const LITERALS = ['高', '中', '低', '', 'a b', 'x|y', '(z)', '[]', "it's"];

const arbLiterals = fc.uniqueArray(fc.constantFrom(...LITERALS), {
  minLength: 1,
  maxLength: 3,
});

/** 型の構文木。配列は 2 段まで (それより深くても規則は同じ) */
const arbExpr: fc.Arbitrary<PropertyTypeExpr> = fc.letrec<{
  expr: PropertyTypeExpr;
}>((tie) => ({
  expr: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc
      .constantFrom(...BASE_PROPERTY_TYPES)
      .map((name): PropertyTypeExpr => ({ kind: 'base', name })),
    arbLiterals.map(
      (values): PropertyTypeExpr => ({ kind: 'literals', values }),
    ),
    tie('expr').map(
      (element): PropertyTypeExpr => ({ kind: 'array', element }),
    ),
  ),
})).expr;

const arbDecl: fc.Arbitrary<PropertyTypeDecl> = fc.record({
  type: arbExpr,
  optional: fc.boolean(),
});

/** 値のプール。どの基本の型にも、合うものと合わないものが入るようにする */
const arbScalar = fc.constantFrom<unknown>(
  '高',
  '',
  'x|y',
  3,
  0,
  Number.NaN,
  true,
  false,
  null,
  '2026-11-23',
  '2026-02-30',
  '2026-11-23T10:00',
  '2026-11-23T10:00:00.5+09:00',
  '2026-11-23T24:00',
  { a: 1 },
);
const arbValue: fc.Arbitrary<unknown> = fc.oneof(
  arbScalar,
  fc.array(arbScalar, { maxLength: 3 }),
  fc.array(fc.array(arbScalar, { maxLength: 2 }), { maxLength: 2 }),
);

describe('parsePropertyType / formatPropertyType: 性質', () => {
  test('書いて読むと同じ宣言に戻る', () => {
    fc.assert(
      fc.property(arbDecl, (decl) => {
        expect(parsePropertyType(formatPropertyType(decl))).toEqual({
          ok: true,
          decl,
        });
      }),
    );
  });
});

describe('checkPropertyValue: 性質', () => {
  test('値が無ければ、optional なら合格、そうでなければ欠けている', () => {
    fc.assert(
      fc.property(arbDecl, (decl) => {
        expect(checkPropertyValue(decl, undefined)).toBe(
          decl.optional ? 'ok' : 'missing',
        );
      }),
    );
  });

  test('配列の型に合うのは、配列で、要素がすべて要素の型に合うときちょうど', () => {
    fc.assert(
      fc.property(arbExpr, arbValue, (element, value) => {
        expect(matchesPropertyType({ kind: 'array', element }, value)).toBe(
          Array.isArray(value) &&
            value.every((v) => matchesPropertyType(element, v)),
        );
      }),
    );
  });

  test('列挙に合うのは、列挙のどれかと等しい文字列ちょうど', () => {
    fc.assert(
      fc.property(arbLiterals, arbValue, (values, value) => {
        expect(matchesPropertyType({ kind: 'literals', values }, value)).toBe(
          typeof value === 'string' && values.includes(value),
        );
      }),
    );
  });
});

describe('parsePropertyType: 例', () => {
  const parsed = (text: string) => {
    const r = parsePropertyType(text);
    return r.ok ? r.decl : undefined;
  };

  test('基本の型・配列・列挙・optional', () => {
    expect(parsed('number')).toEqual({
      type: { kind: 'base', name: 'number' },
      optional: false,
    });
    expect(parsed('string[]?')).toEqual({
      type: { kind: 'array', element: { kind: 'base', name: 'string' } },
      optional: true,
    });
    expect(parsed("'高' | '中' | \"低\"")).toEqual({
      type: { kind: 'literals', values: ['高', '中', '低'] },
      optional: false,
    });
    expect(parsed("('高' | '中')[]")?.type).toEqual({
      kind: 'array',
      element: { kind: 'literals', values: ['高', '中'] },
    });
  });

  test('空白は語の間のどこにでも置ける', () => {
    expect(parsed("  ( '高'|'中' ) [ ] ?  ")).toEqual(
      parsed("('高' | '中')[]?"),
    );
  });

  test('誤りは位置と理由を返す (例外は投げない)', () => {
    expect(parsePropertyType('strin')).toMatchObject({ ok: false, at: 0 });
    expect(parsePropertyType('')).toMatchObject({ ok: false });
    expect(parsePropertyType("'高' |")).toMatchObject({ ok: false });
    expect(parsePropertyType("'高")).toMatchObject({ ok: false, at: 0 });
    expect(parsePropertyType('number number')).toMatchObject({
      ok: false,
      at: 7,
    });
    // 型のユニオンは書けない (K10)
    expect(parsePropertyType('string | number')).toMatchObject({ ok: false });
  });

  test('括弧の無い列挙の後ろに [] は付けられない (どこに掛かるか読めない)', () => {
    expect(parsePropertyType("'高' | '中'[]")).toMatchObject({ ok: false });
  });
});

describe('checkPropertyValue: 例', () => {
  const decl = (text: string) => {
    const r = parsePropertyType(text);
    if (!r.ok) throw new Error(r.error);
    return r.decl;
  };

  test('数は有限の number だけ (数字の文字列は合わない — 値から型を推論しない)', () => {
    expect(checkPropertyValue(decl('number'), 3)).toBe('ok');
    expect(checkPropertyValue(decl('number'), '3')).toBe('mismatch');
    expect(checkPropertyValue(decl('number'), Number.NaN)).toBe('mismatch');
  });

  test('日付は存在する日だけ', () => {
    expect(checkPropertyValue(decl('date'), '2026-11-23')).toBe('ok');
    expect(checkPropertyValue(decl('date'), '2026-02-30')).toBe('mismatch');
    expect(checkPropertyValue(decl('date'), '2026-11-23T10:00')).toBe(
      'mismatch',
    );
  });

  test('日時は ISO 8601 (秒・小数・時差は省略できる)', () => {
    for (const v of [
      '2026-11-23T10:00',
      '2026-11-23T10:00:30Z',
      '2026-11-23T10:00:30.25+09:00',
    ]) {
      expect(checkPropertyValue(decl('datetime'), v)).toBe('ok');
    }
    for (const v of ['2026-11-23', '2026-11-23T24:00', '2026-02-30T10:00']) {
      expect(checkPropertyValue(decl('datetime'), v)).toBe('mismatch');
    }
  });

  test('値が無いとき: 必須なら欠けている、optional なら合格', () => {
    expect(checkPropertyValue(decl("'高' | '低'"), undefined)).toBe('missing');
    expect(checkPropertyValue(decl("'高' | '低'?"), undefined)).toBe('ok');
  });
});

describe('valueFromInput (T7)', () => {
  test('性質: number の宣言では、有限の数を書いた文字列は元の数に戻る', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (n) => {
        expect(
          valueFromInput({ kind: 'base', name: 'number' }, String(n)),
        ).toBe(n === 0 ? 0 : n);
      }),
    );
  });

  test('性質: number・boolean 以外の宣言と、宣言の無いときは文字列のまま', () => {
    fc.assert(
      fc.property(arbExpr, fc.string(), (type, text) => {
        if (
          type.kind === 'base' &&
          (type.name === 'number' || type.name === 'boolean')
        )
          return;
        expect(valueFromInput(type, text)).toBe(text);
        expect(valueFromInput(undefined, text)).toBe(text);
      }),
    );
  });

  test('例: 読めない文字列は文字列のまま (型に合わない印が付く)、真偽は true/false だけ', () => {
    const num = { kind: 'base', name: 'number' } as const;
    const bool = { kind: 'base', name: 'boolean' } as const;
    expect(valueFromInput(num, ' 3 ')).toBe(3);
    expect(valueFromInput(num, '')).toBe('');
    expect(valueFromInput(num, 'three')).toBe('three');
    expect(valueFromInput(bool, 'true')).toBe(true);
    expect(valueFromInput(bool, 'false')).toBe(false);
    expect(valueFromInput(bool, 'yes')).toBe('yes');
  });
});
