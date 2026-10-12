import { describe, expect, test } from 'bun:test';
import { ja } from './ja';
import { LOCALES } from './locale';
import { CATALOGS } from './messages';

/** 辞書の形: キーの道筋と、値が文字列か関数 (引数の数) か */
function shapeOf(value: unknown, path = ''): string[] {
  if (typeof value === 'string') return [`${path}:string`];
  if (typeof value === 'function') return [`${path}:fn/${value.length}`];
  return Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .flatMap(([k, v]) => shapeOf(v, path ? `${path}.${k}` : k));
}

describe('辞書 (#50 i18n)', () => {
  test.each(LOCALES.map((l) => [l]))(
    '%s の辞書は正の辞書 (ja) と同じ形 (キー・文字列か関数か・引数の数)',
    (locale) => {
      expect(shapeOf(CATALOGS[locale])).toEqual(shapeOf(ja));
    },
  );

  test('空の文言は無い (訳し忘れを空文字で埋めていない)', () => {
    for (const locale of LOCALES) {
      const walk = (v: unknown): string[] =>
        typeof v === 'string'
          ? [v]
          : typeof v === 'function'
            ? []
            : Object.values(v as object).flatMap(walk);
      expect(walk(CATALOGS[locale]).filter((s) => s.trim() === '')).toEqual([]);
    }
  });
});
