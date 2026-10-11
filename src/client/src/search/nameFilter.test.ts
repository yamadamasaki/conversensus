import { describe, expect, test } from 'bun:test';
import type {
  FileId,
  FolderId,
  GraphFileListItem,
  SheetId,
} from '@conversensus/shared';
import fc from 'fast-check';
import type { FolderNode, FolderTree } from '../folders/folderTree';
import { filterByName, findNameMatch } from './nameFilter';

const fileId = (n: number) =>
  `${String(n).repeat(8)}-1111-4111-8111-111111111111` as FileId;
const folderId = (n: number) =>
  `${String(n).repeat(8)}-0000-4000-8000-000000000000` as FolderId;
const sheetId = (n: number, s: number) => `sheet-${n}-${s}` as SheetId;

function item(
  n: number,
  name: string,
  sheets: string[] = [],
): GraphFileListItem {
  return {
    id: fileId(n),
    name,
    sheets: sheets.map((s, i) => ({ id: sheetId(n, i), name: s })),
  };
}

function folderNode(
  n: number,
  name: string,
  files: number[] = [],
  folders: FolderNode[] = [],
): FolderNode {
  return {
    folder: { id: folderId(n), name, createdAt: '2026-10-01T00:00:00.000Z' },
    name,
    folders,
    files: files.map(fileId),
  };
}

const tree = (folders: FolderNode[], files: number[]): FolderTree => ({
  folders,
  files: files.map(fileId),
  renames: [],
});

/** 絞ったツリーに残った File の id (Folder の中も含む) */
function keptFiles(t: FolderTree): FileId[] {
  const walk = (n: FolderNode): FileId[] => [
    ...n.files,
    ...n.folders.flatMap(walk),
  ];
  return [...t.files, ...t.folders.flatMap(walk)];
}

describe('findNameMatch', () => {
  test('大文字・小文字を区別せず、前後の空白を無視して当たりの範囲を返す', () => {
    expect(findNameMatch('Toulmin の議論', ' toul ')).toEqual({
      start: 0,
      length: 4,
    });
    expect(findNameMatch('議論の Sheet', 'sheet')).toEqual({
      start: 4,
      length: 5,
    });
  });

  test('当たらない・空の検索語なら null', () => {
    expect(findNameMatch('議論', '合意')).toBeNull();
    expect(findNameMatch('議論', '  ')).toBeNull();
  });
});

describe('filterByName (#249)', () => {
  const files = [
    item(1, '議事録', ['Sheet 1']),
    item(2, '設計', ['論点', 'Toulmin']),
    item(3, '雑記', ['Sheet 1']),
    item(4, '旅行', ['行程']),
  ];
  const base = tree(
    [folderNode(1, '仕事', [1, 2], [folderNode(2, '古い', [3])])],
    [4],
  );

  test('空の検索語なら絞らない (null)', () => {
    expect(filterByName(base, files, '')).toBeNull();
    expect(filterByName(base, files, '   ')).toBeNull();
  });

  test('File の名前が当たれば、その File と、それを含む Folder を残す', () => {
    const result = filterByName(base, files, '議事');
    expect(result?.tree.files).toEqual([]);
    expect(result?.tree.folders).toHaveLength(1);
    expect(result?.tree.folders[0]?.files).toEqual([fileId(1)]);
    // 当たりを含まない下位の Folder は消える
    expect(result?.tree.folders[0]?.folders).toEqual([]);
  });

  test('Sheet の名前が当たれば、開いていない File でも残し、当たった Sheet を挙げる', () => {
    const result = filterByName(base, files, 'toulmin');
    expect(keptFiles(result?.tree as FolderTree)).toEqual([fileId(2)]);
    expect(result?.matchedSheets.get(fileId(2))).toEqual([
      { id: sheetId(2, 1), name: 'Toulmin' },
    ]);
  });

  test('Folder の名前が当たれば、中身ごと残す', () => {
    const result = filterByName(base, files, '古い');
    const top = result?.tree.folders[0];
    expect(top?.files).toEqual([]);
    expect(top?.folders[0]?.files).toEqual([fileId(3)]);
  });

  test('当たった Folder の中の Sheet の当たりも挙げる (色を付けるため)', () => {
    const result = filterByName(base, files, '仕事');
    expect(keptFiles(result?.tree as FolderTree)).toEqual([
      fileId(1),
      fileId(2),
      fileId(3),
    ]);
  });

  test('何も当たらなければ空のツリー', () => {
    const result = filterByName(base, files, '存在しない');
    expect(result?.tree).toEqual({ folders: [], files: [], renames: [] });
    expect(result?.matchedSheets.size).toBe(0);
  });

  test('Folder を使わない一覧 (トップ・レベルだけ) でも絞れる', () => {
    const flat = tree([], [1, 2, 3, 4]);
    const result = filterByName(flat, files, 'sheet');
    expect(result?.tree.files).toEqual([fileId(1), fileId(3)]);
  });

  // --- 性質: どんな名前と検索語でも、残るものと残らないものの規則が成り立つ ---

  /** 小さな文字の集まりから引く — 広いと当たりがほとんど起きない */
  const NAME = fc.string({
    unit: fc.constantFrom('a', 'B', 'c', ' '),
    maxLength: 4,
  });
  const QUERIES = ['a', 'b', 'c ', 'B'];

  test('∀ 名前と検索語. 名前か Sheet 名が当たる File は必ず残り、残った File は何かが当たっている', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(NAME, fc.array(NAME, { maxLength: 3 })), {
          maxLength: 5,
        }),
        NAME,
        (specs, folderName) => {
          const list = specs.map(([name, sheets], i) =>
            item(i + 1, name, sheets),
          );
          // 奇数番目を Folder に入れ、偶数番目をトップ・レベルに置く
          const numbers = list.map((_, i) => i + 1);
          const inFolder = numbers.filter((n) => n % 2 === 1);
          const t = tree(
            [folderNode(9, folderName, inFolder)],
            numbers.filter((n) => n % 2 === 0),
          );
          for (const query of QUERIES) {
            const result = filterByName(t, list, query);
            if (result === null) continue;
            const kept = new Set(keptFiles(result.tree));
            const folderHit = findNameMatch(folderName, query) !== null;
            list.forEach((f, i) => {
              const hit =
                findNameMatch(f.name, query) !== null ||
                f.sheets.some((s) => findNameMatch(s.name, query) !== null);
              const inHitFolder = folderHit && inFolder.includes(i + 1);
              if (hit) expect(kept.has(f.id)).toBe(true);
              if (kept.has(f.id)) expect(hit || inHitFolder).toBe(true);
            });
          }
        },
      ),
    );
  });
});
