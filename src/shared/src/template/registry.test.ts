import { describe, expect, test } from 'bun:test';
import { SEED_TEMPLATES } from './registry';
import { TemplateSchema } from './types';

describe('SEED_TEMPLATES', () => {
  test('種は Toulmin model と依頼・相談 (File に複製する元の表)', () => {
    expect(SEED_TEMPLATES.map((t) => String(t.id))).toEqual([
      'jp.co.metabolics.toulmin',
      'jp.co.metabolics.request',
    ]);
  });

  test('種は template の参照整合性を満たす (綴り違いは import 時に落ちる)', () => {
    for (const t of SEED_TEMPLATES) {
      expect(TemplateSchema.safeParse(t).success).toBe(true);
    }
  });
});
