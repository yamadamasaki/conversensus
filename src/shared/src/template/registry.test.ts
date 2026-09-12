import { describe, expect, test } from 'bun:test';
import { type TemplateId, TemplateIdSchema } from '../schemas';
import { BUILTIN_TEMPLATES, templatesOf } from './registry';
import { TOULMIN_TEMPLATE } from './toulmin';

const tid = (s: string): TemplateId => TemplateIdSchema.parse(s);

describe('BUILTIN_TEMPLATES', () => {
  test('step2 では toulmin ひとつだけ', () => {
    expect(BUILTIN_TEMPLATES.map((t) => String(t.id))).toEqual([
      'jp.co.metabolics.toulmin',
    ]);
  });
});

describe('templatesOf', () => {
  test('id から実体を引く', () => {
    expect(templatesOf([tid('jp.co.metabolics.toulmin')])).toEqual([
      TOULMIN_TEMPLATE,
    ]);
  });

  test('未指定は空 — template を当てていないシート', () => {
    expect(templatesOf(undefined)).toEqual([]);
    expect(templatesOf([])).toEqual([]);
  });

  test('知らない id は黙って落とす — 相手のシートが開けなくなる方が悪い', () => {
    expect(templatesOf([tid('com.example.unknown')])).toEqual([]);
    expect(
      templatesOf([
        tid('com.example.unknown'),
        tid('jp.co.metabolics.toulmin'),
      ]),
    ).toEqual([TOULMIN_TEMPLATE]);
  });

  test('指定した順に返す (種別メニューの並びが決まる)', () => {
    const other = { ...TOULMIN_TEMPLATE, id: tid('com.example.other') };
    const available = [TOULMIN_TEMPLATE, other];
    expect(
      templatesOf(
        [tid('com.example.other'), tid('jp.co.metabolics.toulmin')],
        available,
      ).map((t) => String(t.id)),
    ).toEqual(['com.example.other', 'jp.co.metabolics.toulmin']);
  });
});
