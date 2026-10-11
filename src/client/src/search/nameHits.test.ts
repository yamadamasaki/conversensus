import { describe, expect, test } from 'bun:test';
import type {
  FileId,
  FolderId,
  GraphFileListItem,
  SheetId,
} from '@conversensus/shared';
import type { FolderNode, FolderTree } from '../folders/folderTree';
import { nameHits } from './nameHits';

const fileId = (n: number) => `file-${n}` as FileId;
const sheetId = (n: number, i: number) => `sheet-${n}-${i}` as SheetId;

function item(n: number, name: string, sheets: string[]): GraphFileListItem {
  return {
    id: fileId(n),
    name,
    sheets: sheets.map((s, i) => ({ id: sheetId(n, i), name: s })),
  };
}

function folderNode(
  name: string,
  files: number[],
  folders: FolderNode[] = [],
): FolderNode {
  return {
    folder: {
      id: `folder-${name}` as FolderId,
      name,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    name,
    folders,
    files: files.map(fileId),
  };
}

const files = [
  item(1, '議事録', ['Sheet 1', '決定事項']),
  item(2, '設計', ['論点']),
];
const tree: FolderTree = {
  folders: [folderNode('仕事', [1], [folderNode('設計の資料', [2])])],
  files: [],
  renames: [],
};

describe('nameHits (#248)', () => {
  test('File の当たりは最初の Sheet を開く', () => {
    expect(nameHits(tree, files, '議事')).toEqual([
      {
        kind: 'file',
        name: '議事録',
        context: '',
        trailing: '',
        fileId: fileId(1),
        sheetId: sheetId(1, 0),
      },
    ]);
  });

  test('Sheet の当たりはその Sheet を開き、File の名前を前に置く', () => {
    expect(nameHits(tree, files, '決定')).toEqual([
      {
        kind: 'sheet',
        name: '決定事項',
        context: '議事録 / ',
        trailing: '',
        fileId: fileId(1),
        sheetId: sheetId(1, 1),
      },
    ]);
  });

  test('Folder の当たりは直下の File ごとに 1 行。下位の Folder の当たりも引く', () => {
    const hits = nameHits(tree, files, '設計');
    expect(hits.map((h) => [h.kind, h.name, h.trailing])).toEqual([
      ['folder', '設計の資料', ' / 設計'],
      ['file', '設計', ''],
    ]);
  });

  test('空の検索語では何も出さない', () => {
    expect(nameHits(tree, files, ' ')).toEqual([]);
  });
});
