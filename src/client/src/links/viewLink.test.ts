import { describe, expect, test } from 'bun:test';
import {
  BranchIdSchema,
  EdgeIdSchema,
  FileIdSchema,
  type GraphViewAddress,
  HEAD_CUT,
  NodeIdSchema,
  SheetIdSchema,
} from '@conversensus/shared';
import fc from 'fast-check';
import { parseViewHash, VIEW_HASH_PREFIX, viewHash, viewUrl } from './viewLink';

const FILE = FileIdSchema.parse('00000000-0000-4000-8000-0000000000f1');
const SHEET = SheetIdSchema.parse('00000000-0000-4000-8000-0000000000a1');
const BRANCH = BranchIdSchema.parse('00000000-0000-4000-8000-0000000000b1');
const NODE = NodeIdSchema.parse('00000000-0000-4000-8000-0000000000c1');

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

  test('過去の切断面は actor の順に at で、強調は n と e で query に載せる', () => {
    expect(
      viewHash({
        ...trunk,
        cut: { 'did:plc:bob#d1': 2, 'did:plc:alice#d1': 3 },
        highlight: { nodeIds: [NODE], edgeIds: [] },
      }),
    ).toBe(
      `#/v/${FILE}/${SHEET}?at=did%3Aplc%3Aalice%23d1%403&at=did%3Aplc%3Abob%23d1%402&n=${NODE}`,
    );
  });

  test('空の切断面 (何も含まない時点) は最新と区別して戻る (性質が見つけた反例)', () => {
    const empty = { ...trunk, cut: {} };
    expect(viewHash(empty)).toBe(`#/v/${FILE}/${SHEET}?at=`);
    expect(parseViewHash(viewHash(empty))).toEqual(empty);
  });

  test('強調が空なら何も載せない', () => {
    expect(
      viewHash({ ...trunk, highlight: { nodeIds: [], edgeIds: [] } }),
    ).toBe(`#/v/${FILE}/${SHEET}`);
  });

  test('往復: アドレスがそのまま戻る (空の強調は「強調なし」として)', () => {
    const uuid = fc.uuid({ version: 4 });
    /** actor は DID と端末の id。`:`・`#`・`@` を含みうる */
    const actor = fc.constantFrom(
      'did:plc:alice#d1',
      'did:plc:bob#d2',
      'did:web:example.com#x@y',
      'local',
    );
    const cut = fc.oneof(
      fc.constant(HEAD_CUT),
      fc.dictionary(actor, fc.integer({ min: 1, max: 1_000_000 })),
    );
    fc.assert(
      fc.property(
        uuid,
        uuid,
        fc.option(uuid, { nil: null }),
        cut,
        fc.array(uuid, { maxLength: 3 }),
        fc.array(uuid, { maxLength: 3 }),
        (fileId, sheetId, branchId, cut, nodeIds, edgeIds) => {
          const address = {
            fileId: FileIdSchema.parse(fileId),
            sheetId: SheetIdSchema.parse(sheetId),
            branchId: branchId === null ? null : BranchIdSchema.parse(branchId),
            cut,
            highlight: {
              nodeIds: nodeIds.map((id) => NodeIdSchema.parse(id)),
              edgeIds: edgeIds.map((id) => EdgeIdSchema.parse(id)),
            },
          };
          const { highlight, ...rest } = address;
          expect(parseViewHash(viewHash(address))).toEqual(
            nodeIds.length + edgeIds.length > 0 ? address : rest,
          );
        },
      ),
    );
  });

  test('後の版が足す query は読み飛ばす', () => {
    expect(parseViewHash(`#/v/${FILE}/${SHEET}?later=x`)).toEqual(trunk);
  });

  test.each([
    ['空', ''],
    ['ログインの戻り (OAuth)', '#state=abc&iss=x&code=y'],
    ['頭が違う', `#/x/${FILE}/${SHEET}`],
    ['段が足りない', `#/v/${FILE}`],
    ['段が多すぎる', `#/v/${FILE}/${SHEET}/${BRANCH}/extra`],
    ['id の形が違う', `#/v/not-a-uuid/${SHEET}`],
    ['壊れた %', `#/v/%E0%A4%A/${SHEET}`],
    ['seq の無い at', `#/v/${FILE}/${SHEET}?at=alice`],
    ['seq が数でない at', `#/v/${FILE}/${SHEET}?at=alice@x`],
    ['actor の無い at', `#/v/${FILE}/${SHEET}?at=@3`],
    ['形の違う強調', `#/v/${FILE}/${SHEET}?n=not-a-uuid`],
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
