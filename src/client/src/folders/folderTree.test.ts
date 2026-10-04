import { describe, expect, test } from 'bun:test';
import type { FileId, FolderId } from '@conversensus/shared';
import fc from 'fast-check';
import {
  buildFolderTree,
  type FolderNode,
  type FolderTree,
  folderPaths,
  isEmptyFolder,
  siblingNameTaken,
} from './folderTree';
import type { FilePlacement, Folder } from './types';

const fid = (n: number) =>
  `${String(n).repeat(8)}-0000-4000-8000-000000000000` as FolderId;
const file = (n: number) =>
  `${String(n).repeat(8)}-1111-4111-8111-111111111111` as FileId;
const T1 = '2026-10-01T00:00:00.000Z';
const T2 = '2026-10-02T00:00:00.000Z';

const folder = (
  n: number,
  name: string,
  over: Partial<Folder> = {},
): Folder => ({ id: fid(n), name, createdAt: T1, ...over });

// --- 生成器: 小さなプールから引く (重複・行き先の無い親・輪を頻繁に引くため) ---

const FOLDER_POOL = [1, 2, 3, 4, 5].map(fid);
/** プールに無い id (= 削除された Folder) を混ぜる */
const MISSING = fid(9);
const FILE_POOL = [1, 2, 3, 4].map(file);

const arbFolder: fc.Arbitrary<Folder> = fc.record(
  {
    id: fc.constantFrom(...FOLDER_POOL),
    name: fc.constantFrom('a', 'b', 'a (2)'),
    parent: fc.constantFrom(...FOLDER_POOL, MISSING),
    createdAt: fc.constantFrom(T1, T2),
  },
  { requiredKeys: ['id', 'name', 'createdAt'] },
);
const arbPlacement: fc.Arbitrary<FilePlacement> = fc.record({
  fileId: fc.constantFrom(...FILE_POOL),
  folder: fc.constantFrom(...FOLDER_POOL, MISSING),
});
const arbInput = fc.record({
  // 同じ id は 1 つだけ (PDS の rkey と同じ)
  folders: fc.uniqueArray(arbFolder, { selector: (f) => f.id, maxLength: 5 }),
  placements: fc.uniqueArray(arbPlacement, {
    selector: (p) => p.fileId,
    maxLength: 4,
  }),
  files: fc.uniqueArray(fc.constantFrom(...FILE_POOL), { maxLength: 4 }),
});

function* walk(nodes: FolderNode[]): Generator<FolderNode> {
  for (const node of nodes) {
    yield node;
    yield* walk(node.folders);
  }
}
const allFiles = (tree: FolderTree) => [
  ...tree.files,
  ...[...walk(tree.folders)].flatMap((n) => n.files),
];

describe('buildFolderTree の性質', () => {
  test('一覧の File はちょうど 1 回ずつ現れ、一覧に無い File は現れない', () => {
    fc.assert(
      fc.property(arbInput, ({ folders, placements, files }) => {
        const tree = buildFolderTree(folders, placements, files);
        expect([...allFiles(tree)].sort()).toEqual([...files].sort());
      }),
    );
  });

  test('どの Folder もちょうど 1 回ずつ現れる (親が無くても輪でも)', () => {
    fc.assert(
      fc.property(arbInput, ({ folders, placements, files }) => {
        const tree = buildFolderTree(folders, placements, files);
        expect([...walk(tree.folders)].map((n) => n.folder.id).sort()).toEqual(
          folders.map((f) => f.id).sort(),
        );
      }),
    );
  });

  test('同じ階層の名前は重ならない', () => {
    fc.assert(
      fc.property(arbInput, ({ folders, placements, files }) => {
        const tree = buildFolderTree(folders, placements, files);
        for (const siblings of [
          tree.folders,
          ...[...walk(tree.folders)].map((n) => n.folders),
        ]) {
          const names = siblings.map((n) => n.name);
          expect(new Set(names).size).toBe(names.length);
        }
      }),
    );
  });

  test('入れ子は入力の親に従う (親を勝手に付け替えない)', () => {
    fc.assert(
      fc.property(arbInput, ({ folders, placements, files }) => {
        const tree = buildFolderTree(folders, placements, files);
        for (const node of walk(tree.folders)) {
          for (const child of node.folders) {
            expect(child.folder.parent).toBe(node.folder.id);
          }
        }
      }),
    );
  });

  test('入力の並びに依らない (2 台が同じ集合から同じ木と同じ改名を得る)', () => {
    fc.assert(
      fc.property(
        arbInput,
        fc.integer(),
        ({ folders, placements, files }, seed) => {
          const shuffle = <T>(xs: readonly T[]) =>
            [...xs]
              .map((x, i) => ({ x, k: Math.sin(seed + i) }))
              .sort((a, b) => a.k - b.k)
              .map(({ x }) => x);
          const a = buildFolderTree(folders, placements, files);
          const b = buildFolderTree(
            shuffle(folders),
            shuffle(placements),
            files,
          );
          expect(b).toEqual(a);
        },
      ),
    );
  });

  test('改名を当てて作り直すと、もう改名は出ず、名前は変わらない (収束する)', () => {
    fc.assert(
      fc.property(arbInput, ({ folders, placements, files }) => {
        const first = buildFolderTree(folders, placements, files);
        const renamed = new Map(first.renames.map((r) => [r.id, r.name]));
        const applied = folders.map((f) => ({
          ...f,
          name: renamed.get(f.id) ?? f.name,
        }));
        const second = buildFolderTree(applied, placements, files);
        expect(second.renames).toEqual([]);
        const names = (t: FolderTree) =>
          [...walk(t.folders)].map((n) => [n.folder.id, n.name]).sort();
        expect(names(second)).toEqual(names(first));
      }),
    );
  });
});

