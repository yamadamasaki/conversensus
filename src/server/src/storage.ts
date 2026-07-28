import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GraphFile } from '@conversensus/shared';

const SNAPSHOT_EXT = '.json';

function dataDir() {
  return process.env.DATA_DIR ?? join(import.meta.dir, '../../../data');
}

// パストラバーサル対策: id に使用できる文字を制限し, dataDir 外へのパスを拒否する
function filePath(id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid file ID');
  const dir = resolve(dataDir());
  const resolved = resolve(dir, `${id}${SNAPSHOT_EXT}`);
  if (!resolved.startsWith(`${dir}/`) && resolved !== dir)
    throw new Error('Path traversal detected');
  return resolved;
}

/**
 * snapshot ファイルの id 一覧を返す (**中身を読まない**)。
 *
 * 中身を読む一覧 (旧 `listFiles`) は `GET /files` が op-log 単独になった時点 (p6-2) で
 * 消費者を失ったので削除した。走査を名前だけで行うのは、一括移行 (Phase 6 p6-0) が
 * per-file で失敗を隔離するため — 壊れた 1 件に一覧全体を巻き添えにさせない。
 * 読み込みは `readFile` に任せる。**storage.ts ごと退役する (p6-5) までの寿命**。
 */
export async function listSnapshotIds(): Promise<string[]> {
  if (!existsSync(dataDir())) return [];
  const glob = new Bun.Glob(`*${SNAPSHOT_EXT}`);
  const ids: string[] = [];
  for await (const name of glob.scan(dataDir())) {
    ids.push(name.slice(0, -SNAPSHOT_EXT.length));
  }
  return ids;
}

export async function readFile(id: string): Promise<GraphFile | null> {
  const file = Bun.file(filePath(id));
  if (!(await file.exists())) return null;
  return file.json() as Promise<GraphFile>;
}

export async function writeFile(data: GraphFile): Promise<void> {
  await Bun.write(filePath(data.id), JSON.stringify(data, null, 2));
}

export async function deleteFile(id: string): Promise<boolean> {
  const path = filePath(id);
  const file = Bun.file(path);
  if (!(await file.exists())) return false;
  const { unlink } = await import('node:fs/promises');
  await unlink(path);
  return true;
}
