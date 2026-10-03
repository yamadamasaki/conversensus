import { describe, expect, test } from 'bun:test';
import type { FileId, FolderId } from '@conversensus/shared';
import fc from 'fast-check';
import type { FilePlacement, Folder } from '../folders/types';
import {
  filePlacementToRecord,
  folderToRecord,
  recordToFilePlacement,
  recordToFolder,
} from './folderMapper';

const FOLDER = '33333333-3333-4333-8333-333333333333' as FolderId;
const PARENT = '44444444-4444-4444-8444-444444444444' as FolderId;
const FILE = '11111111-1111-4111-8111-111111111111' as FileId;

const arbFolder: fc.Arbitrary<Folder> = fc.record(
  {
    id: fc.uuid({ version: 4 }).map((id) => id as FolderId),
    name: fc.string({ minLength: 1 }),
    parent: fc.uuid({ version: 4 }).map((id) => id as FolderId),
    createdAt: fc
      .date({
        min: new Date('2000-01-01'),
        max: new Date('2100-01-01'),
        noInvalidDate: true,
      })
      .map((d) => d.toISOString()),
  },
  { requiredKeys: ['id', 'name', 'createdAt'] },
);

describe('Folder', () => {
  test('id を rkey に、残りを本文にして戻すと元に戻る', () => {
    fc.assert(
      fc.property(arbFolder, (folder) => {
        expect(recordToFolder(folder.id, folderToRecord(folder))).toEqual(
          folder,
        );
      }),
    );
  });

  test('トップ・レベルの Folder の本文は parent のキーを持たない', () => {
    const top: Folder = {
      id: FOLDER,
      name: '研究',
      createdAt: '2026-10-04T00:00:00.000Z',
    };
    expect('parent' in folderToRecord(top)).toBe(false);
  });

  test.each([
    [
      'rkey が UUID でない',
      'self',
      { name: 'a', createdAt: '2026-10-04T00:00:00.000Z' },
    ],
    ['名前が空', FOLDER, { name: '', createdAt: '2026-10-04T00:00:00.000Z' }],
    [
      'parent が UUID でない',
      FOLDER,
      { name: 'a', parent: 'x', createdAt: '2026-10-04T00:00:00.000Z' },
    ],
    ['createdAt が無い', FOLDER, { name: 'a' }],
  ])('壊れたレコードは null: %s', (_, rkey, value) => {
    expect(recordToFolder(rkey, value)).toBeNull();
  });
});

describe('File の置き場', () => {
  const placement: FilePlacement = { fileId: FILE, folder: PARENT };

  test('fileId を rkey に、Folder を本文にして戻すと元に戻る', () => {
    expect(
      recordToFilePlacement(FILE, filePlacementToRecord(placement)),
    ).toEqual(placement);
  });

  test('rkey が UUID でなければ null', () => {
    expect(recordToFilePlacement('self', { folder: PARENT })).toBeNull();
  });

  test('Folder が UUID でなければ null', () => {
    expect(recordToFilePlacement(FILE, { folder: 'x' })).toBeNull();
  });
});
