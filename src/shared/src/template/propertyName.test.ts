import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import type { TemplateId } from '../schemas';
import {
  appliedPropertyNameOf,
  isReservedTemplatePropertyName,
  templatePropertyLabels,
  writtenPropertyNameOf,
} from './propertyName';

const T = 'template.00000000-0000-4000-8000-0000000000a1' as TemplateId;
const OTHER = 'template.00000000-0000-4000-8000-0000000000a2' as TemplateId;

/** 名前のプール: prefix の無い名前・日本語・名前空間を持つ名前・system・使えない名前 (kind) */
const arbName = fc.constantFrom(
  '期限',
  'weight',
  'a b',
  'jp.co.example.score',
  'app.conversensus.image',
  'kind',
);

describe('propertyName: 性質', () => {
  test('template graph に書く名前 → 適用先の名前 → 書く名前 で元に戻る', () => {
    fc.assert(
      fc.property(arbName, (name) => {
        expect(writtenPropertyNameOf(T, appliedPropertyNameOf(T, name))).toBe(
          name,
        );
      }),
    );
  });

  test('名前空間を持つ名前はそのまま、持たない名前は template の名前空間に入る', () => {
    fc.assert(
      fc.property(arbName, (name) => {
        expect(appliedPropertyNameOf(T, name)).toBe(
          name.includes('.') ? name : `${T}.${name}`,
        );
      }),
    );
  });

  test('別の template の名前空間の名前は、書く名前に戻さない', () => {
    fc.assert(
      fc.property(arbName, (name) => {
        const applied = appliedPropertyNameOf(OTHER, name);
        expect(writtenPropertyNameOf(T, applied)).toBe(applied);
      }),
    );
  });
});

describe('propertyName: 例', () => {
  test('kind は使えない (種別 property と同じ名前になる)', () => {
    expect(isReservedTemplatePropertyName('kind')).toBe(true);
    expect(appliedPropertyNameOf(T, 'kind')).toBe(`${T}.kind`);
    expect(isReservedTemplatePropertyName('期限')).toBe(false);
  });

  test('人が読める形: template の名前と書いた名前。種別 property・知らない template・custom は含めない', () => {
    expect(
      templatePropertyLabels([{ id: T, name: 'Toulmin' }], {
        [`${T}.期限`]: '2026-12-01',
        [`${T}.kind`]: 'x',
        [`${OTHER}.期限`]: '',
        期限: '',
      }),
    ).toEqual({ [`${T}.期限`]: { template: 'Toulmin', name: '期限' } });
  });
});
