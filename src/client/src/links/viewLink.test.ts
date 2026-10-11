import { describe, expect, test } from 'bun:test';
import {
  BranchIdSchema,
  FileIdSchema,
  type GraphViewAddress,
  HEAD_CUT,
  SheetIdSchema,
} from '@conversensus/shared';
import fc from 'fast-check';
import { parseViewHash, VIEW_HASH_PREFIX, viewHash, viewUrl } from './viewLink';

const FILE = FileIdSchema.parse('00000000-0000-4000-8000-0000000000f1');
const SHEET = SheetIdSchema.parse('00000000-0000-4000-8000-0000000000a1');
const BRANCH = BranchIdSchema.parse('00000000-0000-4000-8000-0000000000b1');

const trunk: GraphViewAddress = {
  fileId: FILE,
  sheetId: SHEET,
  branchId: null,
  cut: HEAD_CUT,
};

describe('viewHash / parseViewHash', () => {
  test('trunk は File と Sheet の 2 段、branch は 3 段', () => {
    expect(viewHash(trunk)).toBe(`#/v/${FILE}/${SHEET}`);
    expect(viewHash({ ...trunk, branchId: BRANCH })).toBe(
      `#/v/${FILE}/${SHEET}/${BRANCH}`,
    );
  });

  test('切断面と highlight は載せない', () => {
    expect(
      viewHash({
        ...trunk,
        cut: { 'did:plc:alice#d1': 3 },
        highlight: { nodeIds: [], edgeIds: [] },
      }),
    ).toBe(`#/v/${FILE}/${SHEET}`);
  });

  test('往復: 載せる項目 (file・sheet・branch) は戻り、切断面は head になる', () => {
    const uuid = fc.uuid({ version: 4 });
    fc.assert(
      fc.property(
        uuid,
        uuid,
        fc.option(uuid, { nil: null }),
        (fileId, sheetId, branchId) => {
          const address = {
            fileId: FileIdSchema.parse(fileId),
            sheetId: SheetIdSchema.parse(sheetId),
            branchId: branchId === null ? null : BranchIdSchema.parse(branchId),
            cut: { 'did:plc:alice#d1': 1 },
          };
          expect(parseViewHash(viewHash(address))).toEqual({
            ...address,
            cut: HEAD_CUT,
          });
        },
      ),
    );
  });

  test('後の版が足す query は読み飛ばす', () => {
    expect(parseViewHash(`#/v/${FILE}/${SHEET}?cut=x&n=y`)).toEqual(trunk);
  });

  test.each([
    ['空', ''],
    ['ログインの戻り (OAuth)', '#state=abc&iss=x&code=y'],
    ['頭が違う', `#/x/${FILE}/${SHEET}`],
    ['段が足りない', `#/v/${FILE}`],
    ['段が多すぎる', `#/v/${FILE}/${SHEET}/${BRANCH}/extra`],
    ['id の形が違う', `#/v/not-a-uuid/${SHEET}`],
    ['壊れた %', `#/v/%E0%A4%A/${SHEET}`],
  ])('view のリンクでなければ null: %s', (_, hash) => {
    expect(parseViewHash(hash)).toBeNull();
  });

  test('どんな文字列でも投げない', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        parseViewHash(s);
        parseViewHash(VIEW_HASH_PREFIX + s);
      }),
    );
  });
});

describe('viewUrl', () => {
  test('元の URL の path と query は残し、fragment だけを替える', () => {
    expect(viewUrl(trunk, 'https://conversensus.site/?x=1#/v/old/old')).toBe(
      `https://conversensus.site/?x=1#/v/${FILE}/${SHEET}`,
    );
  });
});
