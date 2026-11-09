import { describe, expect, test } from 'bun:test';
import { CORE_SEEDS } from './registry';
import { TemplateSchema } from './types';

describe('CORE_SEEDS', () => {
  test('core の種は Toulmin model だけ (依頼・相談は依頼の module が出す)', () => {
    expect(CORE_SEEDS.map((s) => String(s.template.id))).toEqual([
      'jp.co.metabolics.toulmin',
    ]);
  });

  test('種は template の参照整合性を満たす (綴り違いは import 時に落ちる)', () => {
    for (const { template } of CORE_SEEDS) {
      expect(TemplateSchema.safeParse(template).success).toBe(true);
    }
  });
});
