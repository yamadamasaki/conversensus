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
import { deleteFile, listFiles, readFile, writeFile } from './storage';

let tmpDir: string;

const sampleFile = (): GraphFile => ({
  id: 'test-id-1' as FileId,
  name: 'テストファイル',
  description: '説明',
  sheet: {
    id: 'sheet-1' as SheetId,
    name: 'Sheet 1',
    nodes: [
      { id: 'n1' as NodeId, content: 'ノード1', position: { x: 10, y: 20 } },
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
  describe('writeFile / readFile', () => {
    it('書き込んだファイルを読み返せる', async () => {
      const data = sampleFile();
      await writeFile(data);
      const result = await readFile(data.id);
      expect(result).toEqual(data);
    });

    it('存在しない ID は null を返す', async () => {
      const result = await readFile('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('listFiles', () => {
    it('空ディレクトリでは空配列を返す', async () => {
      const result = await listFiles();
      expect(result).toEqual([]);
    });

    it('書き込んだファイルが一覧に現れる', async () => {
      const data = sampleFile();
      await writeFile(data);
      const result = await listFiles();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: data.id,
        name: data.name,
        description: data.description,
      });
    });

    it('複数ファイルをすべてリストアップする', async () => {
      await writeFile({ ...sampleFile(), id: 'id-a' as FileId, name: 'A' });
      await writeFile({ ...sampleFile(), id: 'id-b' as FileId, name: 'B' });
      const result = await listFiles();
      expect(result).toHaveLength(2);
      const ids = result.map((f) => f.id).sort();
      expect(ids).toEqual(['id-a', 'id-b']);
    });
  });

  describe('deleteFile', () => {
    it('存在するファイルを削除できる', async () => {
      const data = sampleFile();
      await writeFile(data);
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
