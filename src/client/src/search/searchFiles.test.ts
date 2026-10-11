import { describe, expect, test } from 'bun:test';
import {
  type FileId,
  type GraphFile,
  type GraphNode,
  NodeIdSchema,
  type SheetId,
} from '@conversensus/shared';
import fc from 'fast-check';
import { searchFiles } from './searchFiles';
import { searchSheet } from './searchSheet';

const node = (content: string): GraphNode => ({
  id: NodeIdSchema.parse(crypto.randomUUID()),
  content,
});

function file(
  n: number,
  sheets: { name: string; contents: string[] }[],
): GraphFile {
  return {
    id: `file-${n}` as FileId,
    name: `File ${n}`,
    sheets: sheets.map((s, i) => ({
      id: `sheet-${n}-${i}` as SheetId,
      name: s.name,
      nodes: s.contents.map(node),
      edges: [],
    })),
  };
}

describe('searchFiles (#248)', () => {
  test('当たった要素に、それがある File と Sheet の id と名前を付ける', () => {
    const files = [
      file(1, [{ name: '議論', contents: ['合意した', '保留'] }]),
      file(2, [{ name: 'メモ', contents: ['合意は無い'] }]),
    ];
    const { hits, truncated } = searchFiles(files, '合意');
    expect(truncated).toBe(false);
    expect(hits.map((h) => [h.fileName, h.sheetName, h.snippet])).toEqual([
      ['File 1', '議論', '合意した'],
      ['File 2', 'メモ', '合意は無い'],
    ]);
    expect(hits[0]?.fileId).toBe('file-1' as FileId);
    expect(hits[0]?.sheetId).toBe('sheet-1-0' as SheetId);
  });

  test('上限を超えたら打ち切り、打ち切ったと言う', () => {
    const files = [file(1, [{ name: 'S', contents: ['a', 'a', 'a'] }])];
    const result = searchFiles(files, 'a', {}, 2);
    expect(result.hits).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  test('ちょうど上限なら打ち切りではない', () => {
    const files = [file(1, [{ name: 'S', contents: ['a', 'a'] }])];
    expect(searchFiles(files, 'a', {}, 2).truncated).toBe(false);
  });

  test('大文字・小文字の区別は Sheet 内検索と同じ口で渡る', () => {
    const files = [file(1, [{ name: 'S', contents: ['Toulmin'] }])];
    expect(searchFiles(files, 'toulmin').hits).toHaveLength(1);
    expect(
      searchFiles(files, 'toulmin', { caseSensitive: true }).hits,
    ).toHaveLength(0);
  });

  // 小さなプールから引く。広いと当たりがほとんど起きない
  const TEXT = fc.string({
    unit: fc.constantFrom('a', 'b', 'A'),
    maxLength: 3,
  });

  test('∀ File の並びと検索語. 当たりは各 Sheet の Sheet 内検索を順に並べたものと同じ', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.array(fc.array(TEXT, { maxLength: 3 }), {
            minLength: 1,
            maxLength: 2,
          }),
          { maxLength: 3 },
        ),
        fc.constantFrom('a', 'b', 'A', 'ab'),
        fc.boolean(),
        (spec, query, caseSensitive) => {
          const files = spec.map((sheets, n) =>
            file(
              n,
              sheets.map((contents, i) => ({ name: `S${i}`, contents })),
            ),
          );
          const expected = files.flatMap((f) =>
            f.sheets.flatMap((s) => searchSheet(s, query, { caseSensitive })),
          );
          const { hits } = searchFiles(files, query, { caseSensitive });
          expect(
            hits.map(({ fileId, fileName, sheetId, sheetName, ...hit }) => hit),
          ).toEqual(expected);
        },
      ),
    );
  });
});
