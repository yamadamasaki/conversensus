import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GraphFile, GraphFileListItem } from '@conversensus/shared';

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

export async function listFiles(): Promise<GraphFileListItem[]> {
  // DATA_DIR 未作成 (初回起動・data/ を消した直後・2 組目のデーモン) では scan が throw する。
  // 「データが無い」は正常なので空一覧を返す。書込側は Bun.write が親ディレクトリを作る。
  if (!existsSync(dataDir())) return [];
  const glob = new Bun.Glob('*.json');
  const items: GraphFileListItem[] = [];
  for await (const name of glob.scan(dataDir())) {
    const file = Bun.file(join(dataDir(), name));
    const data: GraphFile = await file.json();
    items.push({ id: data.id, name: data.name, description: data.description });
  }
  return items;
}

/**
 * snapshot ファイルの id 一覧を返す (**中身を読まない**)。
 *
 * `listFiles` は全件を JSON parse するため、壊れた 1 件が一覧全体を巻き添えにする。
 * 一括移行 (Phase 6 p6-0) は per-file で失敗を隔離したいので、走査は名前だけで行い
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
