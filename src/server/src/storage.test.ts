import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  EdgeId,
  FileId,
  GraphFile,
  NodeId,
  SheetId,
} from '@conversensus/shared';
import { deleteFile, listSnapshotIds, readFile } from './storage';
import { writeLegacySnapshot } from './testing/legacySnapshot';

let tmpDir: string;

const sampleFile = (): GraphFile => ({
  id: 'test-id-1' as FileId,
  name: 'テストファイル',
  description: '説明',
  sheets: [
    {
      id: 'sheet-1' as SheetId,
      name: 'Sheet 1',
      nodes: [
        { id: 'n1' as NodeId, content: 'ノード1', style: { x: 10, y: 20 } },
      ],
      edges: [
        {
          id: 'e1' as EdgeId,
          source: 'n1' as NodeId,
          target: 'n2' as NodeId,
          label: 'ラベル',
        },
      ],
    },
  ],
});

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'conversensus-test-'));
  process.env.DATA_DIR = tmpDir;
});

afterEach(async () => {
  delete process.env.DATA_DIR;
  await rm(tmpDir, { recursive: true, force: true });
});

describe('storage', () => {
  // Phase 6 p6-5a: 書込 (旧 writeFile) は production から消えた。ここで置く snapshot は
  // 「Phase 6 より前に作られた既存ファイル」= 移行の入力の再現である。
  describe('readFile', () => {
    it('既存 snapshot を読み返せる', async () => {
      const data = sampleFile();
      await writeLegacySnapshot(data);
      const result = await readFile(data.id);
      expect(result).toEqual(data);
    });

    it('存在しない ID は null を返す', async () => {
      const result = await readFile('nonexistent');
      expect(result).toBeNull();
    });
  });

  // Phase 6 p6-2: 中身を読む一覧 (旧 listFiles) は GET /files が op-log 単独に
  // なって消費者を失い削除した。残るのは一括移行 (p6-0) が使う id 走査のみ。
  describe('listSnapshotIds', () => {
    it('空ディレクトリでは空配列を返す', async () => {
      expect(await listSnapshotIds()).toEqual([]);
    });

    it('DATA_DIR が存在しなくても空配列を返す (初回起動・2 組目のデーモン)', async () => {
      process.env.DATA_DIR = join(tmpDir, 'not-created-yet');
      expect(await listSnapshotIds()).toEqual([]);
    });

    it('既存 snapshot の id を拡張子なしで返す', async () => {
      const data = sampleFile();
      await writeLegacySnapshot(data);
      expect(await listSnapshotIds()).toEqual([data.id]);
    });

    it('複数ファイルをすべて列挙する', async () => {
      await writeLegacySnapshot({
        ...sampleFile(),
        id: 'id-a' as FileId,
        name: 'A',
      });
      await writeLegacySnapshot({
        ...sampleFile(),
        id: 'id-b' as FileId,
        name: 'B',
      });
      expect((await listSnapshotIds()).sort()).toEqual(['id-a', 'id-b']);
    });
  });

  describe('deleteFile', () => {
    it('存在するファイルを削除できる', async () => {
      const data = sampleFile();
      await writeLegacySnapshot(data);
      const ok = await deleteFile(data.id);
      expect(ok).toBe(true);
      expect(await readFile(data.id)).toBeNull();
    });

    it('存在しない ID の削除は false を返す', async () => {
      const ok = await deleteFile('nonexistent');
      expect(ok).toBe(false);
    });
  });
});
