import { describe, expect, test } from 'bun:test';
import { displayableImageType } from './blob';

describe('displayableImageType (security review M3)', () => {
  test('ラスタ形式はそのまま表示する', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(displayableImageType(type)).toBe(type);
    }
    expect(displayableImageType('IMAGE/PNG')).toBe('image/png');
  });

  test('script を持てる形式やそれ以外は、中身を解釈させない型にする', () => {
    for (const type of [
      'text/html',
      'image/svg+xml',
      'application/xhtml+xml',
      '',
    ]) {
      expect(displayableImageType(type)).toBe('application/octet-stream');
    }
  });
});