describe('buildFolderTree の例', () => {
  test('同じ階層の同じ名前は、後に作られた方が「名前 (2)」になり、改名に出る', () => {
    const tree = buildFolderTree(
      [folder(2, '研究', { createdAt: T2 }), folder(1, '研究')],
      [],
      [],
    );
    expect(tree.folders.map((n) => n.name)).toEqual(['研究', '研究 (2)']);
    expect(tree.renames).toEqual([{ id: fid(2), name: '研究 (2)' }]);
  });

  test('別の階層なら同じ名前でよい', () => {
    const tree = buildFolderTree(
      [folder(1, '研究'), folder(2, '研究', { parent: fid(1) })],
      [],
      [],
    );
    expect(tree.renames).toEqual([]);
  });

  test('行き先の Folder が無い File はトップ・レベルに出る', () => {
    const tree = buildFolderTree(
      [],
      [{ fileId: file(1), folder: fid(9) }],
      [file(1)],
    );
    expect(tree.files).toEqual([file(1)]);
  });

  test('親の無い Folder はトップ・レベルに出る', () => {
    const tree = buildFolderTree([folder(1, 'a', { parent: fid(9) })], [], []);
    expect(tree.folders.map((n) => n.folder.id)).toEqual([fid(1)]);
  });

  test('輪の中の Folder はトップ・レベルに出て、輪の外からぶら下がる Folder は親を保つ', () => {
    const tree = buildFolderTree(
      [
        folder(1, 'a', { parent: fid(2) }),
        folder(2, 'b', { parent: fid(1) }),
        folder(3, 'c', { parent: fid(1) }),
      ],
      [],
      [],
    );
    expect(tree.folders.map((n) => n.folder.id)).toEqual([fid(1), fid(2)]);
    expect(tree.folders[0]?.folders.map((n) => n.folder.id)).toEqual([fid(3)]);
  });

  test('削除された File は表示から外れ、それしか持たない Folder は空とみなす', () => {
    const tree = buildFolderTree(
      [folder(1, 'a')],
      [{ fileId: file(1), folder: fid(1) }],
      [],
    );
    const [node] = tree.folders;
    expect(node?.files).toEqual([]);
    expect(node && isEmptyFolder(node)).toBe(true);
  });

  test('File を持つ・下位の Folder を持つ Folder は空でない', () => {
    const tree = buildFolderTree(
      [folder(1, 'a'), folder(2, 'b'), folder(3, 'c', { parent: fid(2) })],
      [{ fileId: file(1), folder: fid(1) }],
      [file(1)],
    );
    expect(tree.folders.map(isEmptyFolder)).toEqual([false, false]);
  });

  test('トップ・レベルの File は一覧の順', () => {
    const tree = buildFolderTree([], [], [file(3), file(1), file(2)]);
    expect(tree.files).toEqual([file(3), file(1), file(2)]);
  });
});

describe('siblingNameTaken / folderPaths (S6-2c)', () => {
  const tree = buildFolderTree(
    [
      folder(1, '研究'),
      folder(2, 'メモ', { parent: fid(1) }),
      folder(3, 'メモ'),
    ],
    [],
    [],
  );

  test('同じ階層の表示名とだけ比べる', () => {
    expect(siblingNameTaken(tree, undefined, '研究')).toBe(true);
    expect(siblingNameTaken(tree, undefined, '別')).toBe(false);
    expect(siblingNameTaken(tree, fid(1), 'メモ')).toBe(true);
    expect(siblingNameTaken(tree, fid(1), '研究')).toBe(false);
  });

  test('改名する Folder 自身の今の名前とは比べない', () => {
    expect(siblingNameTaken(tree, undefined, '研究', fid(1))).toBe(false);
  });

  test('移し先は「親 / 子」の道で名前を付け、同じ名前の Folder も見分けられる', () => {
    expect(folderPaths(tree)).toEqual([
      { id: fid(3), path: 'メモ' },
      { id: fid(1), path: '研究' },
      { id: fid(2), path: '研究 / メモ' },
    ]);
  });
});
