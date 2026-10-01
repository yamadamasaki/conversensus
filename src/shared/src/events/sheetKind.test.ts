import { describe, expect, test } from 'bun:test';
import { SHEET_KIND_PROPERTY, sheetKindOf } from './sheetKind';

describe('sheetKindOf', () => {
  test('種別プロパティの値を読む', () => {
    expect(
      sheetKindOf({
        properties: { [SHEET_KIND_PROPERTY]: 'com.example.kind' },
      }),
    ).toBe('com.example.kind');
  });

  test('置かれていなければ undefined (= ただの sheet)', () => {
    expect(sheetKindOf({})).toBeUndefined();
    expect(sheetKindOf({ properties: { 'com.example.other': 'x' } })).toBe(
      undefined,
    );
  });

  test('文字列でない・空の値は、例外にせず undefined にする', () => {
    // 相手が新しい種別の書き方をしていても、こちらでは「ただの sheet」として開ける
    expect(
      sheetKindOf({ properties: { [SHEET_KIND_PROPERTY]: { v: 1 } } }),
    ).toBeUndefined();
    expect(sheetKindOf({ properties: { [SHEET_KIND_PROPERTY]: '' } })).toBe(
      undefined,
    );
  });

  test('種別のプロパティ名は名前空間付きである', () => {
    expect(SHEET_KIND_PROPERTY).toBe('app.conversensus.sheetKind');
  });
});
