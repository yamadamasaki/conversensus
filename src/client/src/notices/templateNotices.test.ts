import { describe, expect, test } from 'bun:test';
import {
  type AppliedTemplateVersion,
  type FileId,
  type SheetId,
  TEMPLATE_VERSION,
} from '@conversensus/shared';
import fc from 'fast-check';
import { templateNoticeKeyOf } from './noticeKeys';
import { templateNoticesOf } from './templateNotices';

const FILE = '00000000-0000-4000-8000-0000000000f1' as FileId;
const sheet = (n: number) =>
  `00000000-0000-4000-8000-0000000000${10 + n}` as SheetId;
/** 当てた先と template graph の小さなプール (同じ組を引くため) */
const SHEETS = [0, 1, 2].map(sheet);
const TIPS = ['0000000a', '0000000b'];

const arbVersion: fc.Arbitrary<AppliedTemplateVersion> = fc.oneof(
  fc.record({
    sheet: fc.constantFrom(...SHEETS),
    template: fc.constantFrom(...SHEETS),
    version: fc.constantFrom(TEMPLATE_VERSION.CURRENT, TEMPLATE_VERSION.NEWER),
    tip: fc.constantFrom(...TIPS),
  }),
  fc.record({
    sheet: fc.constantFrom(...SHEETS),
    template: fc.constantFrom(...SHEETS),
    version: fc.constant(TEMPLATE_VERSION.DELETED),
  }),
);
const sameEvent = (a: AppliedTemplateVersion, b: AppliedTemplateVersion) =>
  a.sheet === b.sheet && a.template === b.template && a.tip === b.tip;

describe('templateNoticeKeyOf (template-update D3)', () => {
  test('性質: 同じ鍵 ⇔ 当てた先・template graph・先端の版 (削除なら削除) が同じ', () => {
    fc.assert(
      fc.property(arbVersion, arbVersion, (a, b) => {
        expect(templateNoticeKeyOf(a) === templateNoticeKeyOf(b)).toBe(
          sameEvent(a, b),
        );
      }),
    );
  });
});

describe('templateNoticesOf (template-update D3)', () => {
  const newer: AppliedTemplateVersion = {
    sheet: sheet(0),
    template: sheet(1),
    version: TEMPLATE_VERSION.NEWER,
    tip: '0000000a',
    name: 'T',
  };
  const deleted: AppliedTemplateVersion = {
    sheet: sheet(2),
    template: sheet(1),
    version: TEMPLATE_VERSION.DELETED,
  };
  const current: AppliedTemplateVersion = {
    ...newer,
    sheet: sheet(2),
    version: TEMPLATE_VERSION.CURRENT,
  };

  test('新しい版と削除を、版の並びのまま出す。最新のものは出さない', () => {
    expect(
      templateNoticesOf(FILE, [newer, current, deleted], new Set()),
    ).toEqual([
      {
        key: templateNoticeKeyOf(newer),
        fileId: FILE,
        sheet: sheet(0),
        template: sheet(1),
        version: TEMPLATE_VERSION.NEWER,
        templateName: 'T',
      },
      {
        key: templateNoticeKeyOf(deleted),
        fileId: FILE,
        sheet: sheet(2),
        template: sheet(1),
        version: TEMPLATE_VERSION.DELETED,
      },
    ]);
  });

  test('既読のものは出さない。先端が変われば、閉じたものも出る', () => {
    const dismissed = new Set([templateNoticeKeyOf(newer)]);
    expect(templateNoticesOf(FILE, [newer], dismissed)).toEqual([]);
    const moved = { ...newer, tip: '0000000b' };
    expect(
      templateNoticesOf(FILE, [moved], dismissed).map((n) => n.key),
    ).toEqual([templateNoticeKeyOf(moved)]);
  });
});
